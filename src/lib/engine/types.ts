/**
 * Core WiseCases domain types.
 *
 * Two families of types live here and must never be mixed:
 *  - CONTENT  (CaseDefinition, CaseStage, AnswerOption …): written by authors, identical for every learner.
 *  - ATTEMPT  (CaseAttempt, AnswerRecord …): what one learner did. Never stored inside a case.
 *
 * The engine is domain-agnostic: Medical Diagnosis, Materia Medica, Repertory, Anatomy … are all just
 * cases with stages, clues, questions and options.
 */

export const DIFFICULTIES = ["EASY", "INTERMEDIATE", "HARD"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const PUBLICATION_STATUSES = ["DRAFT", "READY_FOR_REVIEW", "REVIEWED", "PUBLISHED", "ARCHIVED"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/**
 * What happens when the learner answers the FINAL stage wrongly but still has lives.
 * (Running out of lives always ends the case and reveals the answer, whatever this is set to.)
 */
export const TERMINAL_BEHAVIORS = [
  /** Default. End the case as failed and reveal the answer with the full explanation. */
  "REVEAL_ANSWER",
  /** Stay on the final stage with the wrong option struck out, until correct or out of lives. */
  "RETRY_FINAL_STAGE",
  /** End the case as failed WITHOUT revealing the answer (e.g. for a challenge the learner may retry later). */
  "END_CASE",
  /** Allow exactly one more attempt at the final stage, then end and reveal the answer. */
  "ALLOW_FINAL_ATTEMPT",
] as const;
export type TerminalBehavior = (typeof TERMINAL_BEHAVIORS)[number];

/**
 * How a case is completed. MVP: the first correct answer solves the case.
 * Future multi-step reasoning modes (e.g. repertory totality, where every stage must be answered)
 * are added as new members of this union and a new branch in the engine.
 */
export const COMPLETION_MODES = ["FIRST_CORRECT"] as const;
export type CompletionMode = (typeof COMPLETION_MODES)[number];

export type AnswerOption = {
  /** Stable ID. The browser submits this ID, never the answer text or a correctness flag. */
  id: string;
  label: string;
  isCorrect: boolean;
};

/** Interaction types are a discriminated union so new types can be added without touching existing ones. */
export type SingleChoiceInteraction = {
  type: "SINGLE_CHOICE";
  options: AnswerOption[];
};
export type StageInteraction = SingleChoiceInteraction;
export type InteractionType = StageInteraction["type"];

export const MEDIA_KINDS = ["IMAGE", "AUDIO", "VIDEO", "DOCUMENT"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export type StageMedia = {
  id: string;
  kind: MediaKind;
  url: string;
  altText: string;
  caption?: string;
  credit?: string;
  license?: string;
};

export type CaseStage = {
  id: string;
  /** 1-based display order. Stages are always sorted by this. */
  order: number;
  title: string;
  /** The clue / scenario text revealed at this stage. */
  content: string;
  question: string;
  interaction: StageInteraction;
  explanation?: string;
  hint?: string;
  media: StageMedia[];
  /** Lives lost for a wrong answer at this stage. Usually 1; 0 makes a free warm-up stage. */
  lifeCost: number;
  /** Whether earlier clues stay on screen while this stage is shown. */
  showPreviousClues: boolean;
};

export type CaseReference = {
  id: string;
  title: string;
  authors?: string;
  source?: string;
  year?: number;
  url?: string;
  doi?: string;
  pages?: string;
  /** True for development placeholders that a reviewer must replace or verify. Shown to learners as such. */
  isPlaceholder: boolean;
};

export type Differential = { label: string; reason: string };

export type CaseTeaching = {
  /** The answer shown on the result screen, e.g. "Tinea corporis". */
  answerLabel: string;
  finalExplanation: string;
  keyClues: string[];
  learningPoints: string[];
  differentials: Differential[];
};

export type CaseDefinition = {
  id: string;
  slug: string;
  caseNumber: number;
  /** Published version. Attempts are pinned to the version they started on. */
  version: number;
  title: string;
  summary: string;
  domain: string;
  category: string;
  difficulty: Difficulty;
  publicationStatus: PublicationStatus;
  maxLives: number;
  terminalBehavior: TerminalBehavior;
  completionMode: CompletionMode;
  /** If true, the correct option of a stage is shown immediately after a wrong answer there. Default false. */
  revealCorrectOptionOnWrong: boolean;
  stages: CaseStage[];
  teaching: CaseTeaching;
  references: CaseReference[];
  /** Marks development/demo content so it is never mistaken for reviewed material. */
  isDemo: boolean;
};

/* ------------------------------------------------------------------------------------------------
 * ATTEMPT STATE
 * ---------------------------------------------------------------------------------------------- */

/** Statuses that are persisted on an attempt. */
export const ATTEMPT_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED_SUCCESS", "COMPLETED_FAILED"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * Every state of the case state machine. ANSWER_SUBMITTED is transient: the server processes an
 * answer atomically, so it appears in a transition trail but is never stored.
 */
export type CaseState = AttemptStatus | "ANSWER_SUBMITTED";

export type CompletionReason =
  | "SOLVED"
  | "OUT_OF_LIVES"
  | "FINAL_STAGE_REVEAL"
  | "FINAL_STAGE_END"
  | "FINAL_ATTEMPT_USED";

export type AnswerRecord = {
  /** Client-generated idempotency key. Re-sending it never consumes a second life. */
  submissionId: string;
  /** 1, 2, 3 … in the order answers were accepted. */
  sequence: number;
  stageId: string;
  stageOrder: number;
  optionId: string;
  isCorrect: boolean;
  livesBefore: number;
  livesAfter: number;
  answeredAt: string;
};

export type CaseAttempt = {
  id: string;
  ownerId: string;
  caseId: string;
  caseVersion: number;
  status: AttemptStatus;
  /** 0-based index into the case's stages sorted by order. */
  currentStageIndex: number;
  livesRemaining: number;
  answers: AnswerRecord[];
  score: number | null;
  completionReason: CompletionReason | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Optimistic-concurrency token. Incremented on every accepted change. */
  revision: number;
};

/** What the browser is allowed to send for an answer. Everything else is decided by the server. */
export type AnswerSubmission = {
  submissionId: string;
  stageId: string;
  optionId: string;
  /** The attempt revision the learner was looking at. A stale value is rejected, not re-applied. */
  expectedRevision: number;
};

/** What an accepted answer did to the attempt. */
export type CaseProgression =
  | { type: "SOLVED"; stageId: string }
  | { type: "ADVANCED"; fromStageId: string; toStageId: string; livesLost: number }
  | { type: "RETRY_FINAL_STAGE"; stageId: string; livesLost: number }
  | {
      type: "FAILED";
      reason: Exclude<CompletionReason, "SOLVED">;
      stageId: string;
      livesLost: number;
    };

export type CaseResult = {
  status: "COMPLETED_SUCCESS" | "COMPLETED_FAILED";
  reason: CompletionReason;
  score: number;
  stageReached: number;
  stageCount: number;
  livesRemaining: number;
  maxLives: number;
  /** Whether the learner may now see the correct answer and teaching content. */
  answerRevealed: boolean;
};
