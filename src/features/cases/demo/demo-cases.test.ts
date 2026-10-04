import { describe, expect, it } from "vitest";
import { isAnswerRevealed } from "@/lib/engine";
import { play, startedAttempt, wrongOptionId } from "../../../../tests/support/fixtures";
import { DEMO_CASES } from "./demo-cases";

const bySlug = (slug: string) => {
  const c = DEMO_CASES.find((x) => x.slug === slug);
  if (!c) throw new Error(`missing demo case ${slug}`);
  return c;
};

/** Plays every demo case through the real engine so each configured behaviour is shown to be reachable. */
describe("demo cases played through the engine", () => {
  it("every published demo case can be solved at the first clue", () => {
    for (const c of DEMO_CASES.filter((x) => x.publicationStatus === "PUBLISHED")) {
      const end = play(c, startedAttempt(c), ["correct"]);
      expect(end.status).toBe("COMPLETED_SUCCESS");
      expect(end.livesRemaining).toBe(c.maxLives);
    }
  });

  it("A · 2 stages, 3 lives: a wrong final answer ends the case and reveals the answer (REVEAL_ANSWER)", () => {
    const c = bySlug("demo-numb-little-finger");
    const end = play(c, startedAttempt(c), ["wrong", "wrong"]);
    expect(end).toMatchObject({ status: "COMPLETED_FAILED", completionReason: "FINAL_STAGE_REVEAL", livesRemaining: 1 });
    expect(isAnswerRevealed(end)).toBe(true);
  });

  it("B · 5 stages, 5 lives: five wrong answers run out of lives on the last clue", () => {
    const c = bySlug("demo-ring-shaped-rash");
    const end = play(c, startedAttempt(c), ["wrong", "wrong", "wrong", "wrong", "wrong"]);
    expect(end).toMatchObject({ completionReason: "OUT_OF_LIVES", currentStageIndex: 4 });
  });

  it("C · 7 stages, 5 lives, free first clue: lives run out at clue 6", () => {
    const c = bySlug("demo-tired-and-cold");
    const end = play(c, startedAttempt(c), Array.from({ length: 6 }, () => "wrong" as const));
    expect(end).toMatchObject({ completionReason: "OUT_OF_LIVES", currentStageIndex: 5, livesRemaining: 0 });
  });

  it("D · materia medica: wrong final answers are struck out until only the answer is left (RETRY_FINAL_STAGE)", () => {
    const c = bySlug("demo-stiff-on-rising");
    const atEnd = play(c, startedAttempt(c), ["wrong", "wrong", "wrong", "wrong"]);
    expect(atEnd).toMatchObject({ status: "IN_PROGRESS", currentStageIndex: 2, livesRemaining: 1 });
    expect(() => wrongOptionId(c, atEnd)).toThrow("no untried wrong option left");
    expect(play(c, atEnd, ["correct"]).status).toBe("COMPLETED_SUCCESS");
  });

  it("E · repertory: a wrong final answer ends the case without revealing the answer (END_CASE)", () => {
    const c = bySlug("demo-headache-from-the-sun");
    const end = play(c, startedAttempt(c), ["wrong", "wrong", "wrong"]);
    expect(end).toMatchObject({ completionReason: "FINAL_STAGE_END", livesRemaining: 1 });
    expect(isAnswerRevealed(end)).toBe(false);
  });
});
