import type { CaseDefinition, Difficulty } from "@/lib/engine/types";

/** Safe listing data: no stages, clues, options or answers. */
export type CaseSummary = {
  id: string;
  slug: string;
  caseNumber: number;
  title: string;
  summary: string;
  domain: string;
  category: string;
  difficulty: Difficulty;
  maxLives: number;
  stageCount: number;
  isDemo: boolean;
};

export type CasePage = { items: CaseSummary[]; nextCursor: string | null };

/**
 * Read access to case CONTENT. Implementations: in-memory demo data (Milestone 1),
 * Supabase/PostgreSQL (Milestone 2). Services depend on this interface only.
 */
export interface CaseRepository {
  /** Published cases only, ordered by case number, paginated. Never loads every case at once. */
  listPublished(options: { limit: number; cursor?: string | null }): Promise<CasePage>;
  /** Any publication status. Callers decide what a learner may see. */
  findBySlug(slug: string): Promise<CaseDefinition | null>;
  findById(id: string): Promise<CaseDefinition | null>;
  /** The exact version an attempt was started on. */
  findVersion(caseId: string, version: number): Promise<CaseDefinition | null>;
}

export function toCaseSummary(c: CaseDefinition): CaseSummary {
  return {
    id: c.id,
    slug: c.slug,
    caseNumber: c.caseNumber,
    title: c.title,
    summary: c.summary,
    domain: c.domain,
    category: c.category,
    difficulty: c.difficulty,
    maxLives: c.maxLives,
    stageCount: c.stages.length,
    isDemo: c.isDemo,
  };
}
