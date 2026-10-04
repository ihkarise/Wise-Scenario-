import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guestActor, userActor, type Actor } from "@/lib/auth/actor";
import { createSql, type Sql } from "@/lib/db/client";
import { createPostgresContainer, type Container } from "@/lib/server/container";
import { ServiceError } from "@/lib/server/service-error";
import { beginAttempt, createAttempt, submitAnswer, toPlayerView } from "@/lib/engine";
import type { CaseDraft } from "@/features/admin/draft";
import { seedDemoCases } from "../../scripts/lib/seed-demo";
import { setRole } from "../../scripts/lib/grant-role";

/**
 * Case Manager against a real PostgreSQL that has ONLY the approved migrations (0100, 0200) — the same
 * schema as the production database. Proves no further migration is needed.
 */
const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) throw new Error("TEST_DATABASE_URL is required (use npm run test:integration)");

let sql: Sql;
let c: Container;
let superAdmin: Actor;
let admin: Actor;
let editor: Actor;
let learner: Actor;

async function user(email: string, role?: "SUPER_ADMIN" | "ADMIN" | "EDITOR"): Promise<Actor> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${email})`;
  if (role) await setRole(sql, { email, role });
  const roles = (await sql<{ role: Actor["roles"][number] }[]>`select role from public.user_roles where user_id = ${id}`).map((r) => r.role);
  return userActor(id, roles, email);
}

/** A valid case file with neutral test text (no medical content). */
function caseFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "IT-001",
    title: "Integration case one",
    category: "Integration Testing",
    subcategory: "Sub",
    difficulty: "easy",
    status: "published",
    startingLives: 4,
    lifeLossPerWrong: 1,
    startingScore: 500,
    stages: [
      { stageNumber: 1, title: "First", clue: "Alpha bravo charlie delta", investigations: [{ test: "Test one", value: "12", unit: "u" }] },
      { stageNumber: 2, title: "Second", clue: "Echo foxtrot golf hotel", explanation: "Stage two explanation." },
      {
        stageNumber: 3,
        title: "Third",
        clue: "India juliet kilo lima",
        decisionPoint: { question: "Which?", options: [{ label: "Answer Alpha", correct: true }, { label: "Answer Beta" }] },
      },
    ],
    diagnosis: { primary: "Answer Alpha", acceptedAnswers: ["Answer Alpha"], aliases: ["AA1"], explanation: "Because alpha." },
    differentialDiagnoses: [{ name: "Answer Beta", whyRejected: "Not beta." }, { name: "Answer Gamma", whyRejected: "Not gamma." }],
    wrongAnswerExplanations: [{ condition: "Answer Beta", explanation: "Beta feedback.", missedClues: ["kilo"] }],
    clinicalInsight: "Insight text.",
    learningPoints: ["Point one"],
    references: [{ title: "Reference one", year: 2020, verified: true }],
    ...overrides,
  };
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === code);
}

beforeAll(async () => {
  sql = createSql(URL_, { max: 4 });
  await sql`truncate public.attempt_answers, public.attempts, public.case_versions, public.case_references,
    public.stage_options, public.case_stages, public.cases cascade`;
  await sql`delete from auth.users where email like '%@cm.test'`;
  await seedDemoCases(sql);
  c = createPostgresContainer({ sql, sessionSecret: "integration-secret-at-least-32-characters" });
  superAdmin = await user("owner@cm.test", "SUPER_ADMIN");
  admin = await user("admin@cm.test", "ADMIN");
  editor = await user("editor@cm.test", "EDITOR");
  learner = await user("learner@cm.test");
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("JSON import", () => {
  let importedId: string;

  it("validates, then imports a case as a DRAFT with every field kept", async () => {
    const check = await c.admin!.validateDocument(admin, caseFile());
    expect(check.ok).toBe(true);
    expect(check.duplicates).toEqual([]);
    expect(check.items).toContainEqual({ level: "info", message: "Category “Integration Testing” is new and will be created in Medical Diagnosis." });

    const { caseId } = await c.admin!.importDocument(admin, caseFile(), { allowDuplicates: false });
    importedId = caseId;
    const draft = await c.admin!.getDraft(admin, caseId);
    expect(draft.status).toBe("DRAFT"); // "published" in the file is never honoured
    expect(draft.caseCode).toBe("IT-001");
    expect(draft.subcategory).toBe("Sub");
    expect(draft.stages).toHaveLength(3);
    expect(draft.stages[0]!.investigations).toEqual([{ name: "Test one", value: "12", unit: "u", referenceRange: "", interpretation: "" }]);
    expect(draft.stages[0]!.options.map((o) => o.label).sort()).toEqual(["Answer Alpha", "Answer Beta", "Answer Gamma"]);
    expect(draft.stages[2]!.question).toBe("Which?");
    expect(draft.diagnosis.aliases).toEqual(["AA1"]);
    expect(draft.wrongAnswerExplanations[0]?.explanation).toBe("Beta feedback.");
    expect(draft.clinicalInsight).toBe("Insight text.");
    expect(draft.references[0]).toMatchObject({ title: "Reference one", verified: true });
  });

  it("drafts are never shown in the learner Case Library", async () => {
    const { items } = await c.cases.listPublished({ limit: 100 });
    expect(items.map((i) => i.id)).not.toContain(importedId);
    const draft = await c.admin!.getDraft(admin, importedId);
    expect(await c.cases.findBySlug(draft.slug)).toBeNull();
  });

  it("never overwrites: the same Case ID is refused", async () => {
    const check = await c.admin!.validateDocument(admin, caseFile({ title: "Completely different" }));
    expect(check.ok).toBe(false);
    expect(check.items.some((i) => i.level === "error" && i.message.startsWith("Case ID IT-001 is already used"))).toBe(true);
    expect(check.duplicates[0]).toMatchObject({ caseCode: "IT-001", sameCaseId: true, similarity: 100 });
    await expectError(c.admin!.importDocument(admin, caseFile({ title: "Completely different" }), { allowDuplicates: true }), "INVALID_CASE_FILE");
  });

  it("asks for confirmation for a similar case under a new Case ID, then imports when confirmed", async () => {
    const file = caseFile({ id: "IT-002" });
    const check = await c.admin!.validateDocument(admin, file);
    expect(check.ok).toBe(true);
    expect(check.duplicates[0]).toMatchObject({ caseId: importedId, sameCaseId: false });
    expect(check.duplicates[0]!.similarity).toBeGreaterThanOrEqual(85);
    await expectError(c.admin!.importDocument(admin, file, { allowDuplicates: false }), "DUPLICATE_CONFIRMATION_REQUIRED");
    const { caseId } = await c.admin!.importDocument(admin, file, { allowDuplicates: true });
    expect(caseId).not.toBe(importedId);
  });

  it("editors cannot create new categories through import", async () => {
    const check = await c.admin!.validateDocument(editor, caseFile({ id: "IT-003", category: "Brand New Category" }));
    expect(check.ok).toBe(false);
    expect(check.items.some((i) => i.level === "error" && i.message.includes("Brand New Category"))).toBe(true);
  });

  it("export produces the structured JSON that imports back without errors", async () => {
    const { document, fileName } = await c.admin!.exportCase(editor, importedId);
    expect(fileName).toMatch(/^IT-001-integration-case-one\.json$/);
    expect(document).toMatchObject({ format: "wisecases.case", id: "IT-001", status: "draft", category: "Integration Testing" });
    const again = await c.admin!.validateDocument(admin, { ...document, id: "IT-100", title: "Round trip" });
    expect(again.items.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("create, edit, duplicate", () => {
  let caseId: string;
  let draft: CaseDraft;

  it("creates an empty draft with an automatic Case ID", async () => {
    caseId = await c.admin!.createCase(editor, {
      caseCode: "",
      title: "Editor case",
      domainId: (await c.admin!.taxonomy(editor)).domains.find((d) => d.name === "Medical Diagnosis")!.id,
      category: "Integration Testing",
      subcategory: "",
      difficulty: "HARD",
      maxLives: 3,
    });
    draft = await c.admin!.getDraft(editor, caseId);
    expect(draft.caseCode).toMatch(/^CASE-\d{3,}$/);
    expect(draft.stages).toEqual([]);
    expect(draft.status).toBe("DRAFT");
  });

  it("saves a 7-stage draft and refuses a stale save (edit conflict)", async () => {
    const stages = Array.from({ length: 7 }, (_, i) => ({
      id: randomUUID(),
      title: `S${i + 1}`,
      content: `Clue ${i + 1}`,
      question: "Q?",
      hint: "",
      explanation: "",
      lifeCost: 1,
      showPreviousClues: true,
      options: [
        { id: randomUUID(), label: "Right", isCorrect: true },
        { id: randomUUID(), label: "Wrong", isCorrect: false },
      ],
      investigations: [],
      crossReference: i === 0 ? "See IT-001" : "",
    }));
    const content = { ...draft, stages, diagnosis: { ...draft.diagnosis, primary: "Right", displayName: "Right", acceptedAnswers: ["Right"], explanation: "E" } };
    const saved = await c.admin!.saveDraft(editor, caseId, content, draft.revision);
    expect(saved.status).toBe("saved");
    const reloaded = await c.admin!.getDraft(editor, caseId);
    expect(reloaded.stages.map((s) => s.title)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    expect(reloaded.stages[0]!.crossReference).toBe("See IT-001");
    await expectError(c.admin!.saveDraft(editor, caseId, content, draft.revision), "EDIT_CONFLICT");

    // Reorder: move the last stage to the front.
    const reordered = { ...reloaded, stages: [reloaded.stages[6]!, ...reloaded.stages.slice(0, 6)] };
    await c.admin!.saveDraft(editor, caseId, reordered, reloaded.revision);
    expect((await c.admin!.getDraft(editor, caseId)).stages.map((s) => s.title)).toEqual(["S7", "S1", "S2", "S3", "S4", "S5", "S6"]);
  });

  it("refuses to save empty required stage fields with plain messages", async () => {
    const d = await c.admin!.getDraft(editor, caseId);
    const broken = { ...d, stages: [{ ...d.stages[0]!, content: "  " }, ...d.stages.slice(1)] };
    await expect(c.admin!.saveDraft(editor, caseId, broken, d.revision)).rejects.toMatchObject({ code: "DRAFT_INCOMPLETE", issues: ["Stage 1 needs clue text."] });
  });

  it("refuses a Case ID already used by another case", async () => {
    const d = await c.admin!.getDraft(editor, caseId);
    await expectError(c.admin!.saveDraft(editor, caseId, { ...d, caseCode: "it-001" }, d.revision), "CASE_ID_TAKEN");
  });

  it("duplicates a case as a new draft with new IDs and a -COPY Case ID", async () => {
    const copyId = await c.admin!.duplicate(editor, caseId);
    const [original, copy] = await Promise.all([c.admin!.getDraft(editor, caseId), c.admin!.getDraft(editor, copyId)]);
    expect(copy.caseCode).toBe(`${original.caseCode}-COPY`);
    expect(copy.title).toBe("Editor case (copy)");
    expect(copy.stages.map((s) => s.title)).toEqual(original.stages.map((s) => s.title));
    expect(copy.stages.map((s) => s.id)).not.toEqual(original.stages.map((s) => s.id));
    expect(copy.stages[1]!.crossReference).toBe("See IT-001");
  });

  it("opens the existing demo cases (made before the Case Manager) with their content mapped in", async () => {
    const { items } = await c.admin!.listCases(editor, { q: "ring-shaped", sort: "updated_desc", page: 1, pageSize: 10 });
    const demo = await c.admin!.getDraft(editor, items[0]!.id);
    expect(demo.caseCode).toMatch(/^CASE-\d{3}$/);
    expect(demo.diagnosis.displayName).toBe("Tinea corporis");
    expect(demo.differentialDiagnoses.length).toBeGreaterThan(0);
    expect(demo.differentialDiagnoses[0]!.whyRejected).not.toBe("");
  });
});

describe("inventory", () => {
  it("searches by Case ID, title, category and subcategory, with pagination", async () => {
    const byCode = await c.admin!.listCases(editor, { q: "IT-00", sort: "code_asc", page: 1, pageSize: 10 });
    expect(byCode.items.map((i) => i.caseCode)).toEqual(["IT-001", "IT-002"]);
    expect(byCode.items[0]).toMatchObject({ subcategory: "Sub", category: "Integration Testing", stageCount: 3, status: "DRAFT" });
    const page1 = await c.admin!.listCases(editor, { sort: "number_desc", page: 1, pageSize: 2 });
    const page2 = await c.admin!.listCases(editor, { sort: "number_desc", page: 2, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBeGreaterThan(4);
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });
});

describe("authorization", () => {
  it("learners and guests cannot use the Case Manager at all", async () => {
    const someCase = (await c.admin!.listCases(editor, { sort: "updated_desc", page: 1, pageSize: 1 })).items[0]!.id;
    await expectError(c.admin!.listCases(learner, { sort: "updated_desc", page: 1, pageSize: 1 }), "FORBIDDEN");
    await expectError(c.admin!.getDraft(learner, someCase), "FORBIDDEN");
    await expectError(c.admin!.exportCase(learner, someCase), "FORBIDDEN");
    await expectError(c.admin!.previewSnapshot(learner, someCase), "FORBIDDEN");
    await expectError(c.admin!.importDocument(learner, caseFile({ id: "IT-200" }), { allowDuplicates: true }), "FORBIDDEN");
    await expectError(c.admin!.searchConditions(learner, "aih"), "FORBIDDEN");
    await expectError(c.admin!.listCases(guestActor(randomUUID()), { sort: "updated_desc", page: 1, pageSize: 1 }), "UNAUTHORIZED");
    await expectError(c.admin!.listCases(null, { sort: "updated_desc", page: 1, pageSize: 1 }), "UNAUTHORIZED");
  });

  it("only SUPER_ADMIN can publish; editors and admins are refused by the app and the database", async () => {
    const { items } = await c.admin!.listCases(editor, { q: "IT-001", sort: "updated_desc", page: 1, pageSize: 1 });
    const id = items[0]!.id;
    await expectError(c.admin!.applyAction(editor, id, "publish"), "FORBIDDEN");
    await expectError(c.admin!.applyAction(admin, id, "publish"), "FORBIDDEN");
    // Even bypassing the app, the database refuses an editor.
    const repo = (c.admin as unknown as { deps: { repo: { publish: (u: string, id: string, b: () => never) => Promise<unknown> } } }).deps.repo;
    await expect(repo.publish(editor.id, id, () => { throw new Error("not reached"); })).rejects.toBeTruthy();
    expect((await c.cases.listPublished({ limit: 100 })).items.map((i) => i.id)).not.toContain(id);
  });
});

describe("preview and publish", () => {
  it("preview plays the draft with the real engine; nothing is stored", async () => {
    const { items } = await c.admin!.listCases(editor, { q: "IT-001", sort: "updated_desc", page: 1, pageSize: 1 });
    const id = items[0]!.id;
    const [attemptsBefore] = await sql<{ n: number }[]>`select count(*)::int as n from public.attempts`;
    const snapshot = await c.admin!.previewSnapshot(editor, id);
    let attempt = beginAttempt(createAttempt(snapshot, { attemptId: randomUUID(), ownerId: "preview" }), new Date());
    const stage = snapshot.stages[0]!;
    const wrong = stage.interaction.options.find((o) => o.label === "Answer Beta")!;
    const out = submitAnswer(snapshot, attempt, { submissionId: randomUUID(), stageId: stage.id, optionId: wrong.id, expectedRevision: attempt.revision }, { now: new Date() });
    if (!out.ok) throw new Error(out.error.code);
    attempt = out.attempt;
    const view = toPlayerView(snapshot, attempt);
    expect(view.current?.investigations).toBeUndefined();
    expect(view.clues[0]?.investigations?.[0]?.name).toBe("Test one");
    const [attemptsAfter] = await sql<{ n: number }[]>`select count(*)::int as n from public.attempts`;
    expect(attemptsAfter!.n).toBe(attemptsBefore!.n);
  });

  it("SUPER_ADMIN publishes; learners then play the frozen snapshot with the new reasoning", async () => {
    const { items } = await c.admin!.listCases(editor, { q: "IT-001", sort: "updated_desc", page: 1, pageSize: 1 });
    const id = items[0]!.id;
    expect(await c.admin!.applyAction(superAdmin, id, "publish")).toEqual({ status: "PUBLISHED", version: 1 });
    const live = await c.cases.findById(id);
    expect(live?.publicationStatus).toBe("PUBLISHED");
    expect(live?.teaching.reasoning?.clinicalInsight).toBe("Insight text.");
    expect(live?.teaching.wrongAnswerExplanations?.[0]?.condition).toBe("Answer Beta");
    const listed = (await c.admin!.listCases(editor, { q: "IT-001", sort: "updated_desc", page: 1, pageSize: 1 })).items[0]!;
    expect(listed).toMatchObject({ status: "PUBLISHED", publishedVersion: 1, hasUnpublishedChanges: false });
  });
});

describe("condition inventory", () => {
  it("includes the starter list and names written in medical cases", async () => {
    expect((await c.admin!.searchConditions(editor, "AIH"))[0]?.name).toBe("Autoimmune hepatitis");
    const fromCases = await c.admin!.searchConditions(editor, "answer gamma");
    expect(fromCases[0]).toMatchObject({ name: "Answer Gamma", source: "cases" });
    // Materia medica remedies are not conditions.
    expect(await c.admin!.searchConditions(editor, "Rhus toxicodendron")).toEqual([]);
  });
});
