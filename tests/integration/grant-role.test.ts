import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql, type Sql } from "@/lib/db/client";
import { setRole } from "../../scripts/lib/grant-role";

/**
 * `npm run admin:grant` for accounts created BEFORE the WiseCases migrations: they exist in auth.users
 * but have no profile (the sign-up trigger did not exist yet), so granting a role used to fail with
 * user_roles_user_id_fkey.
 */
const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) throw new Error("TEST_DATABASE_URL is required (use npm run test:integration)");

let sql: Sql;

/** An account created as if the sign-up trigger did not exist yet: no profile, no roles. */
async function preMigrationAccount(email: string): Promise<string> {
  const id = randomUUID();
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`; // triggers off, for this insert only
    await tx`insert into auth.users (id, email) values (${id}, ${email})`;
  });
  return id;
}

async function idOf(email: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
  return row!.id;
}

async function rows(id: string) {
  const [p] = await sql<{ n: number }[]>`select count(*)::int as n from public.profiles where id = ${id}`;
  const roles = (await sql<{ role: string }[]>`select role from public.user_roles where user_id = ${id} order by role`).map((r) => r.role);
  return { profiles: p!.n, roles };
}

beforeAll(async () => {
  sql = createSql(URL_, { max: 2 });
  await sql`delete from auth.users where email like '%@gr.test'`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("admin:grant for an account without a WiseCases profile", () => {
  it("reproduces the original failure condition: account exists, profile missing", async () => {
    const id = await preMigrationAccount("old@gr.test");
    expect(await rows(id)).toEqual({ profiles: 0, roles: [] });
  });

  it("creates exactly one profile with the LEARNER role, then grants the requested role", async () => {
    const id = await idOf("old@gr.test");
    const r = await setRole(sql, { email: "Old@GR.test", role: "SUPER_ADMIN" });
    expect(r).toMatchObject({ status: "granted", profileCreated: true, roles: ["SUPER_ADMIN", "LEARNER"] });
    expect(await rows(id)).toEqual({ profiles: 1, roles: ["SUPER_ADMIN", "LEARNER"] });
    const [profile] = await sql<{ is_guest: boolean; display_name: string | null }[]>`select is_guest, display_name from public.profiles where id = ${id}`;
    expect(profile).toEqual({ is_guest: false, display_name: null });
  });

  it("is safe to run again: no duplicate profile or role", async () => {
    const id = await idOf("old@gr.test");
    const r = await setRole(sql, { email: "old@gr.test", role: "SUPER_ADMIN" });
    expect(r).toMatchObject({ status: "already_had", profileCreated: false, roles: ["SUPER_ADMIN", "LEARNER"] });
    expect(await rows(id)).toEqual({ profiles: 1, roles: ["SUPER_ADMIN", "LEARNER"] });
  });

  it("never changes an existing profile, and does not grant anything extra", async () => {
    const id = randomUUID();
    await sql`insert into auth.users (id, email) values (${id}, 'normal@gr.test')`; // trigger runs as usual
    await sql`update public.profiles set display_name = 'Kept Name' where id = ${id}`;
    const before = await sql`select * from public.profiles where id = ${id}`;
    const r = await setRole(sql, { email: "normal@gr.test", role: "EDITOR" });
    expect(r).toMatchObject({ status: "granted", profileCreated: false, roles: ["EDITOR", "LEARNER"] });
    expect(await sql`select * from public.profiles where id = ${id}`).toEqual(before);
  });

  it("does not touch other accounts, and does not create a profile when revoking", async () => {
    const bystander = await preMigrationAccount("bystander@gr.test");
    await setRole(sql, { email: "old@gr.test", role: "SUPER_ADMIN" });
    expect(await rows(bystander)).toEqual({ profiles: 0, roles: [] });
    const r = await setRole(sql, { email: "bystander@gr.test", role: "SUPER_ADMIN", revoke: true });
    expect(r).toMatchObject({ status: "revoked", profileCreated: false, roles: [] });
    expect(await rows(bystander)).toEqual({ profiles: 0, roles: [] });
  });

  it("an unknown email still changes nothing", async () => {
    expect(await setRole(sql, { email: "nobody@gr.test", role: "SUPER_ADMIN" })).toEqual({ status: "not_found" });
  });
});
