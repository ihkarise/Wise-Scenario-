import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { can } from "@/lib/auth/actor";
import { IdentityResolver } from "@/lib/auth/identity";
import { PostgresRoleSource } from "@/lib/auth/postgres-role-source";
import { encodeGuestCookie, GUEST_COOKIE } from "@/lib/auth/guest-cookie";
import { asUser, createSql, type Sql } from "@/lib/db/client";
import type { PlayerView } from "@/lib/engine";
import { createPostgresContainer, type Container } from "@/lib/server/container";
import { ServiceError } from "@/lib/server/service-error";
import { guestActor, userActor } from "@/lib/auth/actor";
import { migrationStatus } from "../../scripts/lib/migrate";
import { seedDemoCases } from "../../scripts/lib/seed-demo";
import { setRole } from "../../scripts/lib/grant-role";

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) throw new Error("TEST_DATABASE_URL is required (use npm run test:integration)");
const SECRET = "integration-secret-at-least-32-characters";
const ROOT = resolve(import.meta.dirname, "../..");

let sql: Sql;
const pools: Sql[] = [];
const container = (): Container => {
  const pool = createSql(URL_, { max: 4 });
  pools.push(pool);
  return createPostgresContainer({ sql: pool, sessionSecret: SECRET });
};

async function createUser(email: string): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${email})`;
  return id;
}

/** Picks an option using the published snapshot (test intent), submitting only IDs like a browser. */
async function pick(c: Container, view: PlayerView, slug: string, kind: "correct" | "wrong") {
  const def = (await c.cases.findBySlug(slug))!;
  const stage = def.stages.find((s) => s.id === view.current!.stageId)!;
  const tried = new Set(view.current!.options.filter((o) => o.tried).map((o) => o.id));
  const option = stage.interaction.options.find((o) => (kind === "correct" ? o.isCorrect : !o.isCorrect && !tried.has(o.id)))!;
  return { submissionId: randomUUID(), stageId: stage.id, optionId: option.id, expectedRevision: view.revision };
}

beforeAll(async () => {
  sql = createSql(URL_, { max: 4 });
  pools.push(sql);
  await sql`truncate public.attempt_answers, public.attempts, public.case_versions, public.case_references,
    public.stage_options, public.case_stages, public.cases cascade`;
  await sql`delete from auth.users where email like '%@it.test'`;
  await seedDemoCases(sql);
});

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end({ timeout: 5 })));
});

describe("database foundation", () => {
  it("records both approved migrations and never the proposed one", async () => {
    const status = await migrationStatus(sql, ROOT);
    expect(status.map((s) => [s.file.name, s.applied])).toEqual([
      ["m1_core_schema", true],
      ["m2_foundation", true],
    ]);
    const [authoring] = await sql`select to_regclass('public.audit_logs') as t`;
    expect(authoring!.t).toBeNull();
  });

  it("demo cases are database records: 5 published versions and 1 draft; seeding again changes nothing", async () => {
    const [counts] = await sql<{ published: number; drafts: number; versions: number }[]>`
      select (select count(*)::int from public.cases where status = 'PUBLISHED') as published,
             (select count(*)::int from public.cases where status = 'DRAFT') as drafts,
             (select count(*)::int from public.case_versions) as versions`;
    expect(counts).toEqual({ published: 5, drafts: 1, versions: 5 });
    const again = await seedDemoCases(sql);
    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(6);
  });
});

describe("published catalogue (PostgresCaseRepository)", () => {
  it("lists only published cases, paginated by cursor", async () => {
    const c = container();
    const first = await c.cases.listPublished({ limit: 2 });
    expect(first.items.map((i) => i.caseNumber)).toEqual([1, 124]);
    const second = await c.cases.listPublished({ limit: 10, cursor: first.nextCursor });
    expect(second.items.map((i) => i.slug)).not.toContain("demo-unpublished-draft");
    expect(first.items.length + second.items.length).toBe(5);
    expect(second.nextCursor).toBeNull();
  });

  it("serves the frozen snapshot with database IDs; drafts have no playable version", async () => {
    const c = container();
    const def = await c.cases.findBySlug("demo-ring-shaped-rash");
    expect(def?.stages).toHaveLength(5);
    expect(def?.stages[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await c.cases.findBySlug("demo-unpublished-draft")).toBeNull();
  });
});

describe("persistent, server-authoritative attempts", () => {
  it("guest attempt survives a server restart with the same lives and stage", async () => {
    const guest = guestActor(randomUUID());
    const a = container();
    let view = await a.attemptService.startOrResume(guest, "demo-ring-shaped-rash");
    view = (await a.attemptService.submitAnswer(guest, view.attemptId, await pick(a, view, "demo-ring-shaped-rash", "wrong"))).view;
    expect(view).toMatchObject({ livesRemaining: 4, currentStageOrder: 2 });

    // A brand-new container and connection pool = a restarted server.
    const b = container();
    const resumed = await b.attemptService.startOrResume(guest, "demo-ring-shaped-rash");
    expect(resumed.attemptId).toBe(view.attemptId);
    expect(resumed).toMatchObject({ livesRemaining: 4, currentStageOrder: 2 });
    const [row] = await sql`select guest_id, user_id, lives_remaining from public.attempts where id = ${view.attemptId}`;
    expect(row).toMatchObject({ guest_id: guest.id, user_id: null, lives_remaining: 4 });
    const [answers] = await sql<{ n: number }[]>`select count(*)::int as n from public.attempt_answers where attempt_id = ${view.attemptId}`;
    expect(answers!.n).toBe(1);
  });

  it("signed-in attempt is stored against the user and appears in their history", async () => {
    const userId = await createUser("learner@it.test");
    const learner = userActor(userId, ["LEARNER"]);
    const c = container();
    let view = await c.attemptService.startOrResume(learner, "demo-numb-little-finger");
    view = (await c.attemptService.submitAnswer(learner, view.attemptId, await pick(c, view, "demo-numb-little-finger", "correct"))).view;
    expect(view.status).toBe("COMPLETED_SUCCESS");
    const history = await c.attemptService.history(learner);
    expect(history[0]).toMatchObject({ caseTitle: "The numb little finger", status: "COMPLETED_SUCCESS", score: 1000 });
  });

  it("another learner cannot read or answer the attempt", async () => {
    const owner = guestActor(randomUUID());
    const intruder = guestActor(randomUUID());
    const c = container();
    const view = await c.attemptService.startOrResume(owner, "demo-stiff-on-rising");
    await expect(c.attemptService.getView(intruder, view.attemptId)).rejects.toMatchObject({ code: "ATTEMPT_NOT_FOUND" });
    await expect(
      c.attemptService.submitAnswer(intruder, view.attemptId, await pick(c, view, "demo-stiff-on-rising", "correct")),
    ).rejects.toMatchObject({ code: "ATTEMPT_NOT_FOUND" });
  });

  it("concurrent duplicate submissions cost exactly one life", async () => {
    const guest = guestActor(randomUUID());
    const c = container();
    const view = await c.attemptService.startOrResume(guest, "demo-tired-and-cold");
    // Stage 1 of this case is free, so move to stage 2 first.
    const at2 = (await c.attemptService.submitAnswer(guest, view.attemptId, await pick(c, view, "demo-tired-and-cold", "wrong"))).view;
    const submission = await pick(c, at2, "demo-tired-and-cold", "wrong");
    await Promise.allSettled([
      c.attemptService.submitAnswer(guest, view.attemptId, submission),
      c.attemptService.submitAnswer(guest, view.attemptId, submission),
      c.attemptService.submitAnswer(guest, view.attemptId, { ...submission, submissionId: randomUUID() }),
    ]);
    const [row] = await sql<{ lives_remaining: number; answers: number }[]>`
      select lives_remaining, (select count(*)::int from public.attempt_answers where attempt_id = ${view.attemptId}) as answers
      from public.attempts where id = ${view.attemptId}`;
    expect(row).toEqual({ lives_remaining: 4, answers: 2 });
  });

  it("an attempt stays on the version it started with when a new version is published", async () => {
    const guest = guestActor(randomUUID());
    const c = container();
    const v1 = (await c.cases.findBySlug("demo-headache-from-the-sun"))!;
    let view = await c.attemptService.startOrResume(guest, v1.slug);
    view = (await c.attemptService.submitAnswer(guest, view.attemptId, await pick(c, view, v1.slug, "wrong"))).view;
    const v1Clue2 = view.current!.content;

    // Publish version 2 with a changed clue 2.
    const v2 = structuredClone(v1);
    v2.version = 2;
    v2.stages[1]!.content = "VERSION 2 CLUE";
    await sql.begin(async (tx) => {
      await tx`insert into public.case_versions (case_id, version, snapshot, case_number, slug, title, summary, domain, category, difficulty, max_lives, stage_count)
        values (${v1.id}, 2, ${tx.json(v2 as never)}, ${v1.caseNumber}, ${v1.slug}, ${v1.title}, ${v1.summary}, ${v1.domain}, ${v1.category}, ${v1.difficulty}, ${v1.maxLives}, ${v1.stages.length})`;
      await tx`update public.cases set published_version = 2, published_at = now() where id = ${v1.id}`;
    });

    const resumed = await c.attemptService.getView(guest, view.attemptId);
    expect(resumed.current!.content).toBe(v1Clue2);
    expect(resumed.current!.content).not.toBe("VERSION 2 CLUE");
    const done = (await c.attemptService.submitAnswer(guest, view.attemptId, await pickVersion(c, resumed, v1.id, 1, "correct"))).view;
    expect(done.status).toBe("COMPLETED_SUCCESS");

    let fresh = await c.attemptService.startOrResume(guest, v1.slug);
    fresh = (await c.attemptService.submitAnswer(guest, fresh.attemptId, await pick(c, fresh, v1.slug, "wrong"))).view;
    expect(fresh.current!.content).toBe("VERSION 2 CLUE");
  });

  it("unpublishing stops play mid-attempt; drafts cannot be started", async () => {
    const guest = guestActor(randomUUID());
    const c = container();
    const view = await c.attemptService.startOrResume(guest, "demo-stiff-on-rising");
    const submission = await pick(c, view, "demo-stiff-on-rising", "correct");
    await sql`update public.cases set status = 'DRAFT' where slug = 'demo-stiff-on-rising'`;
    try {
      await expect(c.attemptService.submitAnswer(guest, view.attemptId, submission)).rejects.toMatchObject({ code: "CASE_UNAVAILABLE" });
      await expect(c.attemptService.startOrResume(guest, "demo-unpublished-draft")).rejects.toBeInstanceOf(ServiceError);
    } finally {
      await sql`update public.cases set status = 'PUBLISHED' where slug = 'demo-stiff-on-rising'`;
    }
  });
});

describe("roles come from the database", () => {
  it("SUPER_ADMIN granted by email is recognised by the identity resolver; new sign-ups are learners", async () => {
    const ownerId = await createUser("owner@it.test");
    const learnerId = await createUser("someone@it.test");
    const grant = await setRole(sql, { email: "Owner@IT.test", role: "SUPER_ADMIN", displayName: "Owner" });
    expect(grant).toMatchObject({ status: "granted", roles: ["SUPER_ADMIN", "LEARNER"] });

    let signedIn = ownerId;
    const resolver = new IdentityResolver({ getUser: async () => ({ id: signedIn, email: null }) }, new PostgresRoleSource(sql), SECRET);
    const noCookies = { get: () => undefined, getAll: () => [] };
    const owner = await resolver.resolve(noCookies);
    expect(can(owner, "case:publish")).toBe(true);
    signedIn = learnerId;
    const learner = await resolver.resolve(noCookies);
    expect(learner?.roles).toEqual(["LEARNER"]);
    expect(can(learner, "admin:access")).toBe(false);
  });

  it("a signed guest cookie resolves to a guest; a forged one does not", async () => {
    const resolver = new IdentityResolver({ getUser: async () => null }, new PostgresRoleSource(sql), SECRET);
    const id = randomUUID();
    const cookies = (value: string) => ({ get: (n: string) => (n === GUEST_COOKIE ? { value } : undefined), getAll: () => [] });
    expect(await resolver.resolve(cookies(encodeGuestCookie(id, SECRET)))).toMatchObject({ kind: "guest", id });
    expect(await resolver.resolve(cookies(`${id}.forged`))).toBeNull();
  });

  it("server actions taken as a user still obey Row Level Security", async () => {
    const editorId = await createUser("editor@it.test");
    await setRole(sql, { email: "editor@it.test", role: "EDITOR" });
    const learnerId = await createUser("reader@it.test");

    const rows = await asUser(sql, editorId, (tx) => tx<{ uid: string }[]>`select auth.uid() as uid`);
    expect(rows[0]?.uid).toBe(editorId);
    await expect(
      asUser(sql, editorId, (tx) => tx`update public.cases set status = 'PUBLISHED', published_version = 1, published_at = now() where slug = 'demo-unpublished-draft'`),
    ).rejects.toMatchObject({ code: "42501" });
    const visible = await asUser(sql, learnerId, (tx) => tx`select id from public.stage_options`);
    expect(visible).toHaveLength(0);
  });
});

async function pickVersion(c: Container, view: PlayerView, caseId: string, version: number, kind: "correct" | "wrong") {
  const def = (await c.cases.findVersion(caseId, version))!;
  const stage = def.stages.find((s) => s.id === view.current!.stageId)!;
  const option = stage.interaction.options.find((o) => (kind === "correct" ? o.isCorrect : !o.isCorrect))!;
  return { submissionId: randomUUID(), stageId: stage.id, optionId: option.id, expectedRevision: view.revision };
}
