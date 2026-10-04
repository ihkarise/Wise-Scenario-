import { z } from "zod";
import {
  DIFFICULTIES,
  PUBLICATION_STATUSES,
  TERMINAL_BEHAVIORS,
  type CaseDefinition,
  type Difficulty,
  type PublicationStatus,
  type TerminalBehavior,
} from "@/lib/engine/types";
import { answerKeyNames, matchesAny, normalizeText } from "@/lib/matching/text";
import { slugSchema, uuidSchema } from "@/lib/schemas/ids";

/**
 * The Case Manager's working copy of a case. Shared by the browser (editing) and the server
 * (saving, previewing, publishing). Every clinical text here is written by the author; nothing is
 * generated. Completeness is checked by `checkReadiness` with messages written for authors.
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
  maxScore: 100_000,
  maxInvestigations: 30,
  maxListItems: 20,
  maxNames: 30,
  maxDifferentials: 20,
  maxWrongAnswers: 30,
} as const;

/** Case IDs such as CASE-005 or HEP-2026-01. */
export const CASE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
export const DEFAULT_QUESTION = "What is the most likely diagnosis?";
export const DEFAULT_DOMAIN_NAME = "Medical Diagnosis";

export const REFERENCE_TYPES = ["book", "journal", "website", "guideline", "other"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export type DraftOption = { id: string; label: string; isCorrect: boolean };

export type DraftInvestigation = { name: string; value: string; unit: string; referenceRange: string; interpretation: string };

export type DraftStage = {
  id: string;
  title: string;
  /** The clue text. */
  content: string;
  /** Decision point: the question asked at this stage, answered by choosing one of `options`. */
  question: string;
  hint: string;
  explanation: string;
  lifeCost: number;
  showPreviousClues: boolean;
  options: DraftOption[];
  investigations: DraftInvestigation[];
  crossReference: string;
};

export type DraftDiagnosis = {
  primary: string;
  /** Shown to learners as the answer. */
  displayName: string;
  acceptedAnswers: string[];
  aliases: string[];
  /** Shown as "Why … fits". */
  explanation: string;
  detailedExplanation: string;
  /** Shown as "Key clues". */
  decisiveFindings: string[];
  finalReasoning: string;
};

export type DraftDifferential = {
  name: string;
  aliases: string[];
  whyConsidered: string;
  whyRejected: string;
  clinicalExplanation: string;
  crossReferences: string[];
};

export type DraftWrongAnswer = {
  condition: string;
  aliases: string[];
  explanation: string;
  missedClues: string[];
  betterDirection: string;
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
  caseCode: string;
  title: string;
  slug: string;
  summary: string;
  learningObjective: string;
  domainId: string;
  category: string;
  subcategory: string;
  difficulty: Difficulty;
  maxLives: number;
  /** Default life cost for new stages. Each stage keeps its own value. */
  lifeLossPerWrong: number;
  /** Stored with the case. The game still uses its existing scoring formula (see docs/CASE-MANAGER.md). */
  startingScore: number | null;
  wrongAnswerPenalty: number | null;
  terminalBehavior: TerminalBehavior;
  revealCorrectOptionOnWrong: boolean;
  stages: DraftStage[];
  diagnosis: DraftDiagnosis;
  differentialDiagnoses: DraftDifferential[];
  wrongAnswerExplanations: DraftWrongAnswer[];
  clinicalSummary: string;
  clinicalInsight: string;
  diagnosticReasoning: string;
  investigationSummary: string;
  whereReasoningCanGoWrong: string;
  learningPoints: string[];
  references: DraftReference[];
};

/** A draft as loaded from the database, with server-managed fields. */
export type CaseDraft = CaseDraftContent & {
  id: string;
  caseNumber: number;
  status: PublicationStatus;
  /** Concurrency token: changes on every save. */
  revision: number;
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  isDemo: boolean;
  updatedAt: string;
};

const SERVER_FIELDS = ["id", "caseNumber", "status", "revision", "publishedVersion", "hasUnpublishedChanges", "isDemo", "updatedAt"] as const;

/** The author-editable part of a loaded draft (what the editor sends when saving). */
export function draftContent(draft: CaseDraft): CaseDraftContent {
  const copy: Partial<CaseDraft> = { ...draft };
  for (const key of SERVER_FIELDS) delete copy[key];
  return copy as CaseDraftContent;
}

/* ---------------------------------------------------------------------------------------------
 * Validation of what the browser sends when saving (lenient: drafts may be unfinished)
 * ------------------------------------------------------------------------------------------- */

const str = (max: number) => z.string().max(max);
const strList = (items: number, max: number) => z.array(str(max)).max(items);

const draftOptionSchema = z.strictObject({ id: uuidSchema, label: str(300), isCorrect: z.boolean() });

const draftInvestigationSchema = z.strictObject({
  name: str(200),
  value: str(200),
  unit: str(60),
  referenceRange: str(200),
  interpretation: str(1000),
});

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
  investigations: z.array(draftInvestigationSchema).max(LIMITS.maxInvestigations),
  crossReference: str(1000),
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

const caseCodeSchema = z.string().trim().regex(CASE_CODE_PATTERN, "Case ID may use letters, numbers, dots, dashes and underscores (up to 40).");

export const draftContentSchema = z.strictObject({
  caseCode: caseCodeSchema,
  title: z.string().trim().min(1, "Add a case title.").max(200),
  slug: slugSchema,
  summary: str(500),
  learningObjective: str(1000),
  domainId: uuidSchema,
  category: str(80),
  subcategory: str(80),
  difficulty: z.enum(DIFFICULTIES),
  maxLives: z.int().min(LIMITS.minLives).max(LIMITS.maxLives),
  lifeLossPerWrong: z.int().min(0).max(LIMITS.maxLifeCost),
  startingScore: z.int().min(0).max(LIMITS.maxScore).nullable(),
  wrongAnswerPenalty: z.int().min(0).max(LIMITS.maxScore).nullable(),
  terminalBehavior: z.enum(TERMINAL_BEHAVIORS),
  revealCorrectOptionOnWrong: z.boolean(),
  stages: z.array(draftStageSchema).max(LIMITS.maxStages),
  diagnosis: z.strictObject({
    primary: str(200),
    displayName: str(300),
    acceptedAnswers: strList(LIMITS.maxNames, 200),
    aliases: strList(LIMITS.maxNames, 200),
    explanation: str(8000),
    detailedExplanation: str(8000),
    decisiveFindings: strList(LIMITS.maxListItems, 500),
    finalReasoning: str(8000),
  }),
  differentialDiagnoses: z
    .array(
      z.strictObject({
        name: str(200),
        aliases: strList(LIMITS.maxNames, 200),
        whyConsidered: str(1000),
        whyRejected: str(1000),
        clinicalExplanation: str(4000),
        crossReferences: strList(LIMITS.maxListItems, 500),
      }),
    )
    .max(LIMITS.maxDifferentials),
  wrongAnswerExplanations: z
    .array(
      z.strictObject({
        condition: str(200),
        aliases: strList(LIMITS.maxNames, 200),
        explanation: str(4000),
        missedClues: strList(LIMITS.maxListItems, 500),
        betterDirection: str(2000),
      }),
    )
    .max(LIMITS.maxWrongAnswers),
  clinicalSummary: str(8000),
  clinicalInsight: str(8000),
  diagnosticReasoning: str(8000),
  investigationSummary: str(8000),
  whereReasoningCanGoWrong: str(8000),
  learningPoints: strList(LIMITS.maxListItems, 500),
  references: z.array(draftReferenceSchema).max(LIMITS.maxReferences),
});

export const saveDraftBodySchema = z.strictObject({
  content: draftContentSchema,
  expectedRevision: z.number().int().min(0),
});

export const createCaseBodySchema = z.strictObject({
  caseCode: z.union([z.literal(""), caseCodeSchema]),
  title: z.string().trim().min(1, "Add a case title.").max(200),
  domainId: uuidSchema,
  category: z.string().trim().min(1, "Add a category.").max(80),
  subcategory: str(80),
  difficulty: z.enum(DIFFICULTIES),
  maxLives: z.int().min(LIMITS.minLives).max(LIMITS.maxLives),
});
export type CreateCaseInput = z.infer<typeof createCaseBodySchema>;

export const CASE_ACTIONS = ["publish", "unpublish", "archive", "restore", "submit_for_review"] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];
export const caseActionBodySchema = z.strictObject({ action: z.enum(CASE_ACTIONS) });

export { PUBLICATION_STATUSES };

/* ---------------------------------------------------------------------------------------------
 * Cleaning: fully empty rows (an option, investigation or list line with no text) are UI scaffolding,
 * not content, so they are dropped before saving. Text that was written is never changed.
 * ------------------------------------------------------------------------------------------- */

export const blank = (s: string | null | undefined) => !s || s.trim().length === 0;
const keep = (list: readonly string[]) => list.map((s) => s.trim()).filter(Boolean);

export function cleanDraft(d: CaseDraftContent): CaseDraftContent {
  return {
    ...d,
    caseCode: d.caseCode.trim(),
    title: d.title.trim(),
    category: d.category.trim(),
    subcategory: d.subcategory.trim(),
    stages: d.stages.map((s) => ({
      ...s,
      options: s.options.filter((o) => !blank(o.label)).map((o) => ({ ...o, label: o.label.trim() })),
      investigations: s.investigations.filter((i) => !(blank(i.name) && blank(i.value) && blank(i.unit) && blank(i.referenceRange) && blank(i.interpretation))),
    })),
    diagnosis: {
      ...d.diagnosis,
      acceptedAnswers: keep(d.diagnosis.acceptedAnswers),
      aliases: keep(d.diagnosis.aliases),
      decisiveFindings: keep(d.diagnosis.decisiveFindings),
    },
    differentialDiagnoses: d.differentialDiagnoses
      .filter((x) => !(blank(x.name) && blank(x.whyConsidered) && blank(x.whyRejected) && blank(x.clinicalExplanation)))
      .map((x) => ({ ...x, aliases: keep(x.aliases), crossReferences: keep(x.crossReferences) })),
    wrongAnswerExplanations: d.wrongAnswerExplanations
      .filter((w) => !(blank(w.condition) && blank(w.explanation)))
      .map((w) => ({ ...w, aliases: keep(w.aliases), missedClues: keep(w.missedClues) })),
    learningPoints: keep(d.learningPoints),
    references: d.references.filter((r) => !(blank(r.title) && blank(r.authors) && blank(r.url))),
  };
}

/**
 * Fields the database requires before anything can be stored (it rejects empty stage titles, clues,
 * questions, options and reference titles). Returned as plain-language messages.
 */
export function saveBlockers(d: CaseDraftContent): string[] {
  const issues: string[] = [];
  d.stages.forEach((s, i) => {
    const n = `Stage ${i + 1}`;
    if (blank(s.title)) issues.push(`${n} needs a title.`);
    if (blank(s.content)) issues.push(`${n} needs clue text.`);
    if (blank(s.question)) issues.push(`${n} needs a question.`);
    if (s.lifeCost > d.maxLives) issues.push(`${n} costs more lives than the case has.`);
    s.investigations.forEach((inv, j) => {
      if (blank(inv.name) || blank(inv.value)) issues.push(`${n}, investigation ${j + 1} needs a test name and a value.`);
    });
  });
  d.references.forEach((r, i) => {
    if (blank(r.title)) issues.push(`Reference ${i + 1} needs a title.`);
  });
  d.differentialDiagnoses.forEach((x, i) => {
    if (blank(x.name)) issues.push(`Differential diagnosis ${i + 1} needs a name.`);
  });
  d.wrongAnswerExplanations.forEach((w, i) => {
    if (blank(w.condition)) issues.push(`Wrong-answer explanation ${i + 1} needs a condition.`);
    if (blank(w.explanation)) issues.push(`Wrong-answer explanation ${i + 1} needs an explanation.`);
  });
  return issues;
}

/* ---------------------------------------------------------------------------------------------
 * Readiness: what is missing before previewing or publishing
 * ------------------------------------------------------------------------------------------- */

export type ReadinessSection =
  | "basic"
  | "stages"
  | "diagnosis"
  | "differentials"
  | "wrongAnswers"
  | "learning"
  | "references";
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

export function diagnosisNames(d: DraftDiagnosis): string[] {
  return answerKeyNames({ primary: d.primary, displayName: d.displayName, acceptedAnswers: d.acceptedAnswers, aliases: d.aliases });
}

export function checkReadiness(draft: CaseDraftContent): Readiness {
  const play: ReadinessIssue[] = [];
  const publish: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];

  if (blank(draft.title)) play.push({ message: "Add a case title.", section: "basic" });
  if (!CASE_CODE_PATTERN.test(draft.caseCode)) play.push({ message: "Add a Case ID such as CASE-005.", section: "basic" });
  if (blank(draft.domainId)) play.push({ message: "Choose a domain.", section: "basic" });
  if (blank(draft.category)) play.push({ message: "Add a category.", section: "basic" });
  if (!DIFFICULTIES.includes(draft.difficulty)) play.push({ message: "Choose a difficulty.", section: "basic" });
  if (!Number.isInteger(draft.maxLives) || draft.maxLives < LIMITS.minLives || draft.maxLives > LIMITS.maxLives) {
    play.push({ message: `Lives must be between ${LIMITS.minLives} and ${LIMITS.maxLives}.`, section: "basic" });
  }
  if (draft.stages.length === 0) play.push({ message: "Add at least one stage.", section: "stages" });

  const names = diagnosisNames(draft.diagnosis);
  draft.stages.forEach((stage, i) => {
    const n = `Stage ${i + 1}`;
    const at = { section: "stages" as const, stageIndex: i };
    if (blank(stage.title)) play.push({ message: `${n} has no title.`, ...at });
    if (blank(stage.content)) play.push({ message: `${n} is missing a clue.`, ...at });
    if (blank(stage.question)) play.push({ message: `${n} has no question.`, ...at });
    const filled = stage.options.filter((o) => !blank(o.label));
    if (filled.length < LIMITS.minOptions) play.push({ message: `${n} needs at least ${LIMITS.minOptions} answer options.`, ...at });
    const correct = filled.filter((o) => o.isCorrect);
    if (correct.length === 0) play.push({ message: `${n} has no correct answer option.`, ...at });
    if (correct.length > 1) play.push({ message: `${n} has more than one correct answer option.`, ...at });
    const labels = filled.map((o) => normalizeText(o.label));
    if (new Set(labels).size !== labels.length) warnings.push({ message: `${n} has two answer options with the same text.`, ...at });
    if (stage.lifeCost > draft.maxLives) play.push({ message: `${n} costs more lives than the case has.`, ...at });
    if (correct.length === 1 && names.length > 0 && !matchesAny(correct[0]!.label, names)) {
      warnings.push({
        message: `${n}: the correct option “${correct[0]!.label.trim()}” is not one of the diagnosis names or accepted answers. A correct answer ends the case.`,
        ...at,
      });
    }
    stage.investigations.forEach((inv, j) => {
      if (blank(inv.name) || blank(inv.value)) play.push({ message: `${n}, investigation ${j + 1} needs a test name and a value.`, ...at });
    });
  });

  if (draft.stages.length > 0 && draft.maxLives < draft.stages.length) {
    warnings.push({
      message: `With ${draft.maxLives} ${draft.maxLives === 1 ? "life" : "lives"}, learners who keep answering wrongly will not see every stage. That is fine if intended.`,
      section: "basic",
    });
  }

  if (blank(draft.diagnosis.primary)) publish.push({ message: "Add the primary diagnosis.", section: "diagnosis" });
  if (draft.diagnosis.acceptedAnswers.filter((a) => !blank(a)).length === 0) {
    publish.push({ message: "Diagnosis has no accepted answers.", section: "diagnosis" });
  }
  if (blank(draft.diagnosis.explanation)) publish.push({ message: "Write the diagnosis explanation learners see at the end.", section: "diagnosis" });
  draft.differentialDiagnoses.forEach((d, i) => {
    if (blank(d.name)) publish.push({ message: `Differential diagnosis ${i + 1} needs a name.`, section: "differentials" });
  });
  draft.wrongAnswerExplanations.forEach((w, i) => {
    if (blank(w.condition) || blank(w.explanation)) {
      publish.push({ message: `Wrong-answer explanation ${i + 1} needs a condition and an explanation.`, section: "wrongAnswers" });
    }
  });
  draft.references.forEach((r, i) => {
    if (blank(r.title)) publish.push({ message: `Reference ${i + 1} has no title.`, section: "references" });
  });
  if (draft.learningPoints.filter((p) => !blank(p)).length === 0) warnings.push({ message: "No learning points added.", section: "learning" });
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
 * Answer options built from the author's own diagnosis and differentials
 * ------------------------------------------------------------------------------------------- */

/** Small deterministic hash, so generated option order is stable and the correct answer is not always first. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Answer options for a stage, using ONLY names the author supplied: the diagnosis (correct) plus the
 * differential diagnoses and wrong-answer conditions (incorrect). Returns null when there is nothing
 * to build from. Nothing is invented.
 */
export function buildOptionsFromAuthorContent(
  content: Pick<CaseDraftContent, "diagnosis" | "differentialDiagnoses" | "wrongAnswerExplanations">,
  seed: string,
  newId: () => string,
): DraftOption[] | null {
  const correct = content.diagnosis.displayName.trim() || content.diagnosis.primary.trim();
  if (!correct) return null;
  const names = diagnosisNames(content.diagnosis);
  const seen = new Set<string>([normalizeText(correct)]);
  const distractors: string[] = [];
  for (const candidate of [...content.differentialDiagnoses.map((d) => d.name), ...content.wrongAnswerExplanations.map((w) => w.condition)]) {
    const label = candidate.trim();
    const key = normalizeText(label);
    if (!label || seen.has(key) || matchesAny(label, names)) continue;
    seen.add(key);
    distractors.push(label);
  }
  if (distractors.length === 0) return null;
  const labels = [correct, ...distractors.slice(0, LIMITS.maxOptions - 1)];
  const order = labels.map((label) => ({ label, key: hash(`${seed}|${label}`) })).sort((a, b) => a.key - b.key);
  return order.map(({ label }) => ({ id: newId(), label, isCorrect: label === correct }));
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
  /** Preview shows a clear note where the final explanation has not been written yet. */
  mode: "publish" | "preview";
};

const opt = (s: string) => (blank(s) ? undefined : s.trim());

/** Builds the input for `parseCaseDefinition`. The caller must parse it, which enforces playability. */
export function draftToCaseDefinitionInput(draft: CaseDraftContent, ctx: SnapshotContext): CaseDefinition {
  const finalStage = draft.stages.at(-1);
  const finalCorrect = finalStage?.options.find((o) => o.isCorrect)?.label.trim() ?? "";
  const dx = draft.diagnosis;
  const answerLabel = dx.displayName.trim() || dx.primary.trim() || finalCorrect;
  const explanation = dx.explanation.trim() || (ctx.mode === "preview" ? "No diagnosis explanation has been written yet." : "");
  const differentials = draft.differentialDiagnoses.filter((d) => !blank(d.name));
  const reasoning = {
    clinicalSummary: opt(draft.clinicalSummary),
    diagnosticReasoning: opt(draft.diagnosticReasoning),
    investigationSummary: opt(draft.investigationSummary),
    clinicalInsight: opt(draft.clinicalInsight),
    whereReasoningCanGoWrong: opt(draft.whereReasoningCanGoWrong),
    detailedExplanation: opt(dx.detailedExplanation),
    finalReasoning: opt(dx.finalReasoning),
  };

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
    stages: draft.stages.map((s, i) => {
      const investigations = s.investigations
        .filter((inv) => !blank(inv.name) && !blank(inv.value))
        .map((inv) => ({
          name: inv.name.trim(),
          value: inv.value.trim(),
          unit: opt(inv.unit),
          referenceRange: opt(inv.referenceRange),
          interpretation: opt(inv.interpretation),
        }));
      return {
        id: s.id,
        order: i + 1,
        title: s.title.trim() || `Stage ${i + 1}`,
        content: s.content.trim(),
        question: s.question.trim(),
        hint: opt(s.hint),
        explanation: opt(s.explanation),
        media: [],
        lifeCost: s.lifeCost,
        showPreviousClues: s.showPreviousClues,
        ...(investigations.length > 0 ? { investigations } : {}),
        ...(opt(s.crossReference) ? { crossReference: s.crossReference.trim() } : {}),
        interaction: {
          type: "SINGLE_CHOICE" as const,
          options: s.options.filter((o) => !blank(o.label)).map((o) => ({ id: o.id, label: o.label.trim(), isCorrect: o.isCorrect })),
        },
      };
    }),
    teaching: {
      answerLabel,
      finalExplanation: explanation,
      keyClues: keep(dx.decisiveFindings),
      learningPoints: keep(draft.learningPoints),
      differentials: differentials
        .map((d) => ({ label: d.name.trim(), reason: (d.whyRejected.trim() || d.whyConsidered.trim()) }))
        .filter((d) => d.reason.length > 0),
      ...(Object.values(reasoning).some(Boolean) ? { reasoning } : {}),
      ...(differentials.length > 0
        ? {
            differentialDetails: differentials.map((d) => ({
              name: d.name.trim(),
              aliases: keep(d.aliases),
              whyConsidered: opt(d.whyConsidered),
              whyRejected: opt(d.whyRejected),
              clinicalExplanation: opt(d.clinicalExplanation),
              crossReferences: keep(d.crossReferences),
            })),
          }
        : {}),
      ...(draft.wrongAnswerExplanations.some((w) => !blank(w.condition) && !blank(w.explanation))
        ? {
            wrongAnswerExplanations: draft.wrongAnswerExplanations
              .filter((w) => !blank(w.condition) && !blank(w.explanation))
              .map((w) => ({
                condition: w.condition.trim(),
                aliases: keep(w.aliases),
                explanation: w.explanation.trim(),
                missedClues: keep(w.missedClues),
                betterDirection: opt(w.betterDirection),
              })),
          }
        : {}),
    },
    references: draft.references
      .filter((r) => !blank(r.title))
      .map((r) => ({
        id: r.id,
        title: r.title.trim(),
        authors: opt(r.authors),
        source: opt(r.source),
        year: r.year ?? undefined,
        url: opt(r.url),
        doi: opt(r.doi),
        pages: opt(r.pages),
        isPlaceholder: r.isPlaceholder || !r.verified,
      })),
    isDemo: ctx.isDemo,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Helpers shared by the editor and the server
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

export const emptyDiagnosis = (): DraftDiagnosis => ({
  primary: "",
  displayName: "",
  acceptedAnswers: [],
  aliases: [],
  explanation: "",
  detailedExplanation: "",
  decisiveFindings: [],
  finalReasoning: "",
});

export function emptyStage(newId: () => string, number: number, lifeCost = 1): DraftStage {
  return {
    id: newId(),
    title: `Stage ${number}`,
    content: "",
    question: DEFAULT_QUESTION,
    hint: "",
    explanation: "",
    lifeCost,
    showPreviousClues: true,
    options: [
      { id: newId(), label: "", isCorrect: true },
      { id: newId(), label: "", isCorrect: false },
    ],
    investigations: [],
    crossReference: "",
  };
}

export const emptyInvestigation = (): DraftInvestigation => ({ name: "", value: "", unit: "", referenceRange: "", interpretation: "" });

export const emptyDifferential = (): DraftDifferential => ({
  name: "",
  aliases: [],
  whyConsidered: "",
  whyRejected: "",
  clinicalExplanation: "",
  crossReferences: [],
});

export const emptyWrongAnswer = (): DraftWrongAnswer => ({ condition: "", aliases: [], explanation: "", missedClues: [], betterDirection: "" });

export function emptyReference(newId: () => string): DraftReference {
  return { id: newId(), title: "", authors: "", source: "", year: null, url: "", doi: "", pages: "", refType: "book", isPlaceholder: false, verified: false };
}

/** Plain-language labels for the editor. */
export const TERMINAL_BEHAVIOR_LABEL: Record<TerminalBehavior, { title: string; help: string }> = {
  REVEAL_ANSWER: { title: "End and show the answer", help: "Recommended. A wrong answer on the last stage ends the case and shows the full explanation." },
  RETRY_FINAL_STAGE: { title: "Let them try the last stage again", help: "The wrong choice is crossed out and they try again until correct or out of lives." },
  ALLOW_FINAL_ATTEMPT: { title: "Give one more try, then show the answer", help: "Exactly one extra attempt at the last stage." },
  END_CASE: { title: "End without showing the answer", help: "Useful when learners should be able to retry the case later without spoilers." },
};

export const STATUS_LABEL: Record<PublicationStatus, string> = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Awaiting review",
  REVIEWED: "Reviewed",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/** Case ID shown for cases that were created before Case IDs existed (e.g. the demo cases). */
export function defaultCaseCode(caseNumber: number): string {
  return `CASE-${String(caseNumber).padStart(3, "0")}`;
}
