import { describe, expect, it } from "vitest";
import { fixtureCase, play, startedAttempt } from "../../../tests/support/fixtures";
import { toPlayerView } from "./view";

/** Serialise exactly what would be sent over HTTP. */
const wire = (value: unknown) => JSON.stringify(value);

describe("player view: what the browser may see", () => {
  it("never includes correctness flags on options, at any point of play", () => {
    const c = fixtureCase({ stages: 3, terminalBehavior: "RETRY_FINAL_STAGE" });
    for (const picks of [[], ["wrong"], ["wrong", "wrong"], ["wrong", "wrong", "wrong"]] as const) {
      expect(wire(toPlayerView(c, play(c, startedAttempt(c), [...picks])))).not.toContain("isCorrect");
    }
  });

  it("at stage 2, returns no content, questions or options from stages 3+", () => {
    const c = fixtureCase({ stages: 5 });
    const atStage2 = play(c, startedAttempt(c), ["wrong"]);
    const view = toPlayerView(c, atStage2);
    const json = wire(view);

    expect(view.currentStageOrder).toBe(2);
    expect(view.current?.stageId).toBe(c.stages[1]!.id);
    expect(view.clues.map((s) => s.order)).toEqual([1]);
    for (const future of c.stages.slice(2)) {
      expect(json).not.toContain(future.id);
      expect(json).not.toContain(future.content);
      expect(json).not.toContain(future.question);
      for (const o of future.interaction.options) expect(json).not.toContain(o.id);
    }
  });

  it("does not reveal the answer or teaching content while in progress", () => {
    const c = fixtureCase({ stages: 3 });
    const json = wire(toPlayerView(c, play(c, startedAttempt(c), ["wrong"])));
    expect(json).not.toContain("SECRET-ANSWER");
    expect(json).not.toContain("SECRET-EXPLANATION");
    expect(JSON.parse(json).result).toBeNull();
  });

  it("hides earlier clues when the stage is configured not to show them", () => {
    const c = fixtureCase({ stages: 3, showPreviousClues: false });
    const view = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "wrong"]));
    expect(view.clues).toEqual([]);
    expect(view.current?.order).toBe(3);
  });

  it("does not reveal the correct option after a wrong answer unless configured", () => {
    const off = fixtureCase();
    expect(toPlayerView(off, play(off, startedAttempt(off), ["wrong"])).lastAnswer).toMatchObject({
      wasCorrect: false,
      livesLost: 1,
      progression: "ADVANCED",
      correctOptionLabel: null,
    });
    const on = fixtureCase({ revealCorrectOptionOnWrong: true });
    expect(toPlayerView(on, play(on, startedAttempt(on), ["wrong"])).lastAnswer?.correctOptionLabel).toContain("CORRECT-LABEL");
  });

  it("marks options already tried on a final-stage retry", () => {
    const c = fixtureCase({ stages: 2, terminalBehavior: "RETRY_FINAL_STAGE" });
    const view = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "wrong"]));
    expect(view.lastAnswer?.progression).toBe("RETRY_FINAL_STAGE");
    expect(view.current?.options.filter((o) => o.tried)).toHaveLength(1);
  });

  it("on failure, returns the answer, explanation, references, history, stage reached and score", () => {
    const c = fixtureCase({ stages: 5, maxLives: 2 });
    const view = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "wrong"]));
    expect(view.current).toBeNull();
    expect(view.result).toMatchObject({
      status: "COMPLETED_FAILED",
      reason: "OUT_OF_LIVES",
      answerRevealed: true,
      correctAnswer: "SECRET-ANSWER",
      finalExplanation: "SECRET-EXPLANATION",
      learningPoints: ["Learning point"],
      stageReached: 2,
      stageCount: 5,
      score: 0,
      livesRemaining: 0,
    });
    expect(view.result?.references[0]).toMatchObject({ title: "Placeholder reference", isPlaceholder: true });
    expect(view.result?.history.map((h) => h.wasCorrect)).toEqual([false, false]);
    expect(view.result?.unseenClues.map((s) => s.order)).toEqual([3, 4, 5]);
  });

  it("on END_CASE failure, withholds the answer and teaching content", () => {
    const c = fixtureCase({ stages: 2, terminalBehavior: "END_CASE" });
    const view = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "wrong"]));
    const json = wire(view);
    expect(view.result).toMatchObject({ answerRevealed: false, correctAnswer: null, finalExplanation: null, unseenClues: [] });
    expect(json).not.toContain("SECRET-ANSWER");
    expect(json).not.toContain("SECRET-EXPLANATION");
  });

  it("on success, reports score and a share text without the answer", () => {
    const c = fixtureCase({ stages: 4, maxLives: 5 });
    const view = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "wrong", "correct"]));
    expect(view.result).toMatchObject({ status: "COMPLETED_SUCCESS", score: 750, correctAnswer: "SECRET-ANSWER" });
    expect(view.result?.shareText).toBe("WiseCases #0042\n🎯 3/4 clues\n❤️❤️❤️🤍🤍\nScore 750");
    expect(view.result?.shareText).not.toContain("SECRET-ANSWER");
  });
});
