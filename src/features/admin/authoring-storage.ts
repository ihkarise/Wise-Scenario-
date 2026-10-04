import type { Differential } from "@/lib/engine/types";
import type { CaseDraftContent, DraftDifferential, DraftInvestigation, DraftWrongAnswer } from "./draft";

/**
 * How Case Manager fields are stored WITHOUT a schema change.
 *
 * Existing columns keep their meaning, so the current game and older code read them as before:
 *   answer_label ← diagnosis.displayName        final_explanation ← diagnosis.explanation
 *   key_clues    ← diagnosis.decisiveFindings   learning_points   ← learningPoints
 *   differentials ← {label, reason} derived from the differential diagnoses (reason = why rejected)
 * Everything else lives in the existing `cases.domain_fields` JSON column under the key `authoring`.
 * Other keys in `domain_fields` are never touched.
 */

export const AUTHORING_FORMAT_VERSION = 1;

export type StoredAuthoring = {
  formatVersion: number;
  caseCode: string;
  subcategory: string;
  learningObjective: string;
  lifeLossPerWrong: number;
  startingScore: number | null;
  wrongAnswerPenalty: number | null;
  diagnosis: { primary: string; acceptedAnswers: string[]; aliases: string[]; detailedExplanation: string; finalReasoning: string };
  differentialDiagnoses: DraftDifferential[];
  wrongAnswerExplanations: DraftWrongAnswer[];
  clinicalSummary: string;
  clinicalInsight: string;
  diagnosticReasoning: string;
  investigationSummary: string;
  whereReasoningCanGoWrong: string;
  /** Stage extras keyed by stage ID (stage rows themselves stay in case_stages). */
  stages: Record<string, { investigations: DraftInvestigation[]; crossReference: string }>;
};

export function toStoredAuthoring(c: CaseDraftContent): StoredAuthoring {
  return {
    formatVersion: AUTHORING_FORMAT_VERSION,
    caseCode: c.caseCode,
    subcategory: c.subcategory,
    learningObjective: c.learningObjective,
    lifeLossPerWrong: c.lifeLossPerWrong,
    startingScore: c.startingScore,
    wrongAnswerPenalty: c.wrongAnswerPenalty,
    diagnosis: {
      primary: c.diagnosis.primary,
      acceptedAnswers: c.diagnosis.acceptedAnswers,
      aliases: c.diagnosis.aliases,
      detailedExplanation: c.diagnosis.detailedExplanation,
      finalReasoning: c.diagnosis.finalReasoning,
    },
    differentialDiagnoses: c.differentialDiagnoses,
    wrongAnswerExplanations: c.wrongAnswerExplanations,
    clinicalSummary: c.clinicalSummary,
    clinicalInsight: c.clinicalInsight,
    diagnosticReasoning: c.diagnosticReasoning,
    investigationSummary: c.investigationSummary,
    whereReasoningCanGoWrong: c.whereReasoningCanGoWrong,
    stages: Object.fromEntries(
      c.stages
        .filter((s) => s.investigations.length > 0 || s.crossReference.trim())
        .map((s) => [s.id, { investigations: s.investigations, crossReference: s.crossReference }]),
    ),
  };
}

/** The legacy `differentials` column, kept in sync so the existing result screen shows them as before. */
export function legacyDifferentials(list: readonly DraftDifferential[]): Differential[] {
  return list
    .map((d) => ({ label: d.name.trim(), reason: (d.whyRejected.trim() || d.whyConsidered.trim()).slice(0, 1000) }))
    .filter((d) => d.label && d.reason);
}

/* --------------------------------------------------------------------------------------------- */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Reads `domain_fields.authoring` leniently. Returns null for cases created before the Case Manager. */
export function readStoredAuthoring(domainFields: unknown): StoredAuthoring | null {
  const raw = obj(obj(domainFields).authoring);
  if (typeof raw.formatVersion !== "number") return null;
  const dx = obj(raw.diagnosis);
  const stages: StoredAuthoring["stages"] = {};
  for (const [id, value] of Object.entries(obj(raw.stages))) {
    const v = obj(value);
    stages[id] = {
      investigations: (Array.isArray(v.investigations) ? v.investigations : []).map((i) => {
        const x = obj(i);
        return { name: s(x.name), value: s(x.value), unit: s(x.unit), referenceRange: s(x.referenceRange), interpretation: s(x.interpretation) };
      }),
      crossReference: s(v.crossReference),
    };
  }
  return {
    formatVersion: raw.formatVersion,
    caseCode: s(raw.caseCode),
    subcategory: s(raw.subcategory),
    learningObjective: s(raw.learningObjective),
    lifeLossPerWrong: num(raw.lifeLossPerWrong) ?? 1,
    startingScore: num(raw.startingScore),
    wrongAnswerPenalty: num(raw.wrongAnswerPenalty),
    diagnosis: {
      primary: s(dx.primary),
      acceptedAnswers: strings(dx.acceptedAnswers),
      aliases: strings(dx.aliases),
      detailedExplanation: s(dx.detailedExplanation),
      finalReasoning: s(dx.finalReasoning),
    },
    differentialDiagnoses: (Array.isArray(raw.differentialDiagnoses) ? raw.differentialDiagnoses : []).map((d) => {
      const x = obj(d);
      return {
        name: s(x.name),
        aliases: strings(x.aliases),
        whyConsidered: s(x.whyConsidered),
        whyRejected: s(x.whyRejected),
        clinicalExplanation: s(x.clinicalExplanation),
        crossReferences: strings(x.crossReferences),
      };
    }),
    wrongAnswerExplanations: (Array.isArray(raw.wrongAnswerExplanations) ? raw.wrongAnswerExplanations : []).map((w) => {
      const x = obj(w);
      return { condition: s(x.condition), aliases: strings(x.aliases), explanation: s(x.explanation), missedClues: strings(x.missedClues), betterDirection: s(x.betterDirection) };
    }),
    clinicalSummary: s(raw.clinicalSummary),
    clinicalInsight: s(raw.clinicalInsight),
    diagnosticReasoning: s(raw.diagnosticReasoning),
    investigationSummary: s(raw.investigationSummary),
    whereReasoningCanGoWrong: s(raw.whereReasoningCanGoWrong),
    stages,
  };
}
