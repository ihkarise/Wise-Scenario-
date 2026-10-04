import {
  DIFFICULTIES,
  PUBLICATION_STATUSES,
  TERMINAL_BEHAVIORS,
  type Difficulty,
  type PublicationStatus,
  type TerminalBehavior,
} from "@/lib/engine/types";
import { matchesAny, normalizeText } from "@/lib/matching/text";
import {
  buildOptionsFromAuthorContent,
  CASE_CODE_PATTERN,
  DEFAULT_DOMAIN_NAME,
  DEFAULT_QUESTION,
  LIMITS,
  REFERENCE_TYPES,
  slugify,
  type CaseDraft,
  type CaseDraftContent,
  type DraftStage,
  type ReferenceType,
} from "@/features/admin/draft";

/**
 * The WiseCases case JSON format (version 1): what authors import, export and download as a template.
 * See data/case-template.json and docs/CASE-MANAGER.md.
 *
 * Medical-safety rule: the validator only CHECKS what the author wrote. It never adds explanations,
 * differentials, references or investigation results. The one convenience is building answer options
 * for a stage from names the author supplied (diagnosis + differentials), and the report says so.
 */

export const CASE_FORMAT = "wisecases.case";
export const CASE_FORMAT_VERSION = 1;

export type DocOption = { label: string; correct: boolean };
export type DocInvestigation = { test: string; value: string; unit: string; referenceRange: string; interpretation: string };
export type DocStage = {
  stageNumber: number;
  title: string;
  clue: string;
  decisionPoint: { question: string; options: DocOption[] } | null;
  hint: string;
  explanation: string;
  investigations: DocInvestigation[];
  crossReference: string;
  lifeCost: number | null;
  showPreviousClues: boolean;
};
export type DocDiagnosis = {
  primary: string;
  displayName: string;
  acceptedAnswers: string[];
  aliases: string[];
  explanation: string;
  detailedExplanation: string;
  decisiveFindings: string[];
  finalReasoning: string;
};
export type DocDifferential = {
  name: string;
  aliases: string[];
  whyConsidered: string;
  whyRejected: string;
  clinicalExplanation: string;
  crossReferences: string[];
};
export type DocWrongAnswer = { condition: string; aliases: string[]; explanation: string; missedClues: string[]; betterDirection: string };
export type DocReference = {
  title: string;
  authors: string;
  source: string;
  year: number | null;
  url: string;
  doi: string;
  pages: string;
  type: ReferenceType;
  verified: boolean;
};

/** A validated, normalised case document. Optional text that was not supplied is "" (never invented). */
export type CaseDocument = {
  id: string;
  title: string;
  domain: string;
  category: string;
  subcategory: string;
  difficulty: Difficulty;
  status: PublicationStatus;
  summary: string;
  learningObjective: string;
  startingLives: number;
  lifeLossPerWrong: number;
  startingScore: number;
  wrongAnswerPenalty: number | null;
  finalStageBehavior: TerminalBehavior;
  revealCorrectOptionOnWrong: boolean;
  stages: DocStage[];
  diagnosis: DocDiagnosis;
  differentialDiagnoses: DocDifferential[];
  wrongAnswerExplanations: DocWrongAnswer[];
  clinicalSummary: string;
  clinicalInsight: string;
  diagnosticReasoning: string;
  investigationSummary: string;
  whereReasoningCanGoWrong: string;
  learningPoints: string[];
  references: DocReference[];
};

export type CheckLevel = "ok" | "error" | "warning" | "info";
export type CheckItem = { level: CheckLevel; message: string };
export type DocumentValidation = { ok: boolean; items: CheckItem[]; document: CaseDocument | null };

/* ------------------------------------------------------------------------------------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const TEMPLATE_MARK = /^\s*TEMPLATE:/i;

const KNOWN = {
  root: [
    "$schema", "format", "formatVersion", "id", "title", "domain", "category", "subcategory", "difficulty", "status", "summary",
    "learningObjective", "startingLives", "lifeLossPerWrong", "startingScore", "wrongAnswerPenalty", "finalStageBehavior",
    "revealCorrectOptionOnWrong", "stages", "diagnosis", "differentialDiagnoses", "wrongAnswerExplanations", "clinicalSummary",
    "clinicalInsight", "diagnosticReasoning", "investigationSummary", "whereReasoningCanGoWrong", "learningPoints", "references", "_notes",
  ],
  stage: ["stageNumber", "title", "clue", "decisionPoint", "hint", "explanation", "investigations", "crossReference", "lifeCost", "showPreviousClues", "_notes"],
  decisionPoint: ["question", "options"],
  option: ["label", "correct"],
  investigation: ["test", "value", "unit", "referenceRange", "interpretation"],
  diagnosis: ["primary", "displayName", "acceptedAnswers", "aliases", "explanation", "detailedExplanation", "decisiveFindings", "finalReasoning"],
  differential: ["name", "aliases", "whyConsidered", "whyRejected", "clinicalExplanation", "crossReferences"],
  wrongAnswer: ["condition", "aliases", "explanation", "missedClues", "betterDirection"],
  reference: ["title", "authors", "source", "year", "url", "doi", "pages", "type", "verified"],
} as const;

class Report {
  readonly items: CheckItem[] = [];
  templateFields = 0;
  ok(message: string) {
    this.items.push({ level: "ok", message });
  }
  error(message: string) {
    this.items.push({ level: "error", message });
  }
  warn(message: string) {
    this.items.push({ level: "warning", message });
  }
  info(message: string) {
    this.items.push({ level: "info", message });
  }
  get hasErrors() {
    return this.items.some((i) => i.level === "error");
  }
}

function unknownKeys(r: Report, obj: Obj, known: readonly string[], where: string) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) r.warn(`${where} has an unknown field “${key}”. It will be ignored. Check the spelling.`);
  }
}

/** Reads optional/required text. Returns "" when absent. */
function text(r: Report, obj: Obj, key: string, label: string, max: number, required = false): string {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (required) r.error(`${label} is missing.`);
    return "";
  }
  if (typeof v !== "string") {
    r.error(`${label} must be text.`);
    return "";
  }
  const s = v.trim();
  if (required && !s) r.error(`${label} is empty.`);
  if (s.length > max) r.error(`${label} is too long (${s.length} characters; the limit is ${max}).`);
  if (TEMPLATE_MARK.test(s)) r.templateFields++;
  return s;
}

function textList(r: Report, obj: Obj, key: string, label: string, maxItems: number, maxLength: number): string[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    r.error(`${label} must be a list.`);
    return [];
  }
  const out: string[] = [];
  v.forEach((item, i) => {
    if (typeof item !== "string") return r.error(`${label}, item ${i + 1} must be text.`);
    const s = item.trim();
    if (!s) return;
    if (s.length > maxLength) r.error(`${label}, item ${i + 1} is too long (limit ${maxLength} characters).`);
    if (TEMPLATE_MARK.test(s)) r.templateFields++;
    out.push(s);
  });
  if (out.length > maxItems) r.error(`${label} has ${out.length} items; the limit is ${maxItems}.`);
  return out;
}

function int(r: Report, obj: Obj, key: string, label: string, min: number, max: number, required: boolean): number | null {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (required) r.error(`${label} is missing.`);
    return null;
  }
  if (typeof v !== "number" || !Number.isInteger(v)) {
    r.error(`${label} must be a whole number.`);
    return null;
  }
  if (v < min || v > max) {
    r.error(`${label} must be between ${min} and ${max}.`);
    return null;
  }
  return v;
}

function bool(r: Report, obj: Obj, key: string, label: string, fallback: boolean): boolean {
  const v = obj[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") {
    r.error(`${label} must be true or false.`);
    return fallback;
  }
  return v;
}

/** Matches an enum value case-insensitively, treating spaces and dashes as underscores. */
function enumValue<T extends string>(r: Report, obj: Obj, key: string, label: string, values: readonly T[], required: boolean): T | null {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (required) r.error(`${label} is missing. Use one of: ${values.map((x) => x.toLowerCase()).join(", ")}.`);
    return null;
  }
  const wanted = typeof v === "string" ? v.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
  const match = values.find((x) => x === wanted);
  if (!match) r.error(`${label} “${String(v)}” is not recognised. Use one of: ${values.map((x) => x.toLowerCase()).join(", ")}.`);
  return match ?? null;
}

function list(r: Report, obj: Obj, key: string, label: string): Obj[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    r.error(`${label} must be a list.`);
    return [];
  }
  return v.filter((item, i) => {
    if (!isObj(item)) r.error(`${label}, item ${i + 1} must be an object with named fields.`);
    return isObj(item);
  }) as Obj[];
}

/* ------------------------------------------------------------------------------------------- */

export { parseJsonText } from "./parse-json";

/** Validates one case. Never changes the author's text; reports every problem it finds. */
export function validateCaseDocument(input: unknown): DocumentValidation {
  const r = new Report();
  if (!isObj(input)) {
    r.error(Array.isArray(input) ? "The file contains a list. Import one case per file (a single { … } object)." : "The file must contain one case as a { … } object.");
    return { ok: false, items: r.items, document: null };
  }
  unknownKeys(r, input, KNOWN.root, "The case");

  if (input.format !== undefined && input.format !== CASE_FORMAT) r.warn(`“format” should be “${CASE_FORMAT}”.`);
  if (input.formatVersion !== undefined && input.formatVersion !== CASE_FORMAT_VERSION) {
    r.error(`This file uses format version ${String(input.formatVersion)}; this Case Manager reads version ${CASE_FORMAT_VERSION}.`);
  }

  /* Basic information ------------------------------------------------------------------------ */
  const id = text(r, input, "id", "Case ID", 40, true);
  if (id && !CASE_CODE_PATTERN.test(id)) r.error(`Case ID “${id}” may only use letters, numbers, dots, dashes and underscores (up to 40).`);
  else if (id) r.ok(`Case ID ${id}`);
  const title = text(r, input, "title", "Title", 200, true);
  if (title) r.ok("Title");
  const domain = text(r, input, "domain", "Domain", 80) || DEFAULT_DOMAIN_NAME;
  const category = text(r, input, "category", "Category", 80, true);
  if (category) r.ok(`Category: ${category}`);
  const subcategory = text(r, input, "subcategory", "Subcategory", 80);
  const difficulty = enumValue(r, input, "difficulty", "Difficulty", DIFFICULTIES, true);
  if (difficulty) r.ok(`Difficulty: ${difficulty.toLowerCase()}`);
  const status = enumValue(r, input, "status", "Status", PUBLICATION_STATUSES, true);
  if (status) {
    r.ok(`Status: ${status.toLowerCase()}`);
    r.info("Imported cases always start as drafts. Only a super administrator can publish.");
  }
  const summary = text(r, input, "summary", "Summary", 500);
  const learningObjective = text(r, input, "learningObjective", "Learning objective", 1000);
  const lives = int(r, input, "startingLives", "Starting lives", LIMITS.minLives, LIMITS.maxLives, true);
  if (lives !== null) r.ok(`Lives: ${lives}`);
  const lifeLoss = int(r, input, "lifeLossPerWrong", "Life loss per wrong answer", 0, LIMITS.maxLifeCost, false) ?? 1;
  if (lives !== null && lifeLoss > lives) r.error("Life loss per wrong answer is more than the starting lives.");
  const score = int(r, input, "startingScore", "Starting score", 0, LIMITS.maxScore, true);
  const penalty = int(r, input, "wrongAnswerPenalty", "Wrong-answer penalty", 0, LIMITS.maxScore, false);
  if (score !== null) r.ok(`Score: starts at ${score}${penalty !== null ? `, −${penalty} per wrong answer` : ""}`);
  const finalStageBehavior = enumValue(r, input, "finalStageBehavior", "Final stage behaviour", TERMINAL_BEHAVIORS, false) ?? "REVEAL_ANSWER";
  const revealCorrectOptionOnWrong = bool(r, input, "revealCorrectOptionOnWrong", "revealCorrectOptionOnWrong", false);

  /* Diagnosis -------------------------------------------------------------------------------- */
  let diagnosis: DocDiagnosis = {
    primary: "",
    displayName: "",
    acceptedAnswers: [],
    aliases: [],
    explanation: "",
    detailedExplanation: "",
    decisiveFindings: [],
    finalReasoning: "",
  };
  if (!isObj(input.diagnosis)) {
    r.error(input.diagnosis === undefined ? "Diagnosis is missing." : "Diagnosis must be an object with named fields.");
  } else {
    const d = input.diagnosis;
    unknownKeys(r, d, KNOWN.diagnosis, "Diagnosis");
    const primary = text(r, d, "primary", "Diagnosis primary name", 200, true);
    diagnosis = {
      primary,
      displayName: text(r, d, "displayName", "Diagnosis display name", 300) || primary,
      acceptedAnswers: textList(r, d, "acceptedAnswers", "Accepted answers", LIMITS.maxNames, 200),
      aliases: textList(r, d, "aliases", "Diagnosis aliases", LIMITS.maxNames, 200),
      explanation: text(r, d, "explanation", "Diagnosis explanation", 8000),
      detailedExplanation: text(r, d, "detailedExplanation", "Detailed explanation", 8000),
      decisiveFindings: textList(r, d, "decisiveFindings", "Decisive findings", LIMITS.maxListItems, 500),
      finalReasoning: text(r, d, "finalReasoning", "Final reasoning", 8000),
    };
    if (primary) r.ok(`Diagnosis: ${diagnosis.displayName}`);
    if (diagnosis.acceptedAnswers.length === 0) r.error("Diagnosis has no accepted answers.");
    else r.ok(`Accepted answers (${diagnosis.acceptedAnswers.length})${diagnosis.aliases.length ? ` and aliases (${diagnosis.aliases.length})` : ""}`);
    if (!diagnosis.explanation) r.warn("No diagnosis explanation. The case can be imported, but not published until one is written.");
  }
  const dxNames = [diagnosis.primary, diagnosis.displayName, ...diagnosis.acceptedAnswers, ...diagnosis.aliases].filter(Boolean);

  /* Differentials and wrong answers ---------------------------------------------------------- */
  const differentialDiagnoses: DocDifferential[] = list(r, input, "differentialDiagnoses", "Differential diagnoses").map((d, i) => {
    const where = `Differential diagnosis ${i + 1}`;
    unknownKeys(r, d, KNOWN.differential, where);
    return {
      name: text(r, d, "name", `${where} name`, 200, true),
      aliases: textList(r, d, "aliases", `${where} aliases`, LIMITS.maxNames, 200),
      whyConsidered: text(r, d, "whyConsidered", `${where} “why considered”`, 1000),
      whyRejected: text(r, d, "whyRejected", `${where} “why rejected”`, 1000),
      clinicalExplanation: text(r, d, "clinicalExplanation", `${where} clinical explanation`, 4000),
      crossReferences: textList(r, d, "crossReferences", `${where} cross-references`, LIMITS.maxListItems, 500),
    };
  });
  if (differentialDiagnoses.length > LIMITS.maxDifferentials) r.error(`Too many differential diagnoses (limit ${LIMITS.maxDifferentials}).`);
  differentialDiagnoses.forEach((d, i) => {
    if (d.name && matchesAny(d.name, dxNames)) r.error(`Differential diagnosis ${i + 1} (“${d.name}”) is the same as the diagnosis.`);
  });
  if (differentialDiagnoses.length > 0) r.ok(`Differential diagnoses (${differentialDiagnoses.length})`);

  const wrongAnswerExplanations: DocWrongAnswer[] = list(r, input, "wrongAnswerExplanations", "Wrong-answer explanations").map((w, i) => {
    const where = `Wrong-answer explanation ${i + 1}`;
    unknownKeys(r, w, KNOWN.wrongAnswer, where);
    return {
      condition: text(r, w, "condition", `${where} condition`, 200, true),
      aliases: textList(r, w, "aliases", `${where} aliases`, LIMITS.maxNames, 200),
      explanation: text(r, w, "explanation", `${where} explanation`, 4000, true),
      missedClues: textList(r, w, "missedClues", `${where} missed clues`, LIMITS.maxListItems, 500),
      betterDirection: text(r, w, "betterDirection", `${where} better direction`, 2000),
    };
  });
  if (wrongAnswerExplanations.length > LIMITS.maxWrongAnswers) r.error(`Too many wrong-answer explanations (limit ${LIMITS.maxWrongAnswers}).`);
  if (wrongAnswerExplanations.length > 0) r.ok(`Wrong-answer explanations (${wrongAnswerExplanations.length})`);

  /* Stages ----------------------------------------------------------------------------------- */
  const rawStages = list(r, input, "stages", "Stages");
  if (input.stages === undefined) r.error("Stages are missing. A case needs at least one stage.");
  else if (rawStages.length === 0 && Array.isArray(input.stages)) r.error("A case needs at least one stage.");
  if (rawStages.length > LIMITS.maxStages) r.error(`Too many stages (${rawStages.length}; the limit is ${LIMITS.maxStages}).`);

  let generatedOptionStages = 0;
  let investigationCount = 0;
  const stages: DocStage[] = rawStages.map((s, i) => {
    const n = typeof s.stageNumber === "number" ? s.stageNumber : i + 1;
    const where = `Stage ${n}`;
    unknownKeys(r, s, KNOWN.stage, where);
    const stageNumber = int(r, s, "stageNumber", `${where} number`, 1, LIMITS.maxStages, true) ?? i + 1;
    const stageTitle = text(r, s, "title", `${where} title`, 120);
    if (!stageTitle) r.error(`${where} is missing a title.`);
    const clue = text(r, s, "clue", `${where} clue`, 4000);
    if (!clue) r.error(`${where} is missing a clue.`);
    const lifeCost = int(r, s, "lifeCost", `${where} life cost`, 0, LIMITS.maxLifeCost, false);
    if (lifeCost !== null && lives !== null && lifeCost > lives) r.error(`${where} costs more lives than the case has.`);

    let decisionPoint: DocStage["decisionPoint"] = null;
    if (s.decisionPoint !== undefined && s.decisionPoint !== null) {
      if (!isObj(s.decisionPoint)) {
        r.error(`${where} decision point must be an object with “question” and “options”.`);
      } else {
        const dp = s.decisionPoint;
        unknownKeys(r, dp, KNOWN.decisionPoint, `${where} decision point`);
        const question = text(r, dp, "question", `${where} question`, 500);
        const options = list(r, dp, "options", `${where} options`).map((o, j) => {
          unknownKeys(r, o, KNOWN.option, `${where}, option ${j + 1}`);
          return { label: text(r, o, "label", `${where}, option ${j + 1}`, 300, true), correct: bool(r, o, "correct", `${where}, option ${j + 1} “correct”`, false) };
        });
        if (options.length > 0) {
          if (options.length < LIMITS.minOptions || options.length > LIMITS.maxOptions) {
            r.error(`${where} needs between ${LIMITS.minOptions} and ${LIMITS.maxOptions} answer options.`);
          }
          const correct = options.filter((o) => o.correct);
          if (correct.length === 0) r.error(`${where} has no option marked "correct": true.`);
          if (correct.length > 1) r.error(`${where} has more than one correct option.`);
          const labels = options.map((o) => normalizeText(o.label));
          if (new Set(labels).size !== labels.length) r.error(`${where} has two answer options with the same text.`);
          if (correct.length === 1 && dxNames.length > 0 && !matchesAny(correct[0]!.label, dxNames)) {
            r.warn(`${where}: the correct option “${correct[0]!.label}” is not one of the diagnosis names or accepted answers. A correct answer ends the case.`);
          }
        }
        decisionPoint = { question, options };
      }
    }

    const investigations: DocInvestigation[] = list(r, s, "investigations", `${where} investigations`).map((inv, j) => {
      const w = `${where}, investigation ${j + 1}`;
      unknownKeys(r, inv, KNOWN.investigation, w);
      return {
        test: text(r, inv, "test", `${w} test name`, 200, true),
        value: text(r, inv, "value", `${w} value`, 200, true),
        unit: text(r, inv, "unit", `${w} unit`, 60),
        referenceRange: text(r, inv, "referenceRange", `${w} reference range`, 200),
        interpretation: text(r, inv, "interpretation", `${w} interpretation`, 1000),
      };
    });
    if (investigations.length > LIMITS.maxInvestigations) r.error(`${where} has too many investigations (limit ${LIMITS.maxInvestigations}).`);
    investigationCount += investigations.length;

    if (!decisionPoint || decisionPoint.options.length === 0) generatedOptionStages++;

    return {
      stageNumber,
      title: stageTitle,
      clue,
      decisionPoint,
      hint: text(r, s, "hint", `${where} hint`, 500),
      explanation: text(r, s, "explanation", `${where} explanation`, 4000),
      investigations,
      crossReference: text(r, s, "crossReference", `${where} cross-reference`, 1000),
      lifeCost,
      showPreviousClues: bool(r, s, "showPreviousClues", `${where} showPreviousClues`, true),
    };
  });

  const numbers = stages.map((s) => s.stageNumber).sort((a, b) => a - b);
  if (numbers.some((n, i) => n !== i + 1)) {
    r.error(`Stage numbers must run 1, 2, 3 … without gaps or repeats (found ${numbers.join(", ")}).`);
  } else if (stages.length > 0 && !stages.some((s) => !s.clue || !s.title)) {
    r.ok(`${stages.length} ${stages.length === 1 ? "stage" : "stages"}`);
  }
  stages.sort((a, b) => a.stageNumber - b.stageNumber);

  if (generatedOptionStages > 0 && diagnosis.primary) {
    const built = buildOptionsFromAuthorContent({ diagnosis, differentialDiagnoses, wrongAnswerExplanations }, "check", () => "x");
    if (!built) {
      r.error(
        `${generatedOptionStages === 1 ? "A stage has" : `${generatedOptionStages} stages have`} no answer options, and there are no differential diagnoses to build them from. Add decisionPoint.options or differentialDiagnoses.`,
      );
    } else {
      r.info(
        `${generatedOptionStages === 1 ? "1 stage has" : `${generatedOptionStages} stages have`} no answer options. They will be built from your diagnosis and differential diagnoses (${built.length} options), and you can change them in the editor.`,
      );
    }
  }
  if (stages.some((s) => !s.decisionPoint?.question)) r.info(`Stages without a question will ask: “${DEFAULT_QUESTION}”`);
  if (investigationCount > 0) r.ok(`Investigations (${investigationCount})`);

  /* Teaching --------------------------------------------------------------------------------- */
  const clinicalSummary = text(r, input, "clinicalSummary", "Clinical summary", 8000);
  const clinicalInsight = text(r, input, "clinicalInsight", "Clinical insight", 8000);
  const diagnosticReasoning = text(r, input, "diagnosticReasoning", "Diagnostic reasoning", 8000);
  const investigationSummary = text(r, input, "investigationSummary", "Investigation summary", 8000);
  const whereReasoningCanGoWrong = text(r, input, "whereReasoningCanGoWrong", "Where reasoning can go wrong", 8000);
  const learningPoints = textList(r, input, "learningPoints", "Learning points", LIMITS.maxListItems, 500);
  if (learningPoints.length > 0) r.ok(`Learning points (${learningPoints.length})`);
  else r.warn("No learning points.");

  const references: DocReference[] = list(r, input, "references", "References").map((ref, i) => {
    const where = `Reference ${i + 1}`;
    unknownKeys(r, ref, KNOWN.reference, where);
    const url = text(r, ref, "url", `${where} web address`, 2000);
    if (url && !/^https?:\/\/\S+$/i.test(url)) r.error(`${where} web address must start with http:// or https://.`);
    const typeRaw = text(r, ref, "type", `${where} type`, 20).toLowerCase();
    if (typeRaw && !(REFERENCE_TYPES as readonly string[]).includes(typeRaw)) {
      r.error(`${where} type “${typeRaw}” is not recognised. Use one of: ${REFERENCE_TYPES.join(", ")}.`);
    }
    return {
      title: text(r, ref, "title", `${where} title`, 500, true),
      authors: text(r, ref, "authors", `${where} authors`, 500),
      source: text(r, ref, "source", `${where} source`, 300),
      year: int(r, ref, "year", `${where} year`, 1500, 2100, false),
      url,
      doi: text(r, ref, "doi", `${where} DOI`, 200),
      pages: text(r, ref, "pages", `${where} pages`, 50),
      type: ((REFERENCE_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "other") as ReferenceType,
      verified: bool(r, ref, "verified", `${where} “verified”`, false),
    };
  });
  if (references.length > LIMITS.maxReferences) r.error(`Too many references (limit ${LIMITS.maxReferences}).`);
  if (references.length > 0) {
    r.ok(`References (${references.length})`);
    const unverified = references.filter((x) => !x.verified).length;
    if (unverified > 0) r.info(`${unverified} reference${unverified === 1 ? " is" : "s are"} marked as not verified and will be shown to learners that way.`);
  } else {
    r.warn("No references.");
  }

  if (r.templateFields > 0) {
    r.warn(`${r.templateFields} field${r.templateFields === 1 ? " still contains" : "s still contain"} template text (starting with “TEMPLATE:”). Replace it with your own content.`);
  }

  if (r.hasErrors || !difficulty || !status || lives === null || score === null) {
    return { ok: false, items: sortItems(r.items), document: null };
  }
  return {
    ok: true,
    items: sortItems(r.items),
    document: {
      id,
      title,
      domain,
      category,
      subcategory,
      difficulty,
      status,
      summary,
      learningObjective,
      startingLives: lives,
      lifeLossPerWrong: lifeLoss,
      startingScore: score,
      wrongAnswerPenalty: penalty,
      finalStageBehavior,
      revealCorrectOptionOnWrong,
      stages,
      diagnosis,
      differentialDiagnoses,
      wrongAnswerExplanations,
      clinicalSummary,
      clinicalInsight,
      diagnosticReasoning,
      investigationSummary,
      whereReasoningCanGoWrong,
      learningPoints,
      references,
    },
  };
}

const ORDER: Record<CheckLevel, number> = { ok: 0, info: 1, warning: 2, error: 3 };
function sortItems(items: CheckItem[]): CheckItem[] {
  return [...items].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}

/* ---------------------------------------------------------------------------------------------
 * Document ⇄ draft
 * ------------------------------------------------------------------------------------------- */

/** Converts a validated document into editable draft content. New IDs for every stage, option and reference. */
export function documentToDraftContent(doc: CaseDocument, ctx: { domainId: string; slug: string; newId: () => string }): CaseDraftContent {
  const authorNames = {
    diagnosis: doc.diagnosis,
    differentialDiagnoses: doc.differentialDiagnoses,
    wrongAnswerExplanations: doc.wrongAnswerExplanations,
  };
  const stages: DraftStage[] = doc.stages.map((s) => {
    const given = s.decisionPoint?.options ?? [];
    const options =
      given.length > 0
        ? given.map((o) => ({ id: ctx.newId(), label: o.label, isCorrect: o.correct }))
        : (buildOptionsFromAuthorContent(authorNames, `${doc.id}|${s.stageNumber}`, ctx.newId) ?? []);
    return {
      id: ctx.newId(),
      title: s.title,
      content: s.clue,
      question: s.decisionPoint?.question || DEFAULT_QUESTION,
      hint: s.hint,
      explanation: s.explanation,
      lifeCost: s.lifeCost ?? doc.lifeLossPerWrong,
      showPreviousClues: s.showPreviousClues,
      options,
      investigations: s.investigations.map((i) => ({
        name: i.test,
        value: i.value,
        unit: i.unit,
        referenceRange: i.referenceRange,
        interpretation: i.interpretation,
      })),
      crossReference: s.crossReference,
    };
  });

  return {
    caseCode: doc.id,
    title: doc.title,
    slug: ctx.slug,
    summary: doc.summary,
    learningObjective: doc.learningObjective,
    domainId: ctx.domainId,
    category: doc.category,
    subcategory: doc.subcategory,
    difficulty: doc.difficulty,
    maxLives: doc.startingLives,
    lifeLossPerWrong: doc.lifeLossPerWrong,
    startingScore: doc.startingScore,
    wrongAnswerPenalty: doc.wrongAnswerPenalty,
    terminalBehavior: doc.finalStageBehavior,
    revealCorrectOptionOnWrong: doc.revealCorrectOptionOnWrong,
    stages,
    diagnosis: { ...doc.diagnosis },
    differentialDiagnoses: doc.differentialDiagnoses.map((d) => ({ ...d })),
    wrongAnswerExplanations: doc.wrongAnswerExplanations.map((w) => ({ ...w })),
    clinicalSummary: doc.clinicalSummary,
    clinicalInsight: doc.clinicalInsight,
    diagnosticReasoning: doc.diagnosticReasoning,
    investigationSummary: doc.investigationSummary,
    whereReasoningCanGoWrong: doc.whereReasoningCanGoWrong,
    learningPoints: [...doc.learningPoints],
    references: doc.references.map((ref) => ({
      id: ctx.newId(),
      title: ref.title,
      authors: ref.authors,
      source: ref.source,
      year: ref.year,
      url: ref.url,
      doi: ref.doi,
      pages: ref.pages,
      refType: ref.type,
      isPlaceholder: false,
      verified: ref.verified,
    })),
  };
}

/** Removes empty optional values so exported files stay readable. */
function compact<T extends Obj>(obj: T): Partial<T> {
  const out: Obj = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** The structured JSON representation of a case, for export. Contains only what the author wrote. */
export function draftToDocument(draft: CaseDraftContent & Partial<Pick<CaseDraft, "status">>, names: { domain: string }): Obj {
  return {
    format: CASE_FORMAT,
    formatVersion: CASE_FORMAT_VERSION,
    ...compact({
      id: draft.caseCode,
      title: draft.title,
      domain: names.domain,
      category: draft.category,
      subcategory: draft.subcategory,
      difficulty: draft.difficulty.toLowerCase(),
      status: (draft.status ?? "DRAFT").toLowerCase(),
      summary: draft.summary,
      learningObjective: draft.learningObjective,
      startingLives: draft.maxLives,
      lifeLossPerWrong: draft.lifeLossPerWrong,
      startingScore: draft.startingScore,
      wrongAnswerPenalty: draft.wrongAnswerPenalty,
      finalStageBehavior: draft.terminalBehavior.toLowerCase(),
    }),
    ...(draft.revealCorrectOptionOnWrong ? { revealCorrectOptionOnWrong: true } : {}),
    stages: draft.stages.map((s, i) => ({
      stageNumber: i + 1,
      ...compact({ title: s.title, clue: s.content }),
      decisionPoint: {
        question: s.question,
        options: s.options.filter((o) => o.label.trim()).map((o) => (o.isCorrect ? { label: o.label, correct: true } : { label: o.label })),
      },
      ...compact({
        hint: s.hint,
        explanation: s.explanation,
        investigations: s.investigations.map((inv) => compact({ test: inv.name, value: inv.value, unit: inv.unit, referenceRange: inv.referenceRange, interpretation: inv.interpretation })),
        crossReference: s.crossReference,
      }),
      ...(s.lifeCost !== draft.lifeLossPerWrong ? { lifeCost: s.lifeCost } : {}),
      ...(s.showPreviousClues ? {} : { showPreviousClues: false }),
    })),
    diagnosis: compact({ ...draft.diagnosis }),
    ...compact({
      differentialDiagnoses: draft.differentialDiagnoses.map((d) => compact({ ...d })),
      wrongAnswerExplanations: draft.wrongAnswerExplanations.map((w) => compact({ ...w })),
      clinicalSummary: draft.clinicalSummary,
      clinicalInsight: draft.clinicalInsight,
      diagnosticReasoning: draft.diagnosticReasoning,
      investigationSummary: draft.investigationSummary,
      whereReasoningCanGoWrong: draft.whereReasoningCanGoWrong,
      learningPoints: draft.learningPoints,
      references: draft.references.map((ref) =>
        compact({
          title: ref.title,
          authors: ref.authors,
          source: ref.source,
          year: ref.year,
          url: ref.url,
          doi: ref.doi,
          pages: ref.pages,
          type: ref.refType,
          verified: ref.verified && !ref.isPlaceholder ? true : null,
        }),
      ),
    }),
  };
}

/** File name for an exported case, e.g. CASE-005-the-hidden-liver-disease.json */
export function exportFileName(draft: Pick<CaseDraftContent, "caseCode" | "title">): string {
  return `${draft.caseCode.replace(/[^A-Za-z0-9._-]/g, "") || "case"}-${slugify(draft.title).slice(0, 40)}.json`;
}
