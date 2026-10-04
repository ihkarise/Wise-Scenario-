/**
 * Text matching helpers shared by the server (answer checks, duplicate detection, condition search)
 * and the Case Manager (authoring checks). Pure functions only.
 *
 * Correctness of a learner's answer is NEVER decided here by similarity: answers are matched only by
 * normalised exact comparison against the author's accepted answers and aliases. Similarity scores are
 * used for duplicate warnings and autocomplete suggestions, never for marking.
 */

/**
 * Normalises an answer for comparison: Unicode-normalised, lower case, accents removed, apostrophes
 * removed ("Wilson's disease" = "Wilsons disease"), other punctuation treated as a space
 * ("Budd-Chiari" = "Budd Chiari"), and runs of whitespace collapsed.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True when `input` equals one of `candidates` after normalisation (exact, case-insensitive, spacing-insensitive). */
export function matchesAny(input: string, candidates: readonly string[]): boolean {
  const target = normalizeText(input);
  if (!target) return false;
  return candidates.some((c) => normalizeText(c) === target);
}

export type AnswerKey = { primary: string; displayName?: string; acceptedAnswers: readonly string[]; aliases: readonly string[] };

/** All the names that count as this diagnosis: primary, display name, accepted answers and aliases. */
export function answerKeyNames(key: AnswerKey): string[] {
  return [key.primary, key.displayName ?? "", ...key.acceptedAnswers, ...key.aliases].filter((s) => s.trim().length > 0);
}

/** Whether an answer matches a diagnosis by exact, case-insensitive, normalised-spacing or alias match. */
export function matchesAnswerKey(input: string, key: AnswerKey): boolean {
  return matchesAny(input, answerKeyNames(key));
}

export function words(value: string): string[] {
  const n = normalizeText(value);
  return n ? n.split(" ") : [];
}

function bigrams(value: string): Map<string, number> {
  const s = ` ${normalizeText(value)} `;
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

/** Dice coefficient on character bigrams (0–1). Good for short strings such as titles. */
export function diceSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    overlap += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Jaccard similarity of word sets (0–1). Good for longer text such as clue paragraphs. */
export function wordSetSimilarity(a: string, b: string): number {
  const sa = new Set(words(a));
  const sb = new Set(words(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Optimal-string-alignment (Damerau–Levenshtein) distance, stopping early above `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length]!;
}

/** Typo allowance by word length: none for short words, 1 from 4 letters, 2 from 8. */
export function typoAllowance(length: number): number {
  return length >= 8 ? 2 : length >= 4 ? 1 : 0;
}
