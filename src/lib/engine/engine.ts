import { engineError, type EngineError } from "./errors";
import { calculateScore, type ScoringRules } from "./scoring";
import type {
  AnswerOption,
  AnswerRecord,
  AnswerSubmission,
  CaseAttempt,
  CaseDefinition,
  CaseProgression,
  CaseStage,
  CaseState,
} from "./types";

/**
 * The WiseCases case engine. Pure functions only: no I/O, no clocks, no randomness, no React.
 * The server loads content + attempt, calls these functions, and persists the returned attempt.
 *
 * State machine (see docs/ARCHITECTURE.md):
 *
 *   NOT_STARTED ──begin──► IN_PROGRESS ──submit──► ANSWER_SUBMITTED (transient)
 *     ANSWER_SUBMITTED + correct                              → COMPLETED_SUCCESS
 *     ANSWER_SUBMITTED + wrong + lives = 0                    → COMPLETED_FAILED (answer revealed)
 *     ANSWER_SUBMITTED + wrong + lives > 0 + next stage       → IN_PROGRESS at the next stage
 *     ANSWER_SUBMITTED + wrong + lives > 0 + final stage      → per case.terminalBehavior
 */

export type CreateAttemptInput = { attemptId: string; ownerId: string };

/** Sorted copy of the stages. Order is defined by `stage.order`, never by array position in storage. */
export function orderedStages(caseDef: CaseDefinition): CaseStage[] {
  return [...caseDef.stages].sort((a, b) => a.order - b.order);
}

export function createAttempt(caseDef: CaseDefinition, input: CreateAttemptInput): CaseAttempt {
  return {
    id: input.attemptId,
    ownerId: input.ownerId,
    caseId: caseDef.id,
    caseVersion: caseDef.version,
    status: "NOT_STARTED",
    currentStageIndex: 0,
    livesRemaining: caseDef.maxLives,
    answers: [],
    score: null,
    completionReason: null,
    startedAt: null,
    completedAt: null,
    revision: 0,
  };
}

export function beginAttempt(attempt: CaseAttempt, now: Date): CaseAttempt {
  if (attempt.status !== "NOT_STARTED") return attempt;
  return { ...attempt, status: "IN_PROGRESS", startedAt: now.toISOString(), revision: attempt.revision + 1 };
}

export function currentStage(caseDef: CaseDefinition, attempt: CaseAttempt): CaseStage {
  const stage = orderedStages(caseDef)[attempt.currentStageIndex];
  if (!stage) throw new Error(`Attempt ${attempt.id} points at missing stage index ${attempt.currentStageIndex}`);
  return stage;
}

function stageOptions(stage: CaseStage): AnswerOption[] {
  switch (stage.interaction.type) {
    case "SINGLE_CHOICE":
      return stage.interaction.options;
  }
}

/** Option IDs the learner already tried (and got wrong) at the given stage in this attempt. */
export function triedOptionIds(attempt: CaseAttempt, stageId: string): string[] {
  return attempt.answers.filter((a) => a.stageId === stageId && !a.isCorrect).map((a) => a.optionId);
}

export function isCompleted(attempt: CaseAttempt): boolean {
  return attempt.status === "COMPLETED_SUCCESS" || attempt.status === "COMPLETED_FAILED";
}

export type SubmitOutcome =
  | {
      ok: true;
      duplicate: false;
      attempt: CaseAttempt;
      answer: AnswerRecord;
      progression: CaseProgression;
      /** States passed through, for logging and documentation. */
      trail: CaseState[];
    }
  | { ok: true; duplicate: true; attempt: CaseAttempt; answer: AnswerRecord }
  | { ok: false; error: EngineError };

export type SubmitContext = { now: Date; scoringRules?: ScoringRules };

export function submitAnswer(
  caseDef: CaseDefinition,
  attempt: CaseAttempt,
  submission: AnswerSubmission,
  context: SubmitContext,
): SubmitOutcome {
  // 1. Idempotency: the same submission ID returns the original result and changes nothing.
  const previous = attempt.answers.find((a) => a.submissionId === submission.submissionId);
  if (previous) {
    if (previous.stageId !== submission.stageId || previous.optionId !== submission.optionId) {
      return fail("IDEMPOTENCY_KEY_REUSED", "Submission ID was already used for a different answer");
    }
    return { ok: true, duplicate: true, attempt, answer: previous };
  }

  // 2. The attempt must be playable.
  if (attempt.caseId !== caseDef.id || attempt.caseVersion !== caseDef.version) {
    return fail("CASE_VERSION_MISMATCH", "Attempt does not belong to this case version");
  }
  if (attempt.status === "NOT_STARTED") return fail("ATTEMPT_NOT_STARTED", "Attempt has not been started");
  if (isCompleted(attempt)) return fail("ATTEMPT_COMPLETED", "Attempt is already completed");
  if (attempt.livesRemaining <= 0) return fail("NO_LIVES_REMAINING", "Attempt has no lives remaining");

  // 3. The learner must be answering what they were actually shown.
  if (submission.expectedRevision !== attempt.revision) {
    return fail("STALE_STATE", `Expected revision ${attempt.revision}, got ${submission.expectedRevision}`);
  }
  const stages = orderedStages(caseDef);
  const stage = currentStage(caseDef, attempt);
  if (submission.stageId !== stage.id) {
    return fail("STAGE_MISMATCH", "Submitted stage is not the current stage");
  }

  // 4. The option must belong to this stage and not have been tried already.
  const option = stageOptions(stage).find((o) => o.id === submission.optionId);
  if (!option) {
    const elsewhere = stages.some((s) => s.id !== stage.id && stageOptions(s).some((o) => o.id === submission.optionId));
    return elsewhere
      ? fail("OPTION_NOT_IN_STAGE", "Option belongs to a different stage")
      : fail("OPTION_NOT_FOUND", "Option does not exist");
  }
  if (triedOptionIds(attempt, stage.id).includes(option.id)) {
    return fail("OPTION_ALREADY_TRIED", "Option was already tried at this stage");
  }

  // 5. Apply the answer.
  const livesBefore = attempt.livesRemaining;
  const livesAfter = option.isCorrect ? livesBefore : Math.max(0, livesBefore - stage.lifeCost);
  const answer: AnswerRecord = {
    submissionId: submission.submissionId,
    sequence: attempt.answers.length + 1,
    stageId: stage.id,
    stageOrder: stage.order,
    optionId: option.id,
    isCorrect: option.isCorrect,
    livesBefore,
    livesAfter,
    answeredAt: context.now.toISOString(),
  };
  const base: CaseAttempt = {
    ...attempt,
    answers: [...attempt.answers, answer],
    livesRemaining: livesAfter,
    revision: attempt.revision + 1,
  };
  const livesLost = livesBefore - livesAfter;
  const trailStart: CaseState[] = ["IN_PROGRESS", "ANSWER_SUBMITTED"];

  if (option.isCorrect) {
    const score = calculateScore(
      {
        difficulty: caseDef.difficulty,
        stageIndexSolved: attempt.currentStageIndex,
        stageCount: stages.length,
        livesRemaining: livesAfter,
        maxLives: caseDef.maxLives,
      },
      context.scoringRules,
    );
    return {
      ok: true,
      duplicate: false,
      answer,
      progression: { type: "SOLVED", stageId: stage.id },
      trail: [...trailStart, "COMPLETED_SUCCESS"],
      attempt: complete(base, "COMPLETED_SUCCESS", "SOLVED", score, context.now),
    };
  }

  const failed = (reason: Exclude<CaseAttempt["completionReason"], "SOLVED" | null>): SubmitOutcome => ({
    ok: true,
    duplicate: false,
    answer,
    progression: { type: "FAILED", reason, stageId: stage.id, livesLost },
    trail: [...trailStart, "COMPLETED_FAILED"],
    attempt: complete(base, "COMPLETED_FAILED", reason, 0, context.now),
  });

  if (livesAfter === 0) return failed("OUT_OF_LIVES");

  const nextStage = stages[attempt.currentStageIndex + 1];
  if (nextStage) {
    return {
      ok: true,
      duplicate: false,
      answer,
      progression: { type: "ADVANCED", fromStageId: stage.id, toStageId: nextStage.id, livesLost },
      trail: [...trailStart, "IN_PROGRESS"],
      attempt: { ...base, currentStageIndex: attempt.currentStageIndex + 1 },
    };
  }

  // Final stage answered wrongly with lives remaining.
  const retry = (): SubmitOutcome => ({
    ok: true,
    duplicate: false,
    answer,
    progression: { type: "RETRY_FINAL_STAGE", stageId: stage.id, livesLost },
    trail: [...trailStart, "IN_PROGRESS"],
    attempt: base,
  });

  switch (caseDef.terminalBehavior) {
    case "REVEAL_ANSWER":
      return failed("FINAL_STAGE_REVEAL");
    case "END_CASE":
      return failed("FINAL_STAGE_END");
    case "RETRY_FINAL_STAGE":
      // Finite: every wrong pick is struck out, and every retry costs lifeCost.
      return retry();
    case "ALLOW_FINAL_ATTEMPT":
      return triedOptionIds(attempt, stage.id).length === 0 ? retry() : failed("FINAL_ATTEMPT_USED");
  }
}

function complete(
  attempt: CaseAttempt,
  status: "COMPLETED_SUCCESS" | "COMPLETED_FAILED",
  reason: NonNullable<CaseAttempt["completionReason"]>,
  score: number,
  now: Date,
): CaseAttempt {
  return { ...attempt, status, completionReason: reason, score, completedAt: now.toISOString() };
}

function fail(code: EngineError["code"], detail: string): SubmitOutcome {
  return { ok: false, error: engineError(code, detail) };
}

/** Whether the learner may see the correct answer and teaching content for a completed attempt. */
export function isAnswerRevealed(attempt: CaseAttempt): boolean {
  if (attempt.status === "COMPLETED_SUCCESS") return true;
  if (attempt.status !== "COMPLETED_FAILED") return false;
  return attempt.completionReason !== "FINAL_STAGE_END";
}
