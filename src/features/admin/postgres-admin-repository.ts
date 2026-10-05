import type { CaseDefinition, Difficulty, PublicationStatus, TerminalBehavior } from "@/lib/engine/types";
import { asUser, pgCode, pgConstraint, PG, toIso, type Sql, type Tx } from "@/lib/db/client";
import { parseCaseDefinition } from "@/lib/schemas/case";
import { isServiceError, ServiceError } from "@/lib/server/service-error";
import type { Condition } from "@/features/case-manager/conditions";
import type { ExistingCase } from "@/features/case-manager/duplicates";
import type {
  AdminRepository,
  CaseListItem,
  CaseListQuery,
  CategoryRow,
  DashboardData,
  DomainRow,
  SaveResult,
  SnapshotNames,
  WriteOptions,
} from "./admin-repository";
import { legacyDifferentials, readStoredAuthoring, toStoredAuthoring } from "./authoring-storage";
import { defaultCaseCode, slugify, type CaseDraft, type CaseDraftContent, type DraftReference, type DraftStage, type ReferenceType } from "./draft";

type CaseRow = {
  id: string;
  case_number: number;
  slug: string;
  title: string;
  summary: string;
  domain_id: string;
  category: string | null;
  difficulty: Difficulty;
  max_lives: number;
  terminal_behavior: TerminalBehavior;
  reveal_correct_option_on_wrong: boolean;
  status: PublicationStatus;
  answer_label: string;
  final_explanation: string;
  key_clues: string[];
  learning_points: string[];
  differentials: { label: string; reason: string }[];
  domain_fields: unknown;
  is_demo: boolean;
  revision: number;
  published_version: number | null;
  has_unpublished_changes: boolean;
  updated_at: Date;
};

type ListRow = {
  id: string;
  case_number: number;
  case_code: string;
  title: string;
  slug: string;
  domain: string;
  category: string | null;
  subcategory: string | null;
  difficulty: Difficulty;
  status: PublicationStatus;
  stage_count: number;
  max_lives: number;
  updated_at: Date;
  author: string | null;
  has_unpublished_changes: boolean;
  published_version: number | null;
};

const SORT_SQL: Record<CaseListQuery["sort"], string> = {
  updated_desc: "c.updated_at desc",
  updated_asc: "c.updated_at asc",
  title_asc: "lower(c.title) asc",
  number_desc: "c.case_number desc",
  get code_asc() {
    return `upper(${CASE_CODE_SQL}) asc`;
  },
};

/** Escapes LIKE wildcards so a search for "50%" means the literal text. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function translate(error: unknown): never {
  if (isServiceError(error)) throw error;
  const code = pgCode(error);
  if (code === PG.UNIQUE_VIOLATION && pgConstraint(error) === "cases_slug_key") throw new ServiceError("SLUG_TAKEN");
  if (code === PG.UNIQUE_VIOLATION) throw new ServiceError("INVALID_REQUEST", "Duplicate value", ["That name is already used."]);
  if (code === PG.INSUFFICIENT_PRIVILEGE) throw new ServiceError("FORBIDDEN", String((error as Error).message));
  if (code === PG.CHECK_VIOLATION) throw new ServiceError("INVALID_REQUEST", String((error as Error).message));
  throw error;
}

/* SQL fragments ------------------------------------------------------------------------------ */

/** The Case ID shown everywhere: the stored one, or CASE-### for cases made before Case IDs existed. */
const CASE_CODE_SQL = `coalesce(nullif(c.domain_fields #>> '{authoring,caseCode}', ''),
  'CASE-' || case when c.case_number < 1000 then lpad(c.case_number::text, 3, '0') else c.case_number::text end)`;
/** Concurrency token that needs no extra column: the row's last-change time in microseconds. */
const REVISION_SQL = `(extract(epoch from c.updated_at) * 1000000)::bigint::float8`;
const HAS_CHANGES_SQL = `(c.published_version is not null and c.updated_at > c.published_at)`;

export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly sql: Sql) {}

  private run<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return asUser(this.sql, userId, fn).catch(translate);
  }

  /* ----------------------------------------------------------------------------- reading */

  async dashboard(userId: string): Promise<DashboardData> {
    return this.run(userId, async (tx) => {
      const counts = await tx<{ status: PublicationStatus; n: number }[]>`
        select status, count(*)::int as n from public.cases group by status`;
      const byStatus = { DRAFT: 0, READY_FOR_REVIEW: 0, REVIEWED: 0, PUBLISHED: 0, ARCHIVED: 0, total: 0 };
      for (const c of counts) {
        byStatus[c.status] = c.n;
        byStatus.total += c.n;
      }
      const recent = await tx<ListRow[]>`${listSelect(tx)} order by c.updated_at desc limit 5`;
      return { counts: byStatus, recentCases: recent.map(toListItem) };
    });
  }

  async listCases(userId: string, query: CaseListQuery, maxPageSize = 100) {
    const pageSize = Math.min(Math.max(query.pageSize, 1), maxPageSize);
    return this.run(userId, async (tx) => {
      const q = query.q?.trim();
      const filters = tx`
        where true
        ${
          q
            ? tx`and (c.title ilike ${likePattern(q)} or ${tx.unsafe(CASE_CODE_SQL)} ilike ${likePattern(q)}
                 or cat.name ilike ${likePattern(q)} or (c.domain_fields #>> '{authoring,subcategory}') ilike ${likePattern(q)})`
            : tx``
        }
        ${query.domainId ? tx`and c.domain_id = ${query.domainId}` : tx``}
        ${query.categoryId ? tx`and c.category_id = ${query.categoryId}` : tx``}
        ${query.difficulty ? tx`and c.difficulty = ${query.difficulty}` : tx``}
        ${query.status ? tx`and c.status = ${query.status}` : tx``}`;
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.cases c left join public.categories cat on cat.id = c.category_id ${filters}`;
      const rows = await tx<ListRow[]>`
        ${listSelect(tx)}
        ${filters}
        order by ${tx.unsafe(SORT_SQL[query.sort])}, c.id
        limit ${pageSize} offset ${(Math.max(query.page, 1) - 1) * pageSize}`;
      return { items: rows.map(toListItem), total: count?.n ?? 0 };
    });
  }

  async getDraft(userId: string, caseId: string) {
    return this.run(userId, (tx) => readDraft(tx, caseId));
  }

  async getDraftWithNames(userId: string, caseId: string) {
    return this.run(userId, async (tx) => {
      const draft = await readDraft(tx, caseId);
      return draft ? { draft, names: await readNames(tx, caseId) } : null;
    });
  }

  async findByCaseCode(userId: string, caseCode: string, exceptCaseId?: string) {
    return this.run(userId, (tx) => caseWithCode(tx, caseCode, exceptCaseId));
  }

  async findDomainByName(userId: string, name: string) {
    return this.run(userId, async (tx) => {
      const [row] = await tx<{ id: string; name: string }[]>`
        select id, name from public.domains where lower(name) = lower(${name.trim()}) or slug = ${slugify(name)} limit 1`;
      return row ?? null;
    });
  }

  async findCategory(userId: string, domainId: string, name: string) {
    return this.run(userId, (tx) => findCategoryRow(tx, domainId, name));
  }

  /* ----------------------------------------------------------------------------- writing */

  async createCase(userId: string, content: CaseDraftContent, options: WriteOptions) {
    return this.run(userId, async (tx) => {
      await lockCaseCodes(tx);
      const categoryId = await resolveCategory(tx, content.domainId, content.category, options.allowCreateCategory);
      if (content.caseCode && (await caseWithCode(tx, content.caseCode))) throw new ServiceError("CASE_ID_TAKEN");
      const slug = await freeSlug(tx, content.slug || slugify(content.title));
      const [row] = await tx<{ id: string; case_number: number }[]>`
        insert into public.cases (slug, title, summary, domain_id, category_id, difficulty, max_lives, terminal_behavior,
          reveal_correct_option_on_wrong, status, answer_label, final_explanation, key_clues, learning_points, differentials,
          domain_fields, created_by, updated_by)
        values (${slug}, ${content.title.trim()}, ${content.summary.trim()}, ${content.domainId}, ${categoryId}, ${content.difficulty},
          ${content.maxLives}, ${content.terminalBehavior}, ${content.revealCorrectOptionOnWrong}, 'DRAFT',
          ${content.diagnosis.displayName.trim()}, ${content.diagnosis.explanation}, ${tx.json(content.diagnosis.decisiveFindings)},
          ${tx.json(content.learningPoints)}, ${tx.json(legacyDifferentials(content.differentialDiagnoses))},
          ${tx.json({ authoring: toStoredAuthoring(content) } as never)}, ${userId}, ${userId})
        returning id, case_number`;
      if (!content.caseCode) {
        // No Case ID given: use CASE-### from the new case number (with a suffix if someone already uses it).
        let code = defaultCaseCode(row!.case_number);
        for (let n = 2; await caseWithCode(tx, code, row!.id); n++) code = `${defaultCaseCode(row!.case_number)}-${n}`;
        await tx`
          update public.cases set domain_fields = jsonb_set(domain_fields, '{authoring,caseCode}', to_jsonb(${code}::text))
          where id = ${row!.id}`;
      }
      await writeChildren(tx, row!.id, content.stages, content.references);
      return row!.id;
    });
  }

  async saveDraft(userId: string, caseId: string, content: CaseDraftContent, expectedRevision: number, options: WriteOptions): Promise<SaveResult> {
    return this.run(userId, async (tx) => {
      const [current] = await tx<{ revision: number; published_version: number | null; slug: string }[]>`
        select ${tx.unsafe(REVISION_SQL)} as revision, c.published_version, c.slug from public.cases c where c.id = ${caseId} for update`;
      if (!current) return { status: "not_found" } as const;
      if (current.revision !== expectedRevision) return { status: "conflict" } as const;
      if (current.published_version !== null && current.slug !== content.slug) throw new ServiceError("SLUG_LOCKED");
      await lockCaseCodes(tx);
      if (await caseWithCode(tx, content.caseCode, caseId)) throw new ServiceError("CASE_ID_TAKEN");
      const categoryId = await resolveCategory(tx, content.domainId, content.category, options.allowCreateCategory);
      await assertIdsBelongHere(tx, caseId, content);

      const [saved] = await tx<{ revision: number; updated_at: Date; has_unpublished_changes: boolean }[]>`
        update public.cases c set
          title = ${content.title.trim()}, slug = ${content.slug}, summary = ${content.summary.trim()},
          domain_id = ${content.domainId}, category_id = ${categoryId}, difficulty = ${content.difficulty},
          max_lives = ${content.maxLives}, terminal_behavior = ${content.terminalBehavior},
          reveal_correct_option_on_wrong = ${content.revealCorrectOptionOnWrong},
          answer_label = ${content.diagnosis.displayName.trim()}, final_explanation = ${content.diagnosis.explanation},
          key_clues = ${tx.json(content.diagnosis.decisiveFindings)}, learning_points = ${tx.json(content.learningPoints)},
          differentials = ${tx.json(legacyDifferentials(content.differentialDiagnoses))},
          domain_fields = c.domain_fields || ${tx.json({ authoring: toStoredAuthoring(content) } as never)},
          updated_by = ${userId}
        where c.id = ${caseId}
        returning ${tx.unsafe(REVISION_SQL)} as revision, c.updated_at, ${tx.unsafe(HAS_CHANGES_SQL)} as has_unpublished_changes`;
      await writeChildren(tx, caseId, content.stages, content.references);
      return {
        status: "saved",
        revision: saved!.revision,
        updatedAt: toIso(saved!.updated_at)!,
        hasUnpublishedChanges: saved!.has_unpublished_changes,
      } as const;
    });
  }

  async publish(userId: string, caseId: string, build: (draft: CaseDraft, names: SnapshotNames, version: number) => CaseDefinition) {
    return this.run(userId, async (tx) => {
      const [locked] = await tx`select id from public.cases where id = ${caseId} for update`;
      if (!locked) return null;
      const draft = (await readDraft(tx, caseId))!;
      const names = await readNames(tx, caseId);
      const [versionRow] = await tx<{ next: number }[]>`
        select coalesce(max(version), 0)::int + 1 as next from public.case_versions where case_id = ${caseId}`;
      const next = versionRow!.next;
      // Re-validate exactly what will be stored and played.
      const snapshot = parseCaseDefinition(build(draft, names, next));
      await tx`
        insert into public.case_versions (case_id, version, snapshot, published_by, case_number, slug, title, summary,
          domain, category, difficulty, max_lives, stage_count, is_demo)
        values (${caseId}, ${next}, ${tx.json(snapshot as never)}, ${userId}, ${snapshot.caseNumber},
          ${snapshot.slug}, ${snapshot.title}, ${snapshot.summary}, ${snapshot.domain}, ${names.categoryName},
          ${snapshot.difficulty}, ${snapshot.maxLives}, ${snapshot.stages.length}, ${snapshot.isDemo})`;
      await tx`
        update public.cases set status = 'PUBLISHED', published_version = ${next}, published_at = now(), updated_by = ${userId}
        where id = ${caseId}`;
      return { version: next };
    });
  }

  async setStatus(userId: string, caseId: string, status: PublicationStatus) {
    return this.run(userId, async (tx) => {
      const rows = await tx`update public.cases set status = ${status}, updated_by = ${userId} where id = ${caseId} returning id`;
      return rows.length > 0;
    });
  }

  /* ----------------------------------------------------------------------------- taxonomy */

  async listDomains(userId: string): Promise<DomainRow[]> {
    return this.run(userId, async (tx) => {
      const rows = await tx<{ id: string; name: string; slug: string; domain_type: string; is_active: boolean; case_count: number }[]>`
        select d.id, d.name, d.slug, d.domain_type, d.is_active,
               (select count(*)::int from public.cases c where c.domain_id = d.id) as case_count
        from public.domains d order by d.name`;
      return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, domainType: r.domain_type, isActive: r.is_active, caseCount: r.case_count }));
    });
  }

  async listCategories(userId: string): Promise<CategoryRow[]> {
    return this.run(userId, async (tx) => {
      const rows = await tx<{ id: string; domain_id: string; domain_name: string; name: string; slug: string; is_active: boolean; case_count: number }[]>`
        select c.id, c.domain_id, d.name as domain_name, c.name, c.slug, c.is_active,
               (select count(*)::int from public.cases x where x.category_id = c.id) as case_count
        from public.categories c join public.domains d on d.id = c.domain_id
        order by d.name, c.name`;
      return rows.map((r) => ({
        id: r.id,
        domainId: r.domain_id,
        domainName: r.domain_name,
        name: r.name,
        slug: r.slug,
        isActive: r.is_active,
        caseCount: r.case_count,
      }));
    });
  }

  /* ----------------------------------------------------------------------------- duplicates & conditions */

  async duplicateCandidates(userId: string, exceptCaseId?: string): Promise<ExistingCase[]> {
    return this.run(userId, async (tx) => {
      const rows = await tx<{ id: string; case_number: number; case_code: string; title: string; status: PublicationStatus; answer_label: string; dx: unknown }[]>`
        select c.id, c.case_number, ${tx.unsafe(CASE_CODE_SQL)} as case_code, c.title, c.status, c.answer_label,
               c.domain_fields #> '{authoring,diagnosis}' as dx
        from public.cases c
        ${exceptCaseId ? tx`where c.id <> ${exceptCaseId}` : tx``}`;
      return rows.map((r) => {
        const dx = (r.dx ?? {}) as { primary?: unknown; acceptedAnswers?: unknown; aliases?: unknown };
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
        return {
          id: r.id,
          caseNumber: r.case_number,
          caseCode: r.case_code,
          title: r.title,
          status: r.status,
          diagnosisNames: [r.answer_label, typeof dx.primary === "string" ? dx.primary : "", ...list(dx.acceptedAnswers), ...list(dx.aliases)].filter(Boolean),
          clueText: "",
        };
      });
    });
  }

  async clueTexts(userId: string, caseIds: readonly string[]) {
    if (caseIds.length === 0) return new Map<string, string>();
    return this.run(userId, async (tx) => {
      const rows = await tx<{ case_id: string; text: string }[]>`
        select case_id, string_agg(content, ' ' order by position) as text
        from public.case_stages where case_id = any(${[...caseIds]}::uuid[]) group by case_id`;
      return new Map(rows.map((r) => [r.case_id, r.text]));
    });
  }

  async conditionsFromCases(userId: string): Promise<Condition[]> {
    return this.run(userId, async (tx) => {
      const rows = await tx<{ answer_label: string; differentials: { label?: unknown }[]; authoring: unknown; domain: string; category: string | null }[]>`
        select c.answer_label, c.differentials, c.domain_fields -> 'authoring' as authoring, d.name as domain, cat.name as category
        from public.cases c
        join public.domains d on d.id = c.domain_id
        left join public.categories cat on cat.id = c.category_id
        where d.domain_type = 'medical' and c.status <> 'ARCHIVED'`;
      const out: Condition[] = [];
      const add = (name: unknown, aliases: string[], row: (typeof rows)[number]) => {
        if (typeof name === "string" && name.trim()) {
          out.push({ name: name.trim(), aliases, keywords: [], specialty: row.category ?? "", category: row.domain, source: "cases" });
        }
      };
      for (const row of rows) {
        const stored = readStoredAuthoring({ authoring: row.authoring });
        if (stored) {
          add(stored.diagnosis.primary || row.answer_label, stored.diagnosis.aliases, row);
          for (const d of stored.differentialDiagnoses) add(d.name, d.aliases, row);
          for (const w of stored.wrongAnswerExplanations) add(w.condition, w.aliases, row);
        } else {
          add(row.answer_label, [], row);
          for (const d of row.differentials ?? []) add(d.label, [], row);
        }
      }
      return out;
    });
  }
}

/* --------------------------------------------------------------------------------- helpers */

function listSelect(tx: Tx) {
  return tx`
    select c.id, c.case_number, ${tx.unsafe(CASE_CODE_SQL)} as case_code, c.title, c.slug, d.name as domain,
           cat.name as category, c.domain_fields #>> '{authoring,subcategory}' as subcategory, c.difficulty, c.status,
           (select count(*)::int from public.case_stages s where s.case_id = c.id) as stage_count,
           c.max_lives, c.updated_at, p.display_name as author, ${tx.unsafe(HAS_CHANGES_SQL)} as has_unpublished_changes,
           c.published_version
    from public.cases c
    join public.domains d on d.id = c.domain_id
    left join public.categories cat on cat.id = c.category_id
    left join public.profiles p on p.id = c.created_by`;
}

function toListItem(r: ListRow): CaseListItem {
  return {
    id: r.id,
    caseNumber: r.case_number,
    caseCode: r.case_code,
    title: r.title,
    slug: r.slug,
    domain: r.domain,
    category: r.category,
    subcategory: r.subcategory ?? "",
    difficulty: r.difficulty,
    status: r.status,
    stageCount: r.stage_count,
    maxLives: r.max_lives,
    updatedAt: toIso(r.updated_at)!,
    author: r.author,
    hasUnpublishedChanges: r.has_unpublished_changes,
    publishedVersion: r.published_version,
  };
}

async function readDraft(tx: Tx, caseId: string): Promise<CaseDraft | null> {
  const [c] = await tx<(CaseRow & { case_code: string })[]>`
    select c.id, c.case_number, c.slug, c.title, c.summary, c.domain_id, cat.name as category, c.difficulty, c.max_lives,
           c.terminal_behavior, c.reveal_correct_option_on_wrong, c.status, c.answer_label, c.final_explanation, c.key_clues,
           c.learning_points, c.differentials, c.domain_fields, c.is_demo, c.published_version, c.updated_at,
           ${tx.unsafe(REVISION_SQL)} as revision, ${tx.unsafe(HAS_CHANGES_SQL)} as has_unpublished_changes,
           ${tx.unsafe(CASE_CODE_SQL)} as case_code
    from public.cases c left join public.categories cat on cat.id = c.category_id
    where c.id = ${caseId}`;
  if (!c) return null;
  const stages = await tx<
    { id: string; title: string; content: string; question: string; hint: string | null; explanation: string | null; life_cost: number; show_previous_clues: boolean }[]
  >`select id, title, content, question, hint, explanation, life_cost, show_previous_clues
    from public.case_stages where case_id = ${caseId} order by position`;
  const options = await tx<{ id: string; stage_id: string; label: string; is_correct: boolean }[]>`
    select o.id, o.stage_id, o.label, o.is_correct from public.stage_options o
    join public.case_stages s on s.id = o.stage_id where s.case_id = ${caseId} order by o.position`;
  const references = await tx<
    { id: string; title: string; authors: string | null; source: string | null; year: number | null; url: string | null; doi: string | null; pages: string | null; ref_type: ReferenceType; is_placeholder: boolean; verified: boolean }[]
  >`select id, title, authors, source, year, url, doi, pages, ref_type, is_placeholder, verified
    from public.case_references where case_id = ${caseId} order by position`;

  const stored = readStoredAuthoring(c.domain_fields);
  // Cases created before the Case Manager (e.g. the demo cases) are shown using their existing columns.
  const commonLifeCost = mostCommon(stages.map((s) => s.life_cost)) ?? 1;

  return {
    id: c.id,
    caseNumber: c.case_number,
    status: c.status,
    revision: c.revision,
    publishedVersion: c.published_version,
    hasUnpublishedChanges: c.has_unpublished_changes,
    isDemo: c.is_demo,
    updatedAt: toIso(c.updated_at)!,
    caseCode: c.case_code,
    title: c.title,
    slug: c.slug,
    summary: c.summary,
    learningObjective: stored?.learningObjective ?? "",
    domainId: c.domain_id,
    category: c.category ?? "",
    subcategory: stored?.subcategory ?? "",
    difficulty: c.difficulty,
    maxLives: c.max_lives,
    lifeLossPerWrong: stored?.lifeLossPerWrong ?? commonLifeCost,
    startingScore: stored?.startingScore ?? null,
    wrongAnswerPenalty: stored?.wrongAnswerPenalty ?? null,
    terminalBehavior: c.terminal_behavior,
    revealCorrectOptionOnWrong: c.reveal_correct_option_on_wrong,
    stages: stages.map((s) => ({
      id: s.id,
      title: s.title,
      content: s.content,
      question: s.question,
      hint: s.hint ?? "",
      explanation: s.explanation ?? "",
      lifeCost: s.life_cost,
      showPreviousClues: s.show_previous_clues,
      options: options.filter((o) => o.stage_id === s.id).map((o) => ({ id: o.id, label: o.label, isCorrect: o.is_correct })),
      investigations: stored?.stages[s.id]?.investigations ?? [],
      crossReference: stored?.stages[s.id]?.crossReference ?? "",
    })),
    diagnosis: {
      primary: stored?.diagnosis.primary || c.answer_label,
      displayName: c.answer_label,
      acceptedAnswers: stored?.diagnosis.acceptedAnswers ?? [],
      aliases: stored?.diagnosis.aliases ?? [],
      explanation: c.final_explanation,
      detailedExplanation: stored?.diagnosis.detailedExplanation ?? "",
      decisiveFindings: c.key_clues,
      finalReasoning: stored?.diagnosis.finalReasoning ?? "",
    },
    differentialDiagnoses:
      stored?.differentialDiagnoses ??
      c.differentials.map((d) => ({ name: d.label, aliases: [], whyConsidered: "", whyRejected: d.reason, clinicalExplanation: "", crossReferences: [] })),
    wrongAnswerExplanations: stored?.wrongAnswerExplanations ?? [],
    clinicalSummary: stored?.clinicalSummary ?? "",
    clinicalInsight: stored?.clinicalInsight ?? "",
    diagnosticReasoning: stored?.diagnosticReasoning ?? "",
    investigationSummary: stored?.investigationSummary ?? "",
    whereReasoningCanGoWrong: stored?.whereReasoningCanGoWrong ?? "",
    learningPoints: c.learning_points,
    references: references.map(
      (r): DraftReference => ({
        id: r.id,
        title: r.title,
        authors: r.authors ?? "",
        source: r.source ?? "",
        year: r.year,
        url: r.url ?? "",
        doi: r.doi ?? "",
        pages: r.pages ?? "",
        refType: r.ref_type,
        isPlaceholder: r.is_placeholder,
        verified: r.verified,
      }),
    ),
  };
}

function mostCommon(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

async function readNames(tx: Tx, caseId: string): Promise<SnapshotNames> {
  const [row] = await tx<{ domain: string; category: string | null }[]>`
    select d.name as domain, cat.name as category
    from public.cases c join public.domains d on d.id = c.domain_id left join public.categories cat on cat.id = c.category_id
    where c.id = ${caseId}`;
  return { domainName: row?.domain ?? "", categoryName: row?.category ?? null };
}

/** Serialises Case ID checks between concurrent saves and imports (held until the transaction ends). */
async function lockCaseCodes(tx: Tx) {
  await tx`select pg_advisory_xact_lock(hashtext('wisecases.case_code'))`;
}

async function caseWithCode(tx: Tx, caseCode: string, exceptCaseId?: string) {
  const [row] = await tx<{ id: string; title: string }[]>`
    select c.id, c.title from public.cases c
    where upper(${tx.unsafe(CASE_CODE_SQL)}) = upper(${caseCode.trim()}) ${exceptCaseId ? tx`and c.id <> ${exceptCaseId}` : tx``}
    limit 1`;
  return row ?? null;
}

async function findCategoryRow(tx: Tx, domainId: string, name: string) {
  const [row] = await tx<{ id: string; name: string }[]>`
    select id, name from public.categories
    where domain_id = ${domainId} and (lower(name) = lower(${name.trim()}) or slug = ${slugify(name)})
    order by (parent_id is null) desc limit 1`;
  return row ?? null;
}

/** Finds the category by name, creating it only when allowed. Empty name = no category. */
async function resolveCategory(tx: Tx, domainId: string, name: string, allowCreate: boolean): Promise<string | null> {
  if (!name.trim()) return null;
  const existing = await findCategoryRow(tx, domainId, name);
  if (existing) return existing.id;
  if (!allowCreate) {
    throw new ServiceError("INVALID_REQUEST", "Unknown category", [
      `Category “${name.trim()}” does not exist yet. Choose an existing category, or ask an administrator to add it.`,
    ]);
  }
  const [row] = await tx<{ id: string }[]>`
    insert into public.categories (domain_id, name, slug) values (${domainId}, ${name.trim()}, ${slugify(name)}) returning id`;
  return row!.id;
}

async function freeSlug(tx: Tx, base: string): Promise<string> {
  const root = base.slice(0, 74);
  const taken = new Set((await tx<{ slug: string }[]>`select slug from public.cases where slug like ${`${root}%`}`).map((r) => r.slug));
  let slug = root;
  for (let n = 2; taken.has(slug); n++) slug = `${root}-${n}`;
  return slug;
}

/** Stage, option and reference IDs sent by the browser must be new or already belong to THIS case. */
async function assertIdsBelongHere(tx: Tx, caseId: string, content: CaseDraftContent) {
  const stageIds = content.stages.map((s) => s.id);
  const optionIds = content.stages.flatMap((s) => s.options.map((o) => o.id));
  const refIds = content.references.map((r) => r.id);
  const all = [...stageIds, ...optionIds, ...refIds];
  if (new Set(all).size !== all.length) throw new ServiceError("INVALID_REQUEST", "Duplicate IDs in draft");
  const foreign = await tx`
    select 1 from public.case_stages where id = any(${stageIds}::uuid[]) and case_id <> ${caseId}
    union all
    select 1 from public.stage_options o join public.case_stages s on s.id = o.stage_id
      where o.id = any(${optionIds}::uuid[]) and s.case_id <> ${caseId}
    union all
    select 1 from public.case_references where id = any(${refIds}::uuid[]) and case_id <> ${caseId}
    limit 1`;
  if (foreign.length > 0) throw new ServiceError("INVALID_REQUEST", "Draft references rows of another case");
}

/** Replaces stages, options and references of a case, keeping IDs stable and storing order explicitly. */
async function writeChildren(tx: Tx, caseId: string, stages: DraftStage[], references: DraftReference[]) {
  const stageIds = stages.map((s) => s.id);
  const optionIds = stages.flatMap((s) => s.options.map((o) => o.id));
  const refIds = references.map((r) => r.id);

  await tx`delete from public.case_stages where case_id = ${caseId} and not (id = any(${stageIds}::uuid[]))`;
  await tx`delete from public.case_references where case_id = ${caseId} and not (id = any(${refIds}::uuid[]))`;

  if (stages.length > 0) {
    const stageRows = stages.map((s, i) => ({
      id: s.id,
      case_id: caseId,
      position: i + 1,
      title: s.title.trim(),
      content: s.content.trim(),
      question: s.question.trim(),
      hint: s.hint.trim() || null,
      explanation: s.explanation.trim() || null,
      life_cost: s.lifeCost,
      show_previous_clues: s.showPreviousClues,
    }));
    await tx`
      insert into public.case_stages ${tx(stageRows)}
      on conflict (id) do update set position = excluded.position, title = excluded.title, content = excluded.content,
        question = excluded.question, hint = excluded.hint, explanation = excluded.explanation,
        life_cost = excluded.life_cost, show_previous_clues = excluded.show_previous_clues`;
    await tx`delete from public.stage_options where stage_id = any(${stageIds}::uuid[]) and not (id = any(${optionIds}::uuid[]))`;
    const optionRows = stages.flatMap((s) =>
      s.options.map((o, j) => ({ id: o.id, stage_id: s.id, position: j + 1, label: o.label.trim(), is_correct: o.isCorrect })),
    );
    if (optionRows.length > 0) {
      await tx`
        insert into public.stage_options ${tx(optionRows)}
        on conflict (id) do update set stage_id = excluded.stage_id, position = excluded.position,
          label = excluded.label, is_correct = excluded.is_correct`;
    }
  }

  if (references.length > 0) {
    const refRows = references.map((r, i) => ({
      id: r.id,
      case_id: caseId,
      position: i + 1,
      title: r.title.trim(),
      authors: r.authors.trim() || null,
      source: r.source.trim() || null,
      year: r.year,
      url: r.url.trim() || null,
      doi: r.doi.trim() || null,
      pages: r.pages.trim() || null,
      ref_type: r.refType,
      is_placeholder: r.isPlaceholder,
      verified: r.verified && !r.isPlaceholder,
    }));
    await tx`
      insert into public.case_references ${tx(refRows)}
      on conflict (id) do update set position = excluded.position, title = excluded.title, authors = excluded.authors,
        source = excluded.source, year = excluded.year, url = excluded.url, doi = excluded.doi, pages = excluded.pages,
        ref_type = excluded.ref_type, is_placeholder = excluded.is_placeholder, verified = excluded.verified`;
  }
}
