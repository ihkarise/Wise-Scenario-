import type { PublicationStatus } from "@/lib/engine/types";
import { diceSimilarity, normalizeText, wordSetSimilarity } from "@/lib/matching/text";

/**
 * Duplicate detection for new and imported cases. Pure scoring; the service supplies existing cases.
 * Nothing is ever overwritten or merged: matches are only reported so the author can decide.
 */

export type CaseFingerprint = {
  caseCode: string;
  title: string;
  /** Primary, display, accepted answers and aliases. */
  diagnosisNames: string[];
  /** All clue text joined; may be empty when not loaded. */
  clueText: string;
};

export type ExistingCase = CaseFingerprint & { id: string; caseNumber: number; status: PublicationStatus };

export type DuplicateMatch = {
  caseId: string;
  caseNumber: number;
  caseCode: string;
  title: string;
  status: PublicationStatus;
  /** 0–100. */
  similarity: number;
  sameCaseId: boolean;
  reasons: string[];
};

export const DUPLICATE_THRESHOLD = 60;

export function sameCaseCode(a: string, b: string): boolean {
  return a.trim().length > 0 && a.trim().toUpperCase() === b.trim().toUpperCase();
}

export function titleSimilarity(a: string, b: string): number {
  return diceSimilarity(a, b);
}

/** 1 when the two cases share any diagnosis name (after normalisation); otherwise the best title-style similarity. */
export function diagnosisSimilarity(a: readonly string[], b: readonly string[]): number {
  const na = a.map(normalizeText).filter(Boolean);
  const nb = new Set(b.map(normalizeText).filter(Boolean));
  if (na.length === 0 || nb.size === 0) return 0;
  if (na.some((n) => nb.has(n))) return 1;
  let best = 0;
  for (const x of na) for (const y of nb) best = Math.max(best, diceSimilarity(x, y));
  return best;
}

/** Quick check (no clue text) used to decide which existing cases are worth comparing in full. */
export function isCandidate(candidate: CaseFingerprint, existing: CaseFingerprint): boolean {
  return (
    sameCaseCode(candidate.caseCode, existing.caseCode) ||
    titleSimilarity(candidate.title, existing.title) >= 0.5 ||
    diagnosisSimilarity(candidate.diagnosisNames, existing.diagnosisNames) >= 0.8
  );
}

export function compareCases(candidate: CaseFingerprint, existing: ExistingCase): DuplicateMatch | null {
  const sameCaseId = sameCaseCode(candidate.caseCode, existing.caseCode);
  const title = titleSimilarity(candidate.title, existing.title);
  const diagnosis = diagnosisSimilarity(candidate.diagnosisNames, existing.diagnosisNames);
  const hasClues = candidate.clueText.trim().length > 0 && existing.clueText.trim().length > 0;
  const clues = hasClues ? wordSetSimilarity(candidate.clueText, existing.clueText) : 0;

  const weighted = hasClues ? 0.35 * title + 0.3 * diagnosis + 0.35 * clues : (0.35 * title + 0.3 * diagnosis) / 0.65;
  const similarity = sameCaseId ? 100 : Math.round(weighted * 100);

  const reasons: string[] = [];
  if (sameCaseId) reasons.push(`Same Case ID (${existing.caseCode})`);
  if (title >= 0.999) reasons.push("Same title");
  else if (title >= 0.6) reasons.push(`Similar title (${Math.round(title * 100)}%)`);
  if (diagnosis >= 0.999) reasons.push("Same diagnosis");
  else if (diagnosis >= 0.7) reasons.push(`Similar diagnosis (${Math.round(diagnosis * 100)}%)`);
  if (clues >= 0.4) reasons.push(`Similar clues (${Math.round(clues * 100)}%)`);

  const flagged = sameCaseId || similarity >= DUPLICATE_THRESHOLD || title >= 0.85 || clues >= 0.6;
  if (!flagged) return null;
  return {
    caseId: existing.id,
    caseNumber: existing.caseNumber,
    caseCode: existing.caseCode,
    title: existing.title,
    status: existing.status,
    similarity,
    sameCaseId,
    reasons,
  };
}

/** Matches, most similar first. Exact Case ID matches always come first. */
export function findDuplicates(candidate: CaseFingerprint, existing: readonly ExistingCase[], limit = 5): DuplicateMatch[] {
  return existing
    .map((e) => compareCases(candidate, e))
    .filter((m): m is DuplicateMatch => m !== null)
    .sort((a, b) => Number(b.sameCaseId) - Number(a.sameCaseId) || b.similarity - a.similarity)
    .slice(0, limit);
}
