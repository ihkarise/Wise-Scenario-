import type { CaseDefinition } from "@/lib/engine/types";
import { toCaseSummary, type CasePage, type CaseRepository } from "./case-repository";

/** In-memory case content for development and tests. Returns copies so callers cannot mutate content. */
export class MemoryCaseRepository implements CaseRepository {
  private readonly cases: CaseDefinition[];

  constructor(cases: readonly CaseDefinition[]) {
    this.cases = [...cases].sort((a, b) => a.caseNumber - b.caseNumber);
  }

  async listPublished({ limit, cursor }: { limit: number; cursor?: string | null }): Promise<CasePage> {
    const after = cursor ? Number(cursor) : 0;
    const published = this.cases.filter((c) => c.publicationStatus === "PUBLISHED" && c.caseNumber > after);
    const page = published.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toCaseSummary),
      nextCursor: published.length > limit && last ? String(last.caseNumber) : null,
    };
  }

  async findBySlug(slug: string) {
    return copy(this.cases.find((c) => c.slug === slug));
  }

  async findById(id: string) {
    return copy(this.cases.find((c) => c.id === id));
  }

  async findVersion(caseId: string, version: number) {
    return copy(this.cases.find((c) => c.id === caseId && c.version === version));
  }
}

const copy = (c: CaseDefinition | undefined): CaseDefinition | null => (c ? structuredClone(c) : null);
