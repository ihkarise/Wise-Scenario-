import { describe, expect, it } from "vitest";
import { guestActor } from "@/lib/auth/actor";
import type { PlayerView } from "@/lib/engine";
import { createMemoryContainer } from "@/lib/server/container";
import { ServiceError } from "@/lib/server/service-error";
import { fixtureCase, NOW } from "../../../tests/support/fixtures";

const LEARNER_A = guestActor("11111111-1111-4111-8111-111111111111");
const LEARNER_B = guestActor("22222222-2222-4222-8222-222222222222");

function setup(overrides: Parameters<typeof fixtureCase>[0] = {}) {
  const published = fixtureCase({ stages: 4, maxLives: 3, ...overrides });
  const draft = { ...fixtureCase({ id: "draft-case" }), publicationStatus: "DRAFT" as const };
  let n = 0;
  const container = createMemoryContainer({
    cases: [published, draft],
    clock: () => NOW,
    newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`,
  });
  return { ...container, published, draft };
}

let keyCounter = 0;
const key = () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++keyCounter).padStart(12, "0")}`;

/** Picks options using only what a real client sees (the view), plus the content for test intent. */
function pick(published: ReturnType<typeof setup>["published"], view: PlayerView, kind: "correct" | "wrong") {
  const stage = published.stages.find((s) => s.id === view.current!.stageId)!;
  const tried = new Set(view.current!.options.filter((o) => o.tried).map((o) => o.id));
  const option = stage.interaction.options.find((o) => (kind === "correct" ? o.isCorrect : !o.isCorrect && !tried.has(o.id)))!;
  return { submissionId: key(), stageId: stage.id, optionId: option.id, expectedRevision: view.revision };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("attempt service: server-authoritative play", () => {
  it("plays a full case: wrong → life lost → next stage → correct → result", async () => {
    const { attemptService, published } = setup();
    let view = await attemptService.startOrResume(LEARNER_A, published.slug);
    expect(view).toMatchObject({ status: "IN_PROGRESS", livesRemaining: 3, currentStageOrder: 1 });

    view = (await attemptService.submitAnswer(LEARNER_A, view.attemptId, pick(published, view, "wrong"))).view;
    expect(view).toMatchObject({ livesRemaining: 2, currentStageOrder: 2 });
    expect(view.clues).toHaveLength(1);

    view = (await attemptService.submitAnswer(LEARNER_A, view.attemptId, pick(published, view, "correct"))).view;
    expect(view.status).toBe("COMPLETED_SUCCESS");
    expect(view.result).toMatchObject({ correctAnswer: "SECRET-ANSWER", stageReached: 2, livesRemaining: 2 });
  });

  it("resumes the in-progress attempt instead of restoring lives (refresh / second Start)", async () => {
    const { attemptService, published } = setup();
    const first = await attemptService.startOrResume(LEARNER_A, published.slug);
    await attemptService.submitAnswer(LEARNER_A, first.attemptId, pick(published, first, "wrong"));
    const again = await attemptService.startOrResume(LEARNER_A, published.slug);
    expect(again.attemptId).toBe(first.attemptId);
    expect(again.livesRemaining).toBe(2);
    expect((await attemptService.getActiveView(LEARNER_A, published.slug))?.livesRemaining).toBe(2);
  });

  it("two simultaneous Start requests resolve to one attempt", async () => {
    const { attemptService, published } = setup();
    const [a, b] = await Promise.all([
      attemptService.startOrResume(LEARNER_A, published.slug),
      attemptService.startOrResume(LEARNER_A, published.slug),
    ]);
    expect(a.attemptId).toBe(b.attemptId);
  });

  it("starts a new attempt after the previous one is completed", async () => {
    const { attemptService, published } = setup();
    const first = await attemptService.startOrResume(LEARNER_A, published.slug);
    await attemptService.submitAnswer(LEARNER_A, first.attemptId, pick(published, first, "correct"));
    const second = await attemptService.startOrResume(LEARNER_A, published.slug);
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second.livesRemaining).toBe(3);
  });
});

describe("attempt service: security", () => {
  it("unpublished (draft) cases cannot be started and look the same as missing cases", async () => {
    const { attemptService, draft } = setup();
    await expectCode(attemptService.startOrResume(LEARNER_A, draft.slug), "CASE_UNAVAILABLE");
    await expectCode(attemptService.startOrResume(LEARNER_A, "no-such-case"), "CASE_UNAVAILABLE");
    expect(await attemptService.getActiveView(LEARNER_A, draft.slug)).toBeNull();
  });

  it("a learner cannot read or answer another learner's attempt", async () => {
    const { attemptService, published } = setup();
    const a = await attemptService.startOrResume(LEARNER_A, published.slug);
    await expectCode(attemptService.getView(LEARNER_B, a.attemptId), "ATTEMPT_NOT_FOUND");
    await expectCode(attemptService.submitAnswer(LEARNER_B, a.attemptId, pick(published, a, "correct")), "ATTEMPT_NOT_FOUND");
    expect((await attemptService.getView(LEARNER_A, a.attemptId)).livesRemaining).toBe(3);
  });

  it("cannot submit after completion", async () => {
    const { attemptService, published } = setup();
    const a = await attemptService.startOrResume(LEARNER_A, published.slug);
    const done = (await attemptService.submitAnswer(LEARNER_A, a.attemptId, pick(published, a, "correct"))).view;
    const stage = published.stages[0]!;
    await expectCode(
      attemptService.submitAnswer(LEARNER_A, a.attemptId, {
        submissionId: key(),
        stageId: stage.id,
        optionId: stage.interaction.options[0]!.id,
        expectedRevision: done.revision,
      }),
      "ATTEMPT_COMPLETED",
    );
  });

  it("cannot skip to a future stage", async () => {
    const { attemptService, published } = setup();
    const a = await attemptService.startOrResume(LEARNER_A, published.slug);
    const future = published.stages[3]!;
    await expectCode(
      attemptService.submitAnswer(LEARNER_A, a.attemptId, {
        submissionId: key(),
        stageId: future.id,
        optionId: future.interaction.options.find((o) => o.isCorrect)!.id,
        expectedRevision: a.revision,
      }),
      "INVALID_STAGE",
    );
  });

  it("concurrent duplicate submissions consume only one life", async () => {
    const { attemptService, published, attempts } = setup();
    const a = await attemptService.startOrResume(LEARNER_A, published.slug);
    const submission = pick(published, a, "wrong");
    const results = await Promise.allSettled([
      attemptService.submitAnswer(LEARNER_A, a.attemptId, submission),
      attemptService.submitAnswer(LEARNER_A, a.attemptId, submission),
      attemptService.submitAnswer(LEARNER_A, a.attemptId, { ...submission, submissionId: key() }),
    ]);
    const stored = await attempts.findById(a.attemptId);
    expect(stored?.livesRemaining).toBe(2);
    expect(stored?.answers).toHaveLength(1);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(2);
    const rejected = results.filter((r) => r.status === "rejected");
    rejected.forEach((r) => expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "STALE_STATE" }));
  });

  it("rejects play once a case is unpublished mid-attempt", async () => {
    const { attemptService, published, cases } = setup();
    const a = await attemptService.startOrResume(LEARNER_A, published.slug);
    const live = cases as unknown as { cases: { publicationStatus: string }[] };
    live.cases.find((c) => (c as unknown as { id: string }).id === published.id)!.publicationStatus = "ARCHIVED";
    await expectCode(attemptService.submitAnswer(LEARNER_A, a.attemptId, pick(published, a, "correct")), "CASE_UNAVAILABLE");
  });

  it("the view returned after a wrong answer contains only the next permitted stage", async () => {
    const { attemptService, published } = setup();
    const a = await attemptService.startOrResume(LEARNER_A, published.slug);
    const { view } = await attemptService.submitAnswer(LEARNER_A, a.attemptId, pick(published, a, "wrong"));
    const json = JSON.stringify(view);
    expect(view.current?.stageId).toBe(published.stages[1]!.id);
    for (const future of published.stages.slice(2)) {
      expect(json).not.toContain(future.content);
      expect(json).not.toContain(future.id);
    }
    expect(json).not.toContain("isCorrect");
  });
});
