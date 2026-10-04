import { describe, expect, it } from "vitest";
import { answer, correctOptionId, fixtureCase, NOW, play, sid, startedAttempt, wrongOptionId } from "../../../tests/support/fixtures";
import { createAttempt, currentStage, isAnswerRevealed, orderedStages, submitAnswer, type SubmitOutcome } from "./engine";
import type { CaseAttempt, TerminalBehavior } from "./types";

function accepted(outcome: SubmitOutcome) {
  if (!outcome.ok) throw new Error(`expected acceptance, got ${outcome.error.code}`);
  if (outcome.duplicate) throw new Error("expected a fresh answer, got a duplicate");
  return outcome;
}
function rejected(outcome: SubmitOutcome) {
  if (outcome.ok) throw new Error("expected rejection");
  return outcome.error.code;
}

describe("case engine: mandatory behaviour", () => {
  it("1. a correct answer completes the case", () => {
    const c = fixtureCase();
    const result = accepted(answer(c, startedAttempt(c), "correct"));
    expect(result.attempt.status).toBe("COMPLETED_SUCCESS");
    expect(result.attempt.completionReason).toBe("SOLVED");
    expect(result.attempt.completedAt).toBe(NOW.toISOString());
    expect(result.progression).toEqual({ type: "SOLVED", stageId: c.stages[0]!.id });
    expect(result.trail).toEqual(["IN_PROGRESS", "ANSWER_SUBMITTED", "COMPLETED_SUCCESS"]);
  });

  it("2. a wrong answer consumes exactly one life", () => {
    const c = fixtureCase({ maxLives: 5 });
    const result = accepted(answer(c, startedAttempt(c), "wrong"));
    expect(result.attempt.livesRemaining).toBe(4);
    expect(result.answer).toMatchObject({ isCorrect: false, livesBefore: 5, livesAfter: 4 });
  });

  it("3. a wrong answer advances to the next stage", () => {
    const c = fixtureCase({ stages: 3 });
    const result = accepted(answer(c, startedAttempt(c), "wrong"));
    expect(result.attempt.status).toBe("IN_PROGRESS");
    expect(result.attempt.currentStageIndex).toBe(1);
    expect(result.progression).toMatchObject({ type: "ADVANCED", fromStageId: c.stages[0]!.id, toStageId: c.stages[1]!.id });
    expect(result.trail).toEqual(["IN_PROGRESS", "ANSWER_SUBMITTED", "IN_PROGRESS"]);
  });

  it("4. different stages can contain different options", () => {
    const c = fixtureCase({ stages: 4 });
    const optionSets = orderedStages(c).map((s) => s.interaction.options.map((o) => o.id));
    expect(new Set(optionSets.map((s) => s.length)).size).toBeGreaterThan(1);
    for (let i = 0; i < optionSets.length; i++) {
      for (let j = i + 1; j < optionSets.length; j++) {
        expect(optionSets[i]!.some((id) => optionSets[j]!.includes(id))).toBe(false);
      }
    }
    // The engine serves the option set of whichever stage is current.
    const atStage2 = play(c, startedAttempt(c), ["wrong"]);
    expect(currentStage(c, atStage2).interaction.options.map((o) => o.id)).toEqual(optionSets[1]);
  });

  it("5. five lives allow exactly five wrong answers", () => {
    const c = fixtureCase({ stages: 6, maxLives: 5 });
    let attempt = startedAttempt(c);
    for (let i = 1; i <= 4; i++) {
      attempt = accepted(answer(c, attempt, "wrong")).attempt;
      expect(attempt.status).toBe("IN_PROGRESS");
      expect(attempt.livesRemaining).toBe(5 - i);
    }
    const fifth = accepted(answer(c, attempt, "wrong"));
    expect(fifth.attempt.livesRemaining).toBe(0);
    expect(fifth.attempt.status).toBe("COMPLETED_FAILED");
    expect(fifth.attempt.answers).toHaveLength(5);
  });

  it("6. zero lives ends the case as failed and reveals the answer", () => {
    const c = fixtureCase({ stages: 5, maxLives: 2 });
    const end = accepted(answer(c, play(c, startedAttempt(c), ["wrong"]), "wrong"));
    expect(end.attempt.status).toBe("COMPLETED_FAILED");
    expect(end.attempt.completionReason).toBe("OUT_OF_LIVES");
    expect(end.attempt.score).toBe(0);
    expect(end.attempt.currentStageIndex).toBe(1);
    expect(end.progression).toMatchObject({ type: "FAILED", reason: "OUT_OF_LIVES" });
    expect(isAnswerRevealed(end.attempt)).toBe(true);
  });

  it("7. a correct answer does not consume a life", () => {
    const c = fixtureCase({ maxLives: 4 });
    const afterWrong = play(c, startedAttempt(c), ["wrong"]);
    const result = accepted(answer(c, afterWrong, "correct"));
    expect(result.attempt.livesRemaining).toBe(3);
    expect(result.answer).toMatchObject({ isCorrect: true, livesBefore: 3, livesAfter: 3 });
  });

  it("8. a completed case cannot accept another answer", () => {
    const c = fixtureCase();
    const solved = play(c, startedAttempt(c), ["correct"]);
    expect(rejected(answer(c, solved, "wrong"))).toBe("ATTEMPT_COMPLETED");

    const oneLife = fixtureCase({ maxLives: 1 });
    const out = play(oneLife, startedAttempt(oneLife), ["wrong"]);
    expect(out.status).toBe("COMPLETED_FAILED");
    expect(rejected(answer(oneLife, out, "correct"))).toBe("ATTEMPT_COMPLETED");
  });

  describe("9. final-stage behaviour (wrong answer on the last stage with lives remaining)", () => {
    const atFinal = (terminalBehavior: TerminalBehavior) => {
      const c = fixtureCase({ stages: 2, maxLives: 5, terminalBehavior });
      return { c, attempt: play(c, startedAttempt(c), ["wrong"]) };
    };

    it("REVEAL_ANSWER (default) ends the case and reveals the answer", () => {
      const { c, attempt } = atFinal("REVEAL_ANSWER");
      const r = accepted(answer(c, attempt, "wrong"));
      expect(r.attempt).toMatchObject({ status: "COMPLETED_FAILED", completionReason: "FINAL_STAGE_REVEAL", livesRemaining: 3 });
      expect(isAnswerRevealed(r.attempt)).toBe(true);
    });

    it("REVEAL_ANSWER is the default for demo content built without a setting", () => {
      expect(fixtureCase().terminalBehavior).toBe("REVEAL_ANSWER");
    });

    it("END_CASE ends the case without revealing the answer", () => {
      const { c, attempt } = atFinal("END_CASE");
      const r = accepted(answer(c, attempt, "wrong"));
      expect(r.attempt).toMatchObject({ status: "COMPLETED_FAILED", completionReason: "FINAL_STAGE_END" });
      expect(isAnswerRevealed(r.attempt)).toBe(false);
    });

    it("RETRY_FINAL_STAGE keeps the learner on the final stage until correct", () => {
      const { c, attempt } = atFinal("RETRY_FINAL_STAGE");
      const retry = accepted(answer(c, attempt, "wrong"));
      expect(retry.progression).toMatchObject({ type: "RETRY_FINAL_STAGE", livesLost: 1 });
      expect(retry.attempt).toMatchObject({ status: "IN_PROGRESS", currentStageIndex: 1, livesRemaining: 3 });
      const solved = accepted(answer(c, retry.attempt, "correct"));
      expect(solved.attempt.status).toBe("COMPLETED_SUCCESS");
    });

    it("RETRY_FINAL_STAGE is finite: it ends when lives run out", () => {
      const c = fixtureCase({ stages: 2, maxLives: 3, terminalBehavior: "RETRY_FINAL_STAGE" });
      // Stage 2 has 5 options (4 wrong). 3 lives: stage-1 wrong, then 2 wrong at the final stage.
      const end = play(c, startedAttempt(c), ["wrong", "wrong", "wrong"]);
      expect(end).toMatchObject({ status: "COMPLETED_FAILED", completionReason: "OUT_OF_LIVES", livesRemaining: 0 });
    });

    it("RETRY_FINAL_STAGE rejects re-choosing an option already tried", () => {
      const { c, attempt } = atFinal("RETRY_FINAL_STAGE");
      const tried = wrongOptionId(c, attempt);
      const first = accepted(
        submitAnswer(c, attempt, { submissionId: sid(), stageId: c.stages[1]!.id, optionId: tried, expectedRevision: attempt.revision }, { now: NOW }),
      );
      const again = submitAnswer(
        c,
        first.attempt,
        { submissionId: sid(), stageId: c.stages[1]!.id, optionId: tried, expectedRevision: first.attempt.revision },
        { now: NOW },
      );
      expect(rejected(again)).toBe("OPTION_ALREADY_TRIED");
    });

    it("ALLOW_FINAL_ATTEMPT gives exactly one more try, then reveals", () => {
      const { c, attempt } = atFinal("ALLOW_FINAL_ATTEMPT");
      const second = accepted(answer(c, attempt, "wrong"));
      expect(second.progression.type).toBe("RETRY_FINAL_STAGE");
      const third = accepted(answer(c, second.attempt, "wrong"));
      expect(third.attempt).toMatchObject({ status: "COMPLETED_FAILED", completionReason: "FINAL_ATTEMPT_USED", livesRemaining: 2 });
      expect(isAnswerRevealed(third.attempt)).toBe(true);
    });

    it("running out of lives on the final stage always reveals, whatever the setting", () => {
      for (const behavior of ["REVEAL_ANSWER", "END_CASE", "RETRY_FINAL_STAGE", "ALLOW_FINAL_ATTEMPT"] as const) {
        const c = fixtureCase({ stages: 2, maxLives: 2, terminalBehavior: behavior });
        const end = play(c, startedAttempt(c), ["wrong", "wrong"]);
        expect(end.completionReason).toBe("OUT_OF_LIVES");
        expect(isAnswerRevealed(end)).toBe(true);
      }
    });
  });

  it("10. a double submission does not consume two lives", () => {
    const c = fixtureCase({ maxLives: 5 });
    const attempt = startedAttempt(c);
    const submission = {
      submissionId: sid(),
      stageId: c.stages[0]!.id,
      optionId: wrongOptionId(c, attempt),
      expectedRevision: attempt.revision,
    };
    const first = accepted(submitAnswer(c, attempt, submission, { now: NOW }));

    // Same idempotency key re-sent (network retry / double click): original result, no change.
    const replay = submitAnswer(c, first.attempt, submission, { now: NOW });
    expect(replay.ok && replay.duplicate).toBe(true);
    if (replay.ok) expect(replay.attempt).toBe(first.attempt);

    // A second click with a new key but the old revision is rejected as stale.
    const secondClick = submitAnswer(c, first.attempt, { ...submission, submissionId: sid() }, { now: NOW });
    expect(rejected(secondClick)).toBe("STALE_STATE");
    expect(first.attempt.livesRemaining).toBe(4);
    expect(first.attempt.answers).toHaveLength(1);
  });

  it("10b. reusing an idempotency key for a different answer is rejected", () => {
    const c = fixtureCase();
    const attempt = startedAttempt(c);
    const key = sid();
    const first = accepted(
      submitAnswer(c, attempt, { submissionId: key, stageId: c.stages[0]!.id, optionId: wrongOptionId(c, attempt), expectedRevision: 1 }, { now: NOW }),
    );
    const misuse = submitAnswer(
      c,
      first.attempt,
      { submissionId: key, stageId: c.stages[1]!.id, optionId: correctOptionId(c, first.attempt), expectedRevision: first.attempt.revision },
      { now: NOW },
    );
    expect(rejected(misuse)).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("11. variable stage counts work (2, 5, 7 and 10 stages)", () => {
    for (const stages of [2, 5, 7, 10]) {
      const c = fixtureCase({ stages, maxLives: stages + 1 });
      const wrongs = Array.from({ length: stages - 1 }, () => "wrong" as const);
      const atLast = play(c, startedAttempt(c), wrongs);
      expect(atLast.currentStageIndex).toBe(stages - 1);
      expect(currentStage(c, atLast).order).toBe(stages);
      expect(play(c, atLast, ["correct"]).status).toBe("COMPLETED_SUCCESS");
    }
  });

  it("12. variable maximum lives work (1, 3, 7)", () => {
    for (const maxLives of [1, 3, 7]) {
      const c = fixtureCase({ stages: 10, maxLives });
      const attempt = startedAttempt(c);
      expect(attempt.livesRemaining).toBe(maxLives);
      const end = play(c, attempt, Array.from({ length: maxLives }, () => "wrong" as const));
      expect(end).toMatchObject({ status: "COMPLETED_FAILED", livesRemaining: 0, currentStageIndex: maxLives - 1 });
    }
  });

  it("13. score calculation is deterministic", () => {
    const c = fixtureCase({ stages: 4, maxLives: 5 });
    const run = () => play(c, startedAttempt(c), ["wrong", "wrong", "correct"]).score;
    // INTERMEDIATE: 1000 × 1.25 × (1 − 0.5 × 2/4) × (0.5 + 0.5 × 3/5) = 750
    expect(run()).toBe(750);
    expect(run()).toBe(run());
  });

  it("14. an invalid option ID is rejected without consuming a life", () => {
    const c = fixtureCase();
    const attempt = startedAttempt(c);
    const outcome = submitAnswer(
      c,
      attempt,
      { submissionId: sid(), stageId: c.stages[0]!.id, optionId: "does-not-exist", expectedRevision: attempt.revision },
      { now: NOW },
    );
    expect(rejected(outcome)).toBe("OPTION_NOT_FOUND");
  });

  it("15. an option belonging to another stage is rejected", () => {
    const c = fixtureCase();
    const attempt = startedAttempt(c);
    const futureCorrect = c.stages[1]!.interaction.options.find((o) => o.isCorrect)!.id;
    const outcome = submitAnswer(
      c,
      attempt,
      { submissionId: sid(), stageId: c.stages[0]!.id, optionId: futureCorrect, expectedRevision: attempt.revision },
      { now: NOW },
    );
    expect(rejected(outcome)).toBe("OPTION_NOT_IN_STAGE");
  });
});

describe("case engine: further rules", () => {
  it("rejects answers for a stage other than the current one (no skipping ahead)", () => {
    const c = fixtureCase({ stages: 4 });
    const attempt = startedAttempt(c);
    const outcome = submitAnswer(
      c,
      attempt,
      { submissionId: sid(), stageId: c.stages[3]!.id, optionId: c.stages[3]!.interaction.options[0]!.id, expectedRevision: attempt.revision },
      { now: NOW },
    );
    expect(rejected(outcome)).toBe("STAGE_MISMATCH");
  });

  it("rejects answers before the attempt is started", () => {
    const c = fixtureCase();
    const fresh = createAttempt(c, { attemptId: "a", ownerId: "o" });
    const outcome = submitAnswer(
      c,
      fresh,
      { submissionId: sid(), stageId: c.stages[0]!.id, optionId: c.stages[0]!.interaction.options[0]!.id, expectedRevision: 0 },
      { now: NOW },
    );
    expect(rejected(outcome)).toBe("ATTEMPT_NOT_STARTED");
  });

  it("rejects an attempt pinned to a different case version", () => {
    const c = fixtureCase();
    const attempt: CaseAttempt = { ...startedAttempt(c), caseVersion: 2 };
    expect(rejected(answer(c, attempt, "correct"))).toBe("CASE_VERSION_MISMATCH");
  });

  it("a stage with life cost 0 is a free guess", () => {
    const c = fixtureCase({ stages: 3, maxLives: 2, lifeCosts: [0, 1, 1] });
    const r = accepted(answer(c, startedAttempt(c), "wrong"));
    expect(r.attempt.livesRemaining).toBe(2);
    expect(r.attempt.currentStageIndex).toBe(1);
  });

  it("a life cost above 1 removes that many lives", () => {
    const c = fixtureCase({ stages: 3, maxLives: 5, lifeCosts: [2, 1, 1] });
    expect(accepted(answer(c, startedAttempt(c), "wrong")).attempt.livesRemaining).toBe(3);
  });

  it("orders stages by their order field, not storage position", () => {
    const c = fixtureCase({ stages: 3 });
    const shuffled = { ...c, stages: [c.stages[2]!, c.stages[0]!, c.stages[1]!] };
    expect(currentStage(shuffled, startedAttempt(shuffled)).id).toBe(c.stages[0]!.id);
  });

  it("does not mutate the attempt it was given", () => {
    const c = fixtureCase();
    const attempt = startedAttempt(c);
    const snapshot = structuredClone(attempt);
    answer(c, attempt, "wrong");
    expect(attempt).toEqual(snapshot);
  });

  it("increments the revision and sequence on every accepted answer", () => {
    const c = fixtureCase({ stages: 3 });
    const end = play(c, startedAttempt(c), ["wrong", "wrong"]);
    expect(end.revision).toBe(3);
    expect(end.answers.map((a) => a.sequence)).toEqual([1, 2]);
  });
});
