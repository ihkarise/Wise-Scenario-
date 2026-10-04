import { matchesAny } from "@/lib/matching/text";
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
  DifferentialDetail,
  Investigation,
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
  /** Present only when the author supplied results for this stage. */
  investigations?: Investigation[];
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

/** Feedback for one of the learner's own wrong answers, when the author wrote a specific explanation. */
export type WrongAnswerFeedback = {
  optionLabel: string;
  explanation: string;
  missedClues: string[];
  betterDirection: string | null;
};

export type StageReview = {
  order: number;
  title: string;
  explanation: string | null;
  investigations: Investigation[];
  crossReference: string | null;
};

/**
 * Extra reasoning written in the Case Manager. Null unless the answer is revealed AND the author wrote
 * something, so cases without these fields look exactly as before.
 */
export type ReasoningView = {
  clinicalSummary: string | null;
  diagnosticReasoning: string | null;
  investigationSummary: string | null;
  clinicalInsight: string | null;
  whereReasoningCanGoWrong: string | null;
  detailedExplanation: string | null;
  finalReasoning: string | null;
  differentialDetails: DifferentialDetail[];
  stageReview: StageReview[];
  yourWrongAnswers: WrongAnswerFeedback[];
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
  reasoning: ReasoningView | null;
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
  const toClue = clueOf;

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

function clueOf(s: CaseDefinition["stages"][number]): VisibleClue {
  const clue: VisibleClue = { stageId: s.id, order: s.order, title: s.title, content: s.content, media: s.media };
  if (s.investigations && s.investigations.length > 0) clue.investigations = s.investigations;
  return clue;
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
    unseenClues: revealed ? stages.slice(attempt.currentStageIndex + 1).map(clueOf) : [],
    shareText: shareText(caseDef, attempt, stages.length),
    reasoning: revealed ? reasoningView(caseDef, attempt) : null,
  };
}

/** Author-written reasoning, or null if the case has none (older cases). Called only after reveal. */
function reasoningView(caseDef: CaseDefinition, attempt: CaseAttempt): ReasoningView | null {
  const t = caseDef.teaching;
  const r = t.reasoning ?? {};
  const details = t.differentialDetails ?? [];
  const stageReview: StageReview[] = orderedStages(caseDef)
    .filter((s) => s.explanation || (s.investigations?.length ?? 0) > 0 || s.crossReference)
    .map((s) => ({
      order: s.order,
      title: s.title,
      explanation: s.explanation ?? null,
      investigations: s.investigations ?? [],
      crossReference: s.crossReference ?? null,
    }));

  // A specific explanation is used when one exists for the learner's choice; otherwise the general
  // explanation sections above remain the feedback, exactly as before.
  const seen = new Set<string>();
  const yourWrongAnswers: WrongAnswerFeedback[] = [];
  for (const a of attempt.answers) {
    if (a.isCorrect || seen.has(a.optionId)) continue;
    seen.add(a.optionId);
    const label = findOptionLabel(caseDef, a.optionId);
    const specific = (t.wrongAnswerExplanations ?? []).find((w) => matchesAny(label, [w.condition, ...w.aliases]));
    if (specific) {
      yourWrongAnswers.push({
        optionLabel: label,
        explanation: specific.explanation,
        missedClues: specific.missedClues,
        betterDirection: specific.betterDirection ?? null,
      });
      continue;
    }
    const differential = details.find((d) => d.whyRejected && matchesAny(label, [d.name, ...d.aliases]));
    if (differential?.whyRejected) {
      yourWrongAnswers.push({ optionLabel: label, explanation: differential.whyRejected, missedClues: [], betterDirection: null });
    }
  }

  const view: ReasoningView = {
    clinicalSummary: r.clinicalSummary ?? null,
    diagnosticReasoning: r.diagnosticReasoning ?? null,
    investigationSummary: r.investigationSummary ?? null,
    clinicalInsight: r.clinicalInsight ?? null,
    whereReasoningCanGoWrong: r.whereReasoningCanGoWrong ?? null,
    detailedExplanation: r.detailedExplanation ?? null,
    finalReasoning: r.finalReasoning ?? null,
    differentialDetails: details,
    stageReview,
    yourWrongAnswers,
  };
  const empty =
    Object.values(r).every((v) => !v) && details.length === 0 && stageReview.length === 0 && yourWrongAnswers.length === 0;
  return empty ? null : view;
}

export function shareText(caseDef: CaseDefinition, attempt: CaseAttempt, stageCount: number): string {
  const solved = attempt.status === "COMPLETED_SUCCESS";
  const hearts = "❤️".repeat(attempt.livesRemaining) + "🤍".repeat(caseDef.maxLives - attempt.livesRemaining);
  const clues = solved ? `🎯 ${attempt.currentStageIndex + 1}/${stageCount} clues` : `✖️ not solved (${stageCount} clues)`;
  return [`WiseCases ${formatCaseNumber(caseDef.caseNumber)}`, clues, hearts, `Score ${attempt.score ?? 0}`].join("\n");
}
