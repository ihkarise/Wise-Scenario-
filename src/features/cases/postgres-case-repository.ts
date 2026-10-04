import type { CaseDefinition, PublicationStatus } from "@/lib/engine/types";
import type { Sql } from "@/lib/db/client";
import { parseCaseDefinition } from "@/lib/schemas/case";
import type { CasePage, CaseRepository, CaseSummary } from "./case-repository";

type SummaryRow = {
  case_id: string;
  slug: string;
  case_number: number;
  title: string;
  summary: string;
  domain: string;
  category: string | null;
  difficulty: CaseSummary["difficulty"];
  max_lives: number;
  stage_count: number;
  is_demo: boolean;
};

/**
 * PUBLISHED content for play, read from frozen snapshots in `case_versions` (never from the editable
 * working copy). Every snapshot is re-validated when read.
 */
export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly sql: Sql) {}

  async listPublished({ limit, cursor }: { limit: number; cursor?: string | null }): Promise<CasePage> {
    const after = cursor ? Number(cursor) : 0;
    const rows = await this.sql<SummaryRow[]>`
      select v.case_id, v.slug, v.case_number, v.title, v.summary, v.domain, v.category, v.difficulty,
             v.max_lives, v.stage_count, v.is_demo
      from public.cases c
      join public.case_versions v on v.case_id = c.id and v.version = c.published_version
      where c.status = 'PUBLISHED' and v.case_number > ${after}
      order by v.case_number
      limit ${limit + 1}`;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.case_id,
        slug: r.slug,
        caseNumber: r.case_number,
        title: r.title,
        summary: r.summary,
        domain: r.domain,
        category: r.category ?? "",
        difficulty: r.difficulty,
        maxLives: r.max_lives,
        stageCount: r.stage_count,
        isDemo: r.is_demo,
      })),
      nextCursor: rows.length > limit && last ? String(last.case_number) : null,
    };
  }

  /** The live version for this slug, with the case's CURRENT status (so unpublished cases are refused). */
  async findBySlug(slug: string) {
    const [row] = await this.sql<{ snapshot: unknown; status: PublicationStatus }[]>`
      select v.snapshot, c.status from public.cases c
      join public.case_versions v on v.case_id = c.id and v.version = c.published_version
      where v.slug = ${slug}
      limit 1`;
    return row ? toDefinition(row.snapshot, row.status) : null;
  }

  async findById(id: string) {
    const [row] = await this.sql<{ snapshot: unknown; status: PublicationStatus }[]>`
      select v.snapshot, c.status from public.cases c
      join public.case_versions v on v.case_id = c.id and v.version = c.published_version
      where c.id = ${id}`;
    return row ? toDefinition(row.snapshot, row.status) : null;
  }

  async findVersion(caseId: string, version: number) {
    const [row] = await this.sql<{ snapshot: unknown; status: PublicationStatus }[]>`
      select v.snapshot, c.status from public.case_versions v
      join public.cases c on c.id = v.case_id
      where v.case_id = ${caseId} and v.version = ${version}`;
    return row ? toDefinition(row.snapshot, row.status) : null;
  }
}

function toDefinition(snapshot: unknown, status: PublicationStatus): CaseDefinition {
  return parseCaseDefinition({ ...(snapshot as object), publicationStatus: status });
}
