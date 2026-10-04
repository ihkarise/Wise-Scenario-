import { beginAttempt, createAttempt, currentStage, submitAnswer, triedOptionIds, type SubmitOutcome } from "@/lib/engine";
import type { CaseAttempt, CaseDefinition, Difficulty, TerminalBehavior } from "@/lib/engine/types";
import { parseCaseDefinition } from "@/lib/schemas/case";

export const NOW = new Date("2026-10-04T10:00:00.000Z");

/**
 * Builds a valid synthetic case. Stage i has a different number of options (2–5) and its correct
 * option sits at a different position, so tests never accidentally depend on "always 4, always B".
 */
export function fixtureCase(
  options: {
    stages?: number;
    maxLives?: number;
    terminalBehavior?: TerminalBehavior;
    difficulty?: Difficulty;
    lifeCosts?: number[];
    revealCorrectOptionOnWrong?: boolean;
    showPreviousClues?: boolean;
    id?: string;
  } = {},
): CaseDefinition {
  const stageCount = options.stages ?? 3;
  const id = options.id ?? "case-fx";
  return parseCaseDefinition({
    id,
    slug: `${id}-slug`,
    caseNumber: 42,
    version: 1,
    title: "Fixture case",
    summary: "Synthetic test case.",
    domain: "Testing",
    category: "Fixtures",
    difficulty: options.difficulty ?? "INTERMEDIATE",
    publicationStatus: "PUBLISHED",
    maxLives: options.maxLives ?? 5,
    terminalBehavior: options.terminalBehavior ?? "REVEAL_ANSWER",
    completionMode: "FIRST_CORRECT",
    revealCorrectOptionOnWrong: options.revealCorrectOptionOnWrong ?? false,
    stages: Array.from({ length: stageCount }, (_, i) => {
      const optionCount = 2 + ((i + 2) % 4); // 4,5,2,3,4,5 …
      const correctIndex = i % optionCount;
      return {
        id: `${id}-s${i + 1}`,
        order: i + 1,
        title: `Stage ${i + 1} title`,
        content: `SECRET-CLUE-${i + 1}`,
        question: `Question ${i + 1}?`,
        media: [],
        lifeCost: options.lifeCosts?.[i] ?? 1,
        showPreviousClues: options.showPreviousClues ?? true,
        interaction: {
          type: "SINGLE_CHOICE",
          options: Array.from({ length: optionCount }, (_, j) => ({
            id: `${id}-s${i + 1}-o${j + 1}`,
            label: `Option ${i + 1}.${j + 1}${j === correctIndex ? " CORRECT-LABEL" : ""}`,
            isCorrect: j === correctIndex,
          })),
        },
      };
    }),
    teaching: {
      answerLabel: "SECRET-ANSWER",
      finalExplanation: "SECRET-EXPLANATION",
      keyClues: ["Key clue"],
      learningPoints: ["Learning point"],
      differentials: [{ label: "Other", reason: "Because" }],
    },
    references: [{ id: "ref-1", title: "Placeholder reference", isPlaceholder: true }],
    isDemo: true,
  });
}

let counter = 0;
/** Deterministic UUID-shaped idempotency keys. */
export function sid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

export function startedAttempt(caseDef: CaseDefinition, ownerId = "owner-1"): CaseAttempt {
  return beginAttempt(createAttempt(caseDef, { attemptId: "attempt-1", ownerId }), NOW);
}

export function correctOptionId(caseDef: CaseDefinition, attempt: CaseAttempt): string {
  const option = currentStage(caseDef, attempt).interaction.options.find((o) => o.isCorrect);
  if (!option) throw new Error("fixture stage has no correct option");
  return option.id;
}

export function wrongOptionId(caseDef: CaseDefinition, attempt: CaseAttempt): string {
  const stage = currentStage(caseDef, attempt);
  const tried = triedOptionIds(attempt, stage.id);
  const option = stage.interaction.options.find((o) => !o.isCorrect && !tried.includes(o.id));
  if (!option) throw new Error("no untried wrong option left");
  return option.id;
}

export function answer(caseDef: CaseDefinition, attempt: CaseAttempt, pick: "correct" | "wrong"): SubmitOutcome {
  const optionId = pick === "correct" ? correctOptionId(caseDef, attempt) : wrongOptionId(caseDef, attempt);
  return submitAnswer(
    caseDef,
    attempt,
    { submissionId: sid(), stageId: currentStage(caseDef, attempt).id, optionId, expectedRevision: attempt.revision },
    { now: NOW },
  );
}

/** Applies picks in order, asserting each is accepted, and returns the final attempt. */
export function play(caseDef: CaseDefinition, attempt: CaseAttempt, picks: ("correct" | "wrong")[]): CaseAttempt {
  return picks.reduce((current, pick) => {
    const outcome = answer(caseDef, current, pick);
    if (!outcome.ok) throw new Error(`pick rejected: ${outcome.error.code}`);
    return outcome.attempt;
  }, attempt);
}
