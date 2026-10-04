import { editDistance, normalizeText, typoAllowance, words } from "@/lib/matching/text";

/**
 * Condition inventory and search (diagnosis autocomplete for AUTHORS).
 *
 * Sources: the starter terminology list in data/conditions.json, plus diagnosis and differential names
 * that authors have already written into cases. This is an authoring aid only. The learner game has
 * no free-text answer box, so autocomplete can never reveal a case's answer during play; it is served
 * only to signed-in staff.
 */

export type Condition = {
  name: string;
  aliases: string[];
  keywords: string[];
  specialty: string;
  category: string;
  source: "inventory" | "cases";
};

export type ConditionSeed = Omit<Condition, "source">;

type Indexed = {
  condition: Condition;
  name: string;
  nameWords: string[];
  aliases: string[];
  aliasWords: string[];
  keywords: string[];
  groupWords: string[];
};

function index(c: Condition): Indexed {
  return {
    condition: c,
    name: normalizeText(c.name),
    nameWords: words(c.name),
    aliases: c.aliases.map(normalizeText).filter(Boolean),
    aliasWords: c.aliases.flatMap(words),
    keywords: c.keywords.map(normalizeText).filter(Boolean),
    groupWords: [...words(c.specialty), ...words(c.category)],
  };
}

/** Best score for one query word against one condition; 0 means no match. */
function tokenScore(t: string, c: Indexed): number {
  let best = 0;
  const bump = (n: number) => (best = Math.max(best, n));
  for (const a of c.aliases) if (a === t) bump(100);
  for (const w of c.nameWords) {
    if (w === t) bump(60);
    else if (w.startsWith(t)) bump(50);
  }
  for (const w of c.aliasWords) {
    if (w === t) bump(55);
    else if (w.startsWith(t)) bump(45);
  }
  for (const k of c.keywords) {
    if (k === t) bump(30);
    else if (k.startsWith(t) || k.split(" ").some((w) => w.startsWith(t))) bump(25);
  }
  for (const w of c.groupWords) {
    if (w === t) bump(20);
    else if (w.startsWith(t)) bump(15);
  }
  if (best === 0) {
    const allowed = typoAllowance(t.length);
    if (allowed > 0) {
      for (const w of [...c.nameWords, ...c.aliasWords]) {
        if (editDistance(t, w.slice(0, t.length + allowed), allowed) <= allowed || editDistance(t, w, allowed) <= allowed) bump(35);
      }
    }
  }
  return best;
}

export class ConditionIndex {
  private readonly items: Indexed[];

  constructor(conditions: readonly Condition[]) {
    this.items = conditions.map(index);
  }

  get size() {
    return this.items.length;
  }

  /** Every query word must match something (name, alias, keyword, specialty or category). */
  search(query: string, limit = 10): Condition[] {
    const q = normalizeText(query);
    if (!q) return [];
    const tokens = q.split(" ");
    const scored: { c: Indexed; score: number }[] = [];
    for (const c of this.items) {
      let score = 0;
      let all = true;
      for (const t of tokens) {
        const s = tokenScore(t, c);
        if (s === 0) {
          all = false;
          break;
        }
        score += s;
      }
      if (!all) continue;
      if (c.name === q || c.aliases.includes(q)) score += 100;
      else if (c.name.startsWith(q)) score += 40;
      scored.push({ c, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.c.name.length - b.c.name.length || a.c.name.localeCompare(b.c.name))
      .slice(0, Math.min(Math.max(limit, 1), 50))
      .map((s) => s.c.condition);
  }
}

/** Merges lists, joining entries with the same name (aliases and keywords are combined). Inventory entries win. */
export function mergeConditions(...lists: readonly (readonly Condition[])[]): Condition[] {
  const byName = new Map<string, Condition>();
  for (const list of lists) {
    for (const c of list) {
      const key = normalizeText(c.name);
      if (!key) continue;
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { ...c, aliases: [...c.aliases], keywords: [...c.keywords] });
        continue;
      }
      const seen = new Set(existing.aliases.map(normalizeText));
      for (const a of c.aliases) if (!seen.has(normalizeText(a))) existing.aliases.push(a);
      existing.specialty ||= c.specialty;
      existing.category ||= c.category;
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Validates the starter list file so a typo in it fails loudly in tests. */
export function parseConditionSeeds(raw: unknown): Condition[] {
  const list = (raw as { conditions?: unknown }).conditions;
  if (!Array.isArray(list)) throw new Error("data/conditions.json must have a `conditions` list");
  return list.map((item, i) => {
    const c = item as Partial<ConditionSeed>;
    if (typeof c.name !== "string" || !c.name.trim()) throw new Error(`condition ${i + 1} has no name`);
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);
    return {
      name: c.name.trim(),
      aliases: strings(c.aliases),
      keywords: strings(c.keywords),
      specialty: typeof c.specialty === "string" ? c.specialty : "",
      category: typeof c.category === "string" ? c.category : "",
      source: "inventory" as const,
    };
  });
}
