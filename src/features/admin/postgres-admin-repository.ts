import type { CaseAttempt, CaseDefinition, Difficulty, PublicationStatus, TerminalBehavior } from "@/lib/engine/types";
import { asUser, pgCode, pgConstraint, PG, toIso, type Sql, type Tx } from "@/lib/db/client";
import { parseCaseDefinition } from "@/lib/schemas/case";
import { ServiceError } from "@/lib/server/service-error";
import type {
  ActivityItem,
  AdminRepository,
  CaseListItem,
  CaseListQuery,
  CategoryRow,
  DashboardData,
  DomainRow,
  PreviewSession,
  SaveResult,
  SnapshotNames,
} from "./admin-repository";
import type { CaseDraft, CaseDraftContent, CreateCaseInput, DraftReference, DraftStage, ReferenceType } from "./draft";

type CaseRow = {
  id: string;
  case_number: number;
  slug: string;
  title: string;
  summary: string;
  learning_objective: string;
  domain_id: string;
  category_id: string | null;
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
  is_demo: boolean;
  draft_revision: number;
  published_version: number | null;
  has_unpublished_changes: boolean;
  updated_at: Date;
};

type ListRow = {
  id: string;
  case_number: number;
  title: string;
  slug: string;
  domain: string;
  category: string | null;
  difficulty: Difficulty;
  status: PublicationStatus;
  stage_count: number;
  max_lives: number;
  updated_at: Date;
  author: string | null;
  has_unpublished_changes: boolean;
  published_version: number | null;
};

const SORT_SQL = {
  updated_desc: "c.updated_at desc",
  updated_asc: "c.updated_at asc",
  title_asc: "lower(c.title) asc",
  number_desc: "c.case_number desc",
} as const;

/** Escapes LIKE wildcards so a search for "50%" means the literal text. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function translate(error: unknown): never {
  if (error instanceof ServiceError) throw error;
  const code = pgCode(error);
  if (code === PG.UNIQUE_VIOLATION && pgConstraint(error) === "cases_slug_key") throw new ServiceError("SLUG_TAKEN");
  if (code === PG.UNIQUE_VIOLATION) throw new ServiceError("INVALID_REQUEST", "Duplicate value", ["That name is already used."]);
  if (code === PG.INSUFFICIENT_PRIVILEGE) throw new ServiceError("FORBIDDEN", String((error as Error).message));
  if (code === PG.CHECK_VIOLATION) throw new ServiceError("INVALID_REQUEST", String((error as Error).message));
  throw error;
}

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
      const activity = await tx<{ id: number; action: string; summary: string; actor: string | null; entity_id: string | null; created_at: Date }[]>`
        select l.id, l.action, l.summary, p.display_name as actor, l.entity_id, l.created_at
        from public.audit_logs l left join public.profiles p on p.id = l.actor_id
        order by l.created_at desc limit 8`;
      return {
        counts: byStatus,
        recentCases: recent.map(toListItem),
        recentActivity: activity.map(
          (a): ActivityItem => ({ id: a.id, action: a.action, summary: a.summary, actorName: a.actor, caseId: a.entity_id, createdAt: toIso(a.created_at)! }),
        ),
      };
    });
  }

  async listCases(userId: string, query: CaseListQuery) {
    return this.run(userId, async (tx) => {
      const filters = tx`
        where true
        ${query.q ? tx`and c.title ilike ${likePattern(query.q)}` : tx``}
        ${query.domainId ? tx`and c.domain_id = ${query.domainId}` : tx``}
        ${query.categoryId ? tx`and c.category_id = ${query.categoryId}` : tx``}
        ${query.difficulty ? tx`and c.difficulty = ${query.difficulty}` : tx``}
        ${query.status ? tx`and c.status = ${query.status}` : tx``}`;
      const [count] = await tx<{ n: number }[]>`select count(*)::int as n from public.cases c ${filters}`;
      const rows = await tx<ListRow[]>`
        ${listSelect(tx)}
        ${filters}
        order by ${tx.unsafe(SORT_SQL[query.sort])}, c.id
        limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`;
      return { items: rows.map(toListItem), total: count?.n ?? 0 };
    });
  }

  async getDraft(userId: string, caseId: string) {
    return this.run(userId, (tx) => readDraft(tx, caseId));
  }

  async getDraftWithNames(userId: string, caseId: string) {
    return this.run(userId, async (tx) => {
      const draft = await readDraft(tx, caseId);
      return draft ? { draft, names: await readNames(tx, draft) } : null;
    });
  }

  async slugExists(userId: string, slug: string, exceptCaseId?: string) {
    return this.run(userId, async (tx) => {
      const rows = await tx`select 1 from public.cases where slug = ${slug} ${exceptCaseId ? tx`and id <> ${exceptCaseId}` : tx``}`;
      return rows.length > 0;
    });
  }

  /* ----------------------------------------------------------------------------- writing */

  async createCase(userId: string, input: CreateCaseInput & { slug: string; firstStage: DraftStage }) {
    return this.run(userId, async (tx) => {
      await assertCategoryInDomain(tx, input.categoryId, input.domainId);
      const [row] = await tx<{ id: string }[]>`
        insert into public.cases (slug, title, summary, learning_objective, domain_id, category_id, difficulty, max_lives,
          terminal_behavior, status, created_by, updated_by)
        values (${input.slug}, ${input.title.trim()}, ${input.summary.trim()}, ${input.learningObjective.trim()}, ${input.domainId},
          ${input.categoryId}, ${input.difficulty}, ${input.maxLives}, ${input.terminalBehavior}, 'DRAFT', ${userId}, ${userId})
        returning id`;
      await writeChildren(tx, row!.id, [input.firstStage], []);
      await audit(tx, userId, "case.created", row!.id, `Created “${input.title.trim()}”`);
      return row!.id;
    });
  }

  async saveDraft(userId: string, caseId: string, content: CaseDraftContent, expectedRevision: number): Promise<SaveResult> {
    return this.run(userId, async (tx) => {
      const [current] = await tx<{ draft_revision: number; published_version: number | null; slug: string }[]>`
        select draft_revision, published_version, slug from public.cases where id = ${caseId} for update`;
      if (!current) return { status: "not_found" } as const;
      if (current.draft_revision !== expectedRevision) return { status: "conflict" } as const;
      if (current.published_version !== null && current.slug !== content.slug) throw new ServiceError("SLUG_LOCKED");
      await assertCategoryInDomain(tx, content.categoryId, content.domainId);
      await assertIdsBelongHere(tx, caseId, content);

      const [saved] = await tx<{ draft_revision: number; updated_at: Date; has_unpublished_changes: boolean }[]>`
        update public.cases set
          title = ${content.title.trim()}, slug = ${content.slug}, summary = ${content.summary},
          learning_objective = ${content.learningObjective}, domain_id = ${content.domainId}, category_id = ${content.categoryId},
          difficulty = ${content.difficulty}, max_lives = ${content.maxLives}, terminal_behavior = ${content.terminalBehavior},
          reveal_correct_option_on_wrong = ${content.revealCorrectOptionOnWrong}, answer_label = ${content.answerLabel},
          final_explanation = ${content.finalExplanation}, key_clues = ${tx.json(content.keyClues)},
          learning_points = ${tx.json(content.learningPoints)}, differentials = ${tx.json(content.differentials)},
          draft_revision = draft_revision + 1,
          has_unpublished_changes = (published_version is not null),
          updated_by = ${userId}
        where id = ${caseId}
        returning draft_revision, updated_at, has_unpublished_changes`;
      await writeChildren(tx, caseId, content.stages, content.references);
      await audit(tx, userId, "case.updated", caseId, `Edited “${content.title.trim()}”`);
      return {
        status: "saved",
        revision: saved!.draft_revision,
        updatedAt: toIso(saved!.updated_at)!,
        hasUnpublishedChanges: saved!.has_unpublished_changes,
      } as const;
    });
  }

  async duplicate(userId: string, caseId: string, newId: () => string) {
    return this.run(userId, async (tx) => {
      const source = await readDraft(tx, caseId);
      if (!source) return null;
      const base = `${source.slug}-copy`.slice(0, 74);
      const taken = new Set(
        (await tx<{ slug: string }[]>`select slug from public.cases where slug like ${`${base}%`}`).map((r) => r.slug),
      );
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

      const [row] = await tx<{ id: string }[]>`
        insert into public.cases (slug, title, summary, learning_objective, domain_id, category_id, difficulty, max_lives,
          terminal_behavior, reveal_correct_option_on_wrong, status, answer_label, final_explanation, key_clues,
          learning_points, differentials, is_demo, created_by, updated_by)
        values (${slug}, ${`${source.title} (copy)`.slice(0, 200)}, ${source.summary}, ${source.learningObjective},
          ${source.domainId}, ${source.categoryId}, ${source.difficulty}, ${source.maxLives}, ${source.terminalBehavior},
          ${source.revealCorrectOptionOnWrong}, 'DRAFT', ${source.answerLabel}, ${source.finalExplanation},
          ${tx.json(source.keyClues)}, ${tx.json(source.learningPoints)}, ${tx.json(source.differentials)},
          ${source.isDemo}, ${userId}, ${userId})
        returning id`;
      const stages = source.stages.map((s) => ({ ...s, id: newId(), options: s.options.map((o) => ({ ...o, id: newId() })) }));
      const references = source.references.map((r) => ({ ...r, id: newId() }));
      await writeChildren(tx, row!.id, stages, references);
      await audit(tx, userId, "case.duplicated", row!.id, `Duplicated “${source.title}”`, { sourceCaseId: caseId });
      return row!.id;
    });
  }

  async publish(userId: string, caseId: string, build: (draft: CaseDraft, names: SnapshotNames, version: number) => CaseDefinition) {
    return this.run(userId, async (tx) => {
      const [locked] = await tx`select id from public.cases where id = ${caseId} for update`;
      if (!locked) return null;
      const draft = (await readDraft(tx, caseId))!;
      const names = await readNames(tx, draft);
      const [versionRow] = await tx<{ next: number }[]>`
        select coalesce(max(version), 0)::int + 1 as next from public.case_versions where case_id = ${caseId}`;
      const next = versionRow!.next;
      const snapshot = build(draft, names, next);
      // Re-validate exactly what will be stored and played.
      parseCaseDefinition(snapshot);
      await tx`
        insert into public.case_versions (case_id, version, snapshot, published_by, case_number, slug, title, summary,
          domain, category, difficulty, max_lives, stage_count, is_demo)
        values (${caseId}, ${next}, ${tx.json(snapshot as unknown as Parameters<typeof tx.json>[0])}, ${userId}, ${snapshot.caseNumber},
          ${snapshot.slug}, ${snapshot.title}, ${snapshot.summary}, ${snapshot.domain}, ${names.categoryName},
          ${snapshot.difficulty}, ${snapshot.maxLives}, ${snapshot.stages.length}, ${snapshot.isDemo})`;
      await tx`
        update public.cases set status = 'PUBLISHED', published_version = ${next}, published_at = now(),
          has_unpublished_changes = false, updated_by = ${userId}
        where id = ${caseId}`;
      await audit(tx, userId, "case.published", caseId, `Published “${draft.title}” (version ${next})`, { version: next });
      return { version: next };
    });
  }

  async setStatus(userId: string, caseId: string, status: PublicationStatus, entry: { action: string; summary: string }) {
    return this.run(userId, async (tx) => {
      const rows = await tx`update public.cases set status = ${status}, updated_by = ${userId} where id = ${caseId} returning id`;
      if (rows.length === 0) return false;
      await audit(tx, userId, entry.action, caseId, entry.summary);
      return true;
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

  async createDomain(userId: string, input: { name: string; slug: string; domainType: string }) {
    return this.run(userId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into public.domains (name, slug, domain_type) values (${input.name}, ${input.slug}, ${input.domainType}) returning id`;
      await audit(tx, userId, "domain.created", row!.id, `Added domain “${input.name}”`, {}, "domain");
      return row!.id;
    });
  }

  async createCategory(userId: string, input: { domainId: string; name: string; slug: string }) {
    return this.run(userId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into public.categories (domain_id, name, slug) values (${input.domainId}, ${input.name}, ${input.slug}) returning id`;
      await audit(tx, userId, "category.created", row!.id, `Added category “${input.name}”`, {}, "category");
      return row!.id;
    });
  }

  /* ----------------------------------------------------------------------------- previews */

  async createPreview(userId: string, session: PreviewSession) {
    await this.run(userId, async (tx) => {
      await tx`delete from public.preview_sessions where owner_id = ${userId} and expires_at < now()`;
      await tx`
        insert into public.preview_sessions (id, owner_id, case_id, snapshot, attempt)
        values (${session.id}, ${userId}, ${session.caseId},
          ${tx.json(session.snapshot as unknown as Parameters<typeof tx.json>[0])},
          ${tx.json(session.attempt as unknown as Parameters<typeof tx.json>[0])})`;
    });
  }

  async getPreview(userId: string, sessionId: string) {
    return this.run(userId, async (tx) => {
      const [row] = await tx<{ id: string; case_id: string; snapshot: unknown; attempt: CaseAttempt }[]>`
        select id, case_id, snapshot, attempt from public.preview_sessions where id = ${sessionId} and expires_at > now()`;
      return row ? { id: row.id, caseId: row.case_id, snapshot: parseCaseDefinition(row.snapshot), attempt: row.attempt } : null;
    });
  }

  async updatePreview(userId: string, sessionId: string, attempt: CaseAttempt, expectedRevision: number) {
    return this.run(userId, async (tx) => {
      const rows = await tx`
        update public.preview_sessions set attempt = ${tx.json(attempt as unknown as Parameters<typeof tx.json>[0])}
        where id = ${sessionId} and (attempt ->> 'revision')::int = ${expectedRevision}
        returning id`;
      return rows.length > 0;
    });
  }
}

/* --------------------------------------------------------------------------------- helpers */

function listSelect(tx: Tx) {
  return tx`
    select c.id, c.case_number, c.title, c.slug, d.name as domain, cat.name as category, c.difficulty, c.status,
           (select count(*)::int from public.case_stages s where s.case_id = c.id) as stage_count,
           c.max_lives, c.updated_at, p.display_name as author, c.has_unpublished_changes, c.published_version
    from public.cases c
    join public.domains d on d.id = c.domain_id
    left join public.categories cat on cat.id = c.category_id
    left join public.profiles p on p.id = c.created_by`;
}

function toListItem(r: ListRow): CaseListItem {
  return {
    id: r.id,
    caseNumber: r.case_number,
    title: r.title,
    slug: r.slug,
    domain: r.domain,
    category: r.category,
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
  const [c] = await tx<CaseRow[]>`select * from public.cases where id = ${caseId}`;
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

  return {
    id: c.id,
    caseNumber: c.case_number,
    status: c.status,
    revision: c.draft_revision,
    publishedVersion: c.published_version,
    hasUnpublishedChanges: c.has_unpublished_changes,
    isDemo: c.is_demo,
    updatedAt: toIso(c.updated_at)!,
    title: c.title,
    slug: c.slug,
    summary: c.summary,
    learningObjective: c.learning_objective,
    domainId: c.domain_id,
    categoryId: c.category_id,
    difficulty: c.difficulty,
    maxLives: c.max_lives,
    terminalBehavior: c.terminal_behavior,
    revealCorrectOptionOnWrong: c.reveal_correct_option_on_wrong,
    answerLabel: c.answer_label,
    finalExplanation: c.final_explanation,
    keyClues: c.key_clues,
    learningPoints: c.learning_points,
    differentials: c.differentials,
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
    })),
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

async function readNames(tx: Tx, draft: CaseDraft): Promise<SnapshotNames> {
  const [row] = await tx<{ domain: string; category: string | null }[]>`
    select d.name as domain, (select name from public.categories where id = ${draft.categoryId}) as category
    from public.domains d where d.id = ${draft.domainId}`;
  return { domainName: row?.domain ?? "", categoryName: row?.category ?? null };
}

async function assertCategoryInDomain(tx: Tx, categoryId: string | null, domainId: string) {
  if (!categoryId) return;
  const rows = await tx`select 1 from public.categories where id = ${categoryId} and domain_id = ${domainId}`;
  if (rows.length === 0) throw new ServiceError("INVALID_REQUEST", "Category not in domain", ["The category does not belong to the chosen domain."]);
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
      title: s.title,
      content: s.content,
      question: s.question,
      hint: s.hint || null,
      explanation: s.explanation || null,
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
      s.options.map((o, j) => ({ id: o.id, stage_id: s.id, position: j + 1, label: o.label, is_correct: o.isCorrect })),
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
      title: r.title,
      authors: r.authors || null,
      source: r.source || null,
      year: r.year,
      url: r.url || null,
      doi: r.doi || null,
      pages: r.pages || null,
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

async function audit(
  tx: Tx,
  userId: string,
  action: string,
  entityId: string,
  summary: string,
  details: Record<string, unknown> = {},
  entityType: "case" | "domain" | "category" = "case",
) {
  await tx`
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary, details)
    values (${userId}, ${action}, ${entityType}, ${entityId}, ${summary.slice(0, 300)}, ${tx.json(details as Parameters<typeof tx.json>[0])})`;
}
