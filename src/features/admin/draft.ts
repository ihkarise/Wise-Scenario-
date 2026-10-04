import { z } from "zod";
import {
  DIFFICULTIES,
  PUBLICATION_STATUSES,
  TERMINAL_BEHAVIORS,
  type CaseDefinition,
  type Difficulty,
  type Differential,
  type PublicationStatus,
  type TerminalBehavior,
} from "@/lib/engine/types";
import { slugSchema, uuidSchema } from "@/lib/schemas/ids";

/**
 * The Case Builder's working copy of a case. Shared by the browser (editing) and the server
 * (saving, previewing, publishing). Drafts may be incomplete; completeness is checked by
 * `checkReadiness` with messages written for authors, not developers.
 */

export const LIMITS = {
  minLives: 1,
  maxLives: 10,
  defaultLives: 5,
  maxStages: 50,
  minOptions: 2,
  maxOptions: 12,
  maxReferences: 30,
  maxLifeCost: 10,
} as const;

export const REFERENCE_TYPES = ["book", "journal", "website", "guideline", "other"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export type DraftOption = { id: string; label: string; isCorrect: boolean };

export type DraftStage = {
  id: string;
  title: string;
  content: string;
  question: string;
  hint: string;
  explanation: string;
  lifeCost: number;
  showPreviousClues: boolean;
  options: DraftOption[];
};

export type DraftReference = {
  id: string;
  title: string;
  authors: string;
  source: string;
  year: number | null;
  url: string;
  doi: string;
  pages: string;
  refType: ReferenceType;
  isPlaceholder: boolean;
  verified: boolean;
};

/** Everything an author can edit. */
export type CaseDraftContent = {
  title: string;
  slug: string;
  summary: string;
  learningObjective: string;
  domainId: string;
  categoryId: string | null;
  difficulty: Difficulty;
  maxLives: number;
  terminalBehavior: TerminalBehavior;
  revealCorrectOptionOnWrong: boolean;
  answerLabel: string;
  finalExplanation: string;
  keyClues: string[];
  learningPoints: string[];
  differentials: Differential[];
  stages: DraftStage[];
  references: DraftReference[];
};

/** A draft as loaded from the database, with server-managed fields. */
export type CaseDraft = CaseDraftContent & {
  id: string;
  caseNumber: number;
  status: PublicationStatus;
  revision: number;
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  isDemo: boolean;
  updatedAt: string;
};

/* ---------------------------------------------------------------------------------------------
 * Validation of what the browser sends when saving (lenient: drafts may be unfinished)
 * ------------------------------------------------------------------------------------------- */

const str = (max: number) => z.string().max(max);

const draftOptionSchema = z.strictObject({ id: uuidSchema, label: str(300), isCorrect: z.boolean() });

const draftStageSchema = z.strictObject({
  id: uuidSchema,
  title: str(120),
  content: str(4000),
  question: str(500),
  hint: str(500),
  explanation: str(4000),
  lifeCost: z.int().min(0).max(LIMITS.maxLifeCost),
  showPreviousClues: z.boolean(),
  options: z.array(draftOptionSchema).max(LIMITS.maxOptions),
});

const draftReferenceSchema = z.strictObject({
  id: uuidSchema,
  title: str(500),
  authors: str(500),
  source: str(300),
  year: z.int().min(1500).max(2100).nullable(),
  url: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2000)]),
  doi: str(200),
  pages: str(50),
  refType: z.enum(REFERENCE_TYPES),
  isPlaceholder: z.boolean(),
  verified: z.boolean(),
});

export const draftContentSchema = z.strictObject({
  title: z.string().trim().min(1, "Add a case title.").max(200),
  slug: slugSchema,
  summary: str(500),
  learningObjective: str(1000),
  domainId: uuidSchema,
  categoryId: uuidSchema.nullable(),
  difficulty: z.enum(DIFFICULTIES),
  maxLives: z.int().min(LIMITS.minLives).max(LIMITS.maxLives),
  terminalBehavior: z.enum(TERMINAL_BEHAVIORS),
  revealCorrectOptionOnWrong: z.boolean(),
  answerLabel: str(300),
  finalExplanation: str(8000),
  keyClues: z.array(str(500)).max(20),
  learningPoints: z.array(str(500)).max(20),
  differentials: z.array(z.strictObject({ label: str(200), reason: str(1000) })).max(20),
  stages: z.array(draftStageSchema).max(LIMITS.maxStages),
  references: z.array(draftReferenceSchema).max(LIMITS.maxReferences),
});

export const saveDraftBodySchema = z.strictObject({
  content: draftContentSchema,
  expectedRevision: z.int().min(0),
});

export const createCaseBodySchema = z.strictObject({
  title: z.string().trim().min(1, "Add a case title.").max(200),
  summary: str(500),
  learningObjective: str(1000),
  domainId: uuidSchema,
  categoryId: uuidSchema.nullable(),
  difficulty: z.enum(DIFFICULTIES),
  maxLives: z.int().min(LIMITS.minLives).max(LIMITS.maxLives),
  terminalBehavior: z.enum(TERMINAL_BEHAVIORS),
});
export type CreateCaseInput = z.infer<typeof createCaseBodySchema>;

export const CASE_ACTIONS = ["publish", "unpublish", "archive", "restore", "submit_for_review"] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];
export const caseActionBodySchema = z.strictObject({ action: z.enum(CASE_ACTIONS) });

export { PUBLICATION_STATUSES };

/* ---------------------------------------------------------------------------------------------
 * Readiness: what is missing before previewing or publishing
 * ------------------------------------------------------------------------------------------- */

export type ReadinessSection = "general" | "stages" | "learning" | "references";
export type ReadinessIssue = { message: string; section: ReadinessSection; stageIndex?: number };
export type Readiness = {
  /** Blocks preview AND publishing. */
  playErrors: ReadinessIssue[];
  /** Blocks publishing only. */
  publishErrors: ReadinessIssue[];
  /** Worth knowing; never blocks. */
  warnings: ReadinessIssue[];
  canPreview: boolean;
  canPublish: boolean;
};

const blank = (s: string | null | undefined) => !s || s.trim().length === 0;

export function checkReadiness(draft: CaseDraftContent): Readiness {
  const play: ReadinessIssue[] = [];
  const publish: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];

  if (blank(draft.title)) play.push({ message: "Add a case title.", section: "general" });
  if (blank(draft.domainId)) play.push({ message: "Choose a domain.", section: "general" });
  if (!DIFFICULTIES.includes(draft.difficulty)) play.push({ message: "Choose a difficulty.", section: "general" });
  if (!Number.isInteger(draft.maxLives) || draft.maxLives < LIMITS.minLives || draft.maxLives > LIMITS.maxLives) {
    play.push({ message: `Lives must be between ${LIMITS.minLives} and ${LIMITS.maxLives}.`, section: "general" });
  }
  if (draft.stages.length === 0) play.push({ message: "Add at least one clue.", section: "stages" });

  draft.stages.forEach((stage, i) => {
    const n = `Clue ${i + 1}`;
    const at = { section: "stages" as const, stageIndex: i };
    if (blank(stage.content)) play.push({ message: `${n} has no clue text.`, ...at });
    if (blank(stage.question)) play.push({ message: `${n} has no question.`, ...at });
    const filled = stage.options.filter((o) => !blank(o.label));
    if (stage.options.length === 0) play.push({ message: `${n} has no answer options.`, ...at });
    else if (filled.length < LIMITS.minOptions) play.push({ message: `${n} needs at least ${LIMITS.minOptions} answer options.`, ...at });
    if (stage.options.some((o) => blank(o.label))) play.push({ message: `${n} has an empty answer option.`, ...at });
    const correct = stage.options.filter((o) => o.isCorrect).length;
    if (correct === 0) play.push({ message: `${n} has no correct answer.`, ...at });
    if (correct > 1) play.push({ message: `${n} has more than one correct answer.`, ...at });
    const labels = filled.map((o) => o.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) warnings.push({ message: `${n} has two answer options with the same text.`, ...at });
    if (stage.lifeCost > draft.maxLives) play.push({ message: `${n} costs more lives than the case has.`, ...at });
  });

  if (draft.stages.length > 0 && draft.maxLives < draft.stages.length) {
    warnings.push({
      message: `With ${draft.maxLives} ${draft.maxLives === 1 ? "life" : "lives"}, learners who keep answering wrongly will not see every clue. That is fine if intended.`,
      section: "general",
    });
  }

  if (blank(draft.finalExplanation)) publish.push({ message: "Write the final explanation learners see at the end.", section: "learning" });
  draft.differentials.forEach((d, i) => {
    if (blank(d.label) !== blank(d.reason)) {
      publish.push({ message: `Alternative ${i + 1} needs both a name and a reason.`, section: "learning" });
    }
  });
  draft.references.forEach((r, i) => {
    if (blank(r.title)) publish.push({ message: `Reference ${i + 1} has no title.`, section: "references" });
  });
  const unverified = draft.references.filter((r) => !blank(r.title) && (r.isPlaceholder || !r.verified)).length;
  if (unverified > 0) {
    warnings.push({ message: `${unverified} reference${unverified > 1 ? "s are" : " is"} not verified yet.`, section: "references" });
  }
  if (draft.references.length === 0) warnings.push({ message: "No references added.", section: "references" });

  return {
    playErrors: play,
    publishErrors: publish,
    warnings,
    canPreview: play.length === 0,
    canPublish: play.length === 0 && publish.length === 0,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Draft → engine CaseDefinition (the snapshot that gets played)
 * ------------------------------------------------------------------------------------------- */

export type SnapshotContext = {
  caseId: string;
  caseNumber: number;
  version: number;
  domainName: string;
  categoryName: string | null;
  isDemo: boolean;
  /** Preview fills in missing teaching text so an unfinished draft can still be played. */
  mode: "publish" | "preview";
};

/** Builds the input for `parseCaseDefinition`. The caller must parse it, which enforces playability. */
export function draftToCaseDefinitionInput(draft: CaseDraftContent, ctx: SnapshotContext): Omit<CaseDefinition, never> {
  const finalStage = draft.stages.at(-1);
  const finalCorrect = finalStage?.options.find((o) => o.isCorrect)?.label.trim() ?? "";
  const answerLabel = draft.answerLabel.trim() || finalCorrect;
  const explanation = draft.finalExplanation.trim() || (ctx.mode === "preview" ? "No final explanation has been written yet." : "");
  const keep = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

  return {
    id: ctx.caseId,
    slug: draft.slug,
    caseNumber: ctx.caseNumber,
    version: ctx.version,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    domain: ctx.domainName,
    category: ctx.categoryName ?? "General",
    difficulty: draft.difficulty,
    publicationStatus: "PUBLISHED",
    maxLives: draft.maxLives,
    terminalBehavior: draft.terminalBehavior,
    completionMode: "FIRST_CORRECT",
    revealCorrectOptionOnWrong: draft.revealCorrectOptionOnWrong,
    stages: draft.stages.map((s, i) => ({
      id: s.id,
      order: i + 1,
      title: s.title.trim() || `Clue ${i + 1}`,
      content: s.content.trim(),
      question: s.question.trim(),
      hint: s.hint.trim() || undefined,
      explanation: s.explanation.trim() || undefined,
      media: [],
      lifeCost: s.lifeCost,
      showPreviousClues: s.showPreviousClues,
      interaction: {
        type: "SINGLE_CHOICE",
        options: s.options.map((o) => ({ id: o.id, label: o.label.trim(), isCorrect: o.isCorrect })),
      },
    })),
    teaching: {
      answerLabel,
      finalExplanation: explanation,
      keyClues: keep(draft.keyClues),
      learningPoints: keep(draft.learningPoints),
      differentials: draft.differentials
        .filter((d) => !blank(d.label) && !blank(d.reason))
        .map((d) => ({ label: d.label.trim(), reason: d.reason.trim() })),
    },
    references: draft.references
      .filter((r) => !blank(r.title))
      .map((r) => ({
        id: r.id,
        title: r.title.trim(),
        authors: r.authors.trim() || undefined,
        source: r.source.trim() || undefined,
        year: r.year ?? undefined,
        url: r.url.trim() || undefined,
        doi: r.doi.trim() || undefined,
        pages: r.pages.trim() || undefined,
        isPlaceholder: r.isPlaceholder || !r.verified,
      })),
    isDemo: ctx.isDemo,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Helpers shared by the builder and the server
 * ------------------------------------------------------------------------------------------- */

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return s || "case";
}

export function emptyStage(newId: () => string, question = "What is the most likely diagnosis?"): DraftStage {
  return {
    id: newId(),
    title: "",
    content: "",
    question,
    hint: "",
    explanation: "",
    lifeCost: 1,
    showPreviousClues: true,
    options: [
      { id: newId(), label: "", isCorrect: false },
      { id: newId(), label: "", isCorrect: false },
    ],
  };
}

export function emptyReference(newId: () => string): DraftReference {
  return { id: newId(), title: "", authors: "", source: "", year: null, url: "", doi: "", pages: "", refType: "book", isPlaceholder: false, verified: false };
}

/** Plain-language labels for the builder. */
export const TERMINAL_BEHAVIOR_LABEL: Record<TerminalBehavior, { title: string; help: string }> = {
  REVEAL_ANSWER: { title: "End and show the answer", help: "Recommended. A wrong answer on the last clue ends the case and shows the full explanation." },
  RETRY_FINAL_STAGE: { title: "Let them try the last clue again", help: "The wrong choice is crossed out and they try again until correct or out of lives." },
  ALLOW_FINAL_ATTEMPT: { title: "Give one more try, then show the answer", help: "Exactly one extra attempt at the last clue." },
  END_CASE: { title: "End without showing the answer", help: "Useful when learners should be able to retry the case later without spoilers." },
};

export const STATUS_LABEL: Record<PublicationStatus, string> = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Awaiting review",
  REVIEWED: "Reviewed",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};
