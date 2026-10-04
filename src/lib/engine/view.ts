import { currentStage, isAnswerRevealed, isCompleted, orderedStages, triedOptionIds } from "./engine";
import type {
  AnswerRecord,
  AttemptStatus,
  CaseAttempt,
  CaseDefinition,
  CaseProgression,
  CaseResult,
  CompletionReason,
  Difficulty,
  Differential,
  StageMedia,
} from "./types";

/**
 * PlayerView is the ONLY shape of attempt data that leaves the server.
 *
 * Rules enforced here (and covered by tests):
 *  - no `isCorrect` flag on any option the learner can still choose;
 *  - no content, question or options from stages the learner has not reached;
 *  - no correct answer or teaching content until the attempt is completed and the answer is revealed;
 *  - lives, score, stage and status are reported, never accepted, by the server.
 */

export type PublicOption = { id: string; label: string; tried: boolean };

export type VisibleClue = {
  stageId: string;
  order: number;
  title: string;
  content: string;
  media: StageMedia[];
};

export type CurrentStageView = VisibleClue & {
  question: string;
  hint: string | null;
  options: PublicOption[];
  isFinalStage: boolean;
};

export type LastAnswerView = {
  optionId: string;
  optionLabel: string;
  stageOrder: number;
  /** Whether the learner's own last answer was right. (Named differently from content's `isCorrect` on purpose.) */
  wasCorrect: boolean;
  livesLost: number;
  progression: CaseProgression["type"];
  /** Only set when the case is configured to reveal the correct option after a wrong answer. */
  correctOptionLabel: string | null;
};

export type HistoryEntry = { stageOrder: number; stageTitle: string; optionLabel: string; wasCorrect: boolean };

export type PublicReference = {
  title: string;
  authors: string | null;
  source: string | null;
  year: number | null;
  url: string | null;
  doi: string | null;
  pages: string | null;
  isPlaceholder: boolean;
};

export type CaseResultView = CaseResult & {
  correctAnswer: string | null;
  finalExplanation: string | null;
  keyClues: string[];
  learningPoints: string[];
  differentials: Differential[];
  references: PublicReference[];
  history: HistoryEntry[];
  /** Stages the learner never reached; shown in the review only when the answer is revealed. */
  unseenClues: VisibleClue[];
  /** Share text that never contains the answer. */
  shareText: string;
};

export type PlayerCaseInfo = {
  slug: string;
  title: string;
  caseNumber: number;
  domain: string;
  category: string;
  difficulty: Difficulty;
  isDemo: boolean;
};

export type PlayerView = {
  attemptId: string;
  revision: number;
  status: AttemptStatus;
  case: PlayerCaseInfo;
  maxLives: number;
  livesRemaining: number;
  stageCount: number;
  /** 1-based order of the current (or last reached) stage. */
  currentStageOrder: number;
  /** Earlier clues the learner has already earned. Never contains future stages. */
  clues: VisibleClue[];
  current: CurrentStageView | null;
  lastAnswer: LastAnswerView | null;
  result: CaseResultView | null;
};

export function formatCaseNumber(caseNumber: number): string {
  return `#${String(caseNumber).padStart(4, "0")}`;
}

export function toPlayerView(caseDef: CaseDefinition, attempt: CaseAttempt): PlayerView {
  const stages = orderedStages(caseDef);
  const stage = currentStage(caseDef, attempt);
  const completed = isCompleted(attempt);
  const reached = stages.slice(0, attempt.currentStageIndex + 1);
  const toClue = (s: (typeof stages)[number]): VisibleClue => ({
    stageId: s.id,
    order: s.order,
    title: s.title,
    content: s.content,
    media: s.media,
  });

  const earlier = reached.slice(0, -1);
  const clues = completed || stage.showPreviousClues ? earlier.map(toClue) : [];

  let current: CurrentStageView | null = null;
  if (attempt.status === "IN_PROGRESS") {
    const tried = new Set(triedOptionIds(attempt, stage.id));
    current = {
      ...toClue(stage),
      question: stage.question,
      hint: stage.hint ?? null,
      isFinalStage: attempt.currentStageIndex === stages.length - 1,
      // Explicit field picking: `isCorrect` must never be spread into the view.
      options: stage.interaction.options.map((o) => ({ id: o.id, label: o.label, tried: tried.has(o.id) })),
    };
  }

  return {
    attemptId: attempt.id,
    revision: attempt.revision,
    status: attempt.status,
    case: {
      slug: caseDef.slug,
      title: caseDef.title,
      caseNumber: caseDef.caseNumber,
      domain: caseDef.domain,
      category: caseDef.category,
      difficulty: caseDef.difficulty,
      isDemo: caseDef.isDemo,
    },
    maxLives: caseDef.maxLives,
    livesRemaining: attempt.livesRemaining,
    stageCount: stages.length,
    currentStageOrder: stage.order,
    clues,
    current,
    lastAnswer: lastAnswerView(caseDef, attempt),
    result: completed ? resultView(caseDef, attempt) : null,
  };
}

function findOptionLabel(caseDef: CaseDefinition, optionId: string): string {
  for (const s of caseDef.stages) {
    const o = s.interaction.options.find((x) => x.id === optionId);
    if (o) return o.label;
  }
  return "Unknown option";
}

function lastAnswerView(caseDef: CaseDefinition, attempt: CaseAttempt): LastAnswerView | null {
  const last = attempt.answers.at(-1);
  if (!last) return null;
  const stage = caseDef.stages.find((s) => s.id === last.stageId);
  const correctOption = stage?.interaction.options.find((o) => o.isCorrect);
  return {
    optionId: last.optionId,
    optionLabel: findOptionLabel(caseDef, last.optionId),
    stageOrder: last.stageOrder,
    wasCorrect: last.isCorrect,
    livesLost: last.livesBefore - last.livesAfter,
    progression: progressionType(caseDef, attempt, last),
    correctOptionLabel:
      !last.isCorrect && caseDef.revealCorrectOptionOnWrong && correctOption ? correctOption.label : null,
  };
}

function progressionType(caseDef: CaseDefinition, attempt: CaseAttempt, last: AnswerRecord): CaseProgression["type"] {
  if (last.isCorrect) return "SOLVED";
  if (attempt.status === "COMPLETED_FAILED") return "FAILED";
  // Still on the stage that was just answered wrongly → final-stage retry; otherwise we moved on.
  return currentStage(caseDef, attempt).id === last.stageId ? "RETRY_FINAL_STAGE" : "ADVANCED";
}

function resultView(caseDef: CaseDefinition, attempt: CaseAttempt): CaseResultView {
  const stages = orderedStages(caseDef);
  const revealed = isAnswerRevealed(attempt);
  const reason = attempt.completionReason as CompletionReason;
  const t = caseDef.teaching;
  const stageTitle = (id: string) => stages.find((s) => s.id === id)?.title ?? "";
  const history: HistoryEntry[] = attempt.answers.map((a) => ({
    stageOrder: a.stageOrder,
    stageTitle: stageTitle(a.stageId),
    optionLabel: findOptionLabel(caseDef, a.optionId),
    wasCorrect: a.isCorrect,
  }));
  const status = attempt.status as CaseResult["status"];

  return {
    status,
    reason,
    score: attempt.score ?? 0,
    stageReached: attempt.currentStageIndex + 1,
    stageCount: stages.length,
    livesRemaining: attempt.livesRemaining,
    maxLives: caseDef.maxLives,
    answerRevealed: revealed,
    correctAnswer: revealed ? t.answerLabel : null,
    finalExplanation: revealed ? t.finalExplanation : null,
    keyClues: revealed ? t.keyClues : [],
    learningPoints: revealed ? t.learningPoints : [],
    differentials: revealed ? t.differentials : [],
    references: revealed
      ? caseDef.references.map((r) => ({
          title: r.title,
          authors: r.authors ?? null,
          source: r.source ?? null,
          year: r.year ?? null,
          url: r.url ?? null,
          doi: r.doi ?? null,
          pages: r.pages ?? null,
          isPlaceholder: r.isPlaceholder,
        }))
      : [],
    history,
    unseenClues: revealed
      ? stages.slice(attempt.currentStageIndex + 1).map((s) => ({
          stageId: s.id,
          order: s.order,
          title: s.title,
          content: s.content,
          media: s.media,
        }))
      : [],
    shareText: shareText(caseDef, attempt, stages.length),
  };
}

export function shareText(caseDef: CaseDefinition, attempt: CaseAttempt, stageCount: number): string {
  const solved = attempt.status === "COMPLETED_SUCCESS";
  const hearts = "❤️".repeat(attempt.livesRemaining) + "🤍".repeat(caseDef.maxLives - attempt.livesRemaining);
  const clues = solved ? `🎯 ${attempt.currentStageIndex + 1}/${stageCount} clues` : `✖️ not solved (${stageCount} clues)`;
  return [`WiseCases ${formatCaseNumber(caseDef.caseNumber)}`, clues, hearts, `Score ${attempt.score ?? 0}`].join("\n");
}
