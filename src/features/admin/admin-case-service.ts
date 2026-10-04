import type { CaseDefinition, PublicationStatus } from "@/lib/engine/types";
import { can, type Actor } from "@/lib/auth/actor";
import type { Permission } from "@/lib/auth/roles";
import { parseCaseDefinition } from "@/lib/schemas/case";
import { ServiceError } from "@/lib/server/service-error";
import {
  documentToDraftContent,
  draftToDocument,
  exportFileName,
  validateCaseDocument,
  type CaseDocument,
  type CheckItem,
} from "@/features/case-manager/case-document";
import { ConditionIndex, mergeConditions, type Condition } from "@/features/case-manager/conditions";
import { findDuplicates, isCandidate, type CaseFingerprint, type DuplicateMatch } from "@/features/case-manager/duplicates";
import type { AdminRepository, CaseListQuery, SnapshotNames } from "./admin-repository";
import {
  checkReadiness,
  cleanDraft,
  diagnosisNames,
  draftToCaseDefinitionInput,
  emptyDiagnosis,
  saveBlockers,
  slugify,
  STATUS_LABEL,
  type CaseAction,
  type CaseDraft,
  type CaseDraftContent,
  type CreateCaseInput,
} from "./draft";

export type AdminServiceDeps = {
  repo: AdminRepository;
  newId: () => string;
  clock: () => Date;
  /** Starter terminology list (data/conditions.json). */
  conditionSeeds?: readonly Condition[];
};

export type ImportSummary = {
  caseCode: string;
  title: string;
  category: string;
  subcategory: string;
  difficulty: string;
  stageCount: number;
  diagnosis: string;
  differentialCount: number;
};

export type DocumentCheck = {
  /** True when there are no errors (duplicates may still need confirmation). */
  ok: boolean;
  items: CheckItem[];
  duplicates: DuplicateMatch[];
  summary: ImportSummary | null;
};

const CONDITION_CACHE_MS = 60_000;

/**
 * Authoring rules. Every method checks the actor's permissions here AND runs its queries as that user,
 * so the database (RLS + publish trigger) enforces the same rules independently.
 * Only SUPER_ADMIN holds `case:publish`.
 */
export class AdminCaseService {
  private conditionCache: { at: number; index: ConditionIndex; all: Condition[] } | null = null;

  constructor(private readonly deps: AdminServiceDeps) {}

  private require(actor: Actor | null, permission: Permission): asserts actor is Actor & { kind: "user" } {
    if (!actor || actor.kind !== "user") throw new ServiceError("UNAUTHORIZED");
    if (!can(actor, permission)) throw new ServiceError("FORBIDDEN");
  }

  private writeOptions(actor: Actor) {
    return { allowCreateCategory: can(actor, "taxonomy:manage") };
  }

  /** Throws unless the actor is signed-in staff. */
  assertAccess(actor: Actor | null): void {
    this.require(actor, "admin:access");
  }

  async dashboard(actor: Actor | null) {
    this.require(actor, "admin:access");
    return this.deps.repo.dashboard(actor.id);
  }

  async listCases(actor: Actor | null, query: CaseListQuery, maxPageSize = 100) {
    this.require(actor, "admin:access");
    return this.deps.repo.listCases(actor.id, query, maxPageSize);
  }

  async getDraft(actor: Actor | null, caseId: string): Promise<CaseDraft> {
    this.require(actor, "case:read_draft");
    const draft = await this.deps.repo.getDraft(actor.id, caseId);
    if (!draft) throw new ServiceError("CASE_NOT_FOUND");
    return draft;
  }

  async taxonomy(actor: Actor | null) {
    this.require(actor, "admin:access");
    const [domains, categories] = await Promise.all([this.deps.repo.listDomains(actor.id), this.deps.repo.listCategories(actor.id)]);
    return { domains, categories };
  }

  /* ------------------------------------------------------------------ create / edit */

  /** Creates an empty DRAFT. The author adds stages and content in the editor. */
  async createCase(actor: Actor | null, input: CreateCaseInput): Promise<string> {
    this.require(actor, "case:edit");
    const content: CaseDraftContent = {
      caseCode: input.caseCode.trim(),
      title: input.title.trim(),
      slug: slugify(input.title),
      summary: "",
      learningObjective: "",
      domainId: input.domainId,
      category: input.category.trim(),
      subcategory: input.subcategory.trim(),
      difficulty: input.difficulty,
      maxLives: input.maxLives,
      lifeLossPerWrong: 1,
      startingScore: null,
      wrongAnswerPenalty: null,
      terminalBehavior: "REVEAL_ANSWER",
      revealCorrectOptionOnWrong: false,
      stages: [],
      diagnosis: emptyDiagnosis(),
      differentialDiagnoses: [],
      wrongAnswerExplanations: [],
      clinicalSummary: "",
      clinicalInsight: "",
      diagnosticReasoning: "",
      investigationSummary: "",
      whereReasoningCanGoWrong: "",
      learningPoints: [],
      references: [],
    };
    return this.deps.repo.createCase(actor.id, content, this.writeOptions(actor));
  }

  async saveDraft(actor: Actor | null, caseId: string, content: CaseDraftContent, expectedRevision: number) {
    this.require(actor, "case:edit");
    const cleaned = cleanDraft(content);
    const blockers = saveBlockers(cleaned);
    if (blockers.length > 0) throw new ServiceError("DRAFT_INCOMPLETE", "Draft has empty required fields", blockers);
    const result = await this.deps.repo.saveDraft(actor.id, caseId, cleaned, expectedRevision, this.writeOptions(actor));
    if (result.status === "not_found") throw new ServiceError("CASE_NOT_FOUND");
    if (result.status === "conflict") throw new ServiceError("EDIT_CONFLICT");
    return result;
  }

  /** Copies a case as a new DRAFT with a new Case ID ("…-COPY"). The original is untouched. */
  async duplicate(actor: Actor | null, caseId: string): Promise<string> {
    this.require(actor, "case:edit");
    const source = await this.getDraft(actor, caseId);
    const base = `${source.caseCode}-COPY`.slice(0, 34);
    let caseCode = base;
    for (let n = 2; await this.deps.repo.findByCaseCode(actor.id, caseCode); n++) caseCode = `${base}-${n}`;
    const { newId } = this.deps;
    const copy: CaseDraftContent = {
      ...source,
      caseCode,
      title: `${source.title} (copy)`.slice(0, 200),
      slug: slugify(`${source.title} copy`),
      stages: source.stages.map((s) => ({ ...s, id: newId(), options: s.options.map((o) => ({ ...o, id: newId() })) })),
      references: source.references.map((r) => ({ ...r, id: newId() })),
    };
    return this.deps.repo.createCase(actor.id, copy, this.writeOptions(actor));
  }

  async applyAction(actor: Actor | null, caseId: string, action: CaseAction): Promise<{ status: PublicationStatus; version?: number }> {
    if (action === "publish") return this.publish(actor, caseId);

    const draft = await this.getDraft(actor, caseId);
    const a = actor as Actor & { kind: "user" };
    const set = async (status: PublicationStatus) => {
      if (!(await this.deps.repo.setStatus(a.id, caseId, status))) throw new ServiceError("CASE_NOT_FOUND");
      return { status };
    };

    switch (action) {
      case "unpublish":
        this.require(actor, "case:publish");
        if (draft.status !== "PUBLISHED") throw new ServiceError("INVALID_TRANSITION");
        return set("DRAFT");
      case "archive":
        this.require(actor, draft.status === "PUBLISHED" ? "case:publish" : "case:edit");
        if (draft.status === "ARCHIVED") throw new ServiceError("INVALID_TRANSITION");
        return set("ARCHIVED");
      case "restore":
        this.require(actor, "case:edit");
        if (draft.status !== "ARCHIVED") throw new ServiceError("INVALID_TRANSITION");
        return set("DRAFT");
      case "submit_for_review": {
        this.require(actor, "case:submit_review");
        if (draft.status !== "DRAFT") throw new ServiceError("INVALID_TRANSITION");
        const readiness = checkReadiness(draft);
        if (!readiness.canPublish) {
          throw new ServiceError("NOT_READY", "Draft incomplete", [...readiness.playErrors, ...readiness.publishErrors].map((i) => i.message));
        }
        return set("READY_FOR_REVIEW");
      }
    }
  }

  private async publish(actor: Actor | null, caseId: string) {
    this.require(actor, "case:publish");
    const current = await this.getDraft(actor, caseId);
    if (current.status === "ARCHIVED") throw new ServiceError("INVALID_TRANSITION", "Restore before publishing");
    if (current.status === "PUBLISHED" && !current.hasUnpublishedChanges) {
      throw new ServiceError("INVALID_TRANSITION", "Nothing new to publish", ["There are no changes since the last publication."]);
    }
    const result = await this.deps.repo.publish(actor.id, caseId, (draft, names, version) => buildSnapshot(draft, names, version, "publish"));
    if (!result) throw new ServiceError("CASE_NOT_FOUND");
    return { status: "PUBLISHED" as const, version: result.version };
  }

  /* ------------------------------------------------------------------ preview as learner */

  /**
   * The saved working copy as a playable case, for "Preview as learner". Only staff who may read drafts
   * receive it. It is played with the same engine and screens as the real game, but nothing is stored:
   * no attempt, score or learner history is created, and learners never see drafts.
   */
  async previewSnapshot(actor: Actor | null, caseId: string): Promise<CaseDefinition> {
    this.require(actor, "case:read_draft");
    const loaded = await this.deps.repo.getDraftWithNames(actor.id, caseId);
    if (!loaded) throw new ServiceError("CASE_NOT_FOUND");
    return buildSnapshot(loaded.draft, loaded.names, (loaded.draft.publishedVersion ?? 0) + 1, "preview");
  }

  /* ------------------------------------------------------------------ JSON export / import */

  async exportCase(actor: Actor | null, caseId: string) {
    this.require(actor, "case:read_draft");
    const loaded = await this.deps.repo.getDraftWithNames(actor.id, caseId);
    if (!loaded) throw new ServiceError("CASE_NOT_FOUND");
    return { fileName: exportFileName(loaded.draft), document: draftToDocument(loaded.draft, { domain: loaded.names.domainName }) };
  }

  /** Full check of a case file: format, required fields, taxonomy, Case ID and possible duplicates. */
  async checkDocument(actor: Actor | null, raw: unknown, exceptCaseId?: string): Promise<DocumentCheck & { document: CaseDocument | null; domainId: string | null }> {
    this.require(actor, "case:edit");
    const result = validateCaseDocument(raw);
    const items = [...result.items];
    const doc = result.document;
    let domainId: string | null = null;
    let duplicates: DuplicateMatch[] = [];

    if (doc) {
      const domain = await this.deps.repo.findDomainByName(actor.id, doc.domain);
      if (!domain) {
        items.push({ level: "error", message: `Domain “${doc.domain}” does not exist. Use an existing domain such as “Medical Diagnosis”.` });
      } else {
        domainId = domain.id;
        const category = await this.deps.repo.findCategory(actor.id, domain.id, doc.category);
        if (!category) {
          items.push(
            can(actor, "taxonomy:manage")
              ? { level: "info", message: `Category “${doc.category}” is new and will be created in ${domain.name}.` }
              : { level: "error", message: `Category “${doc.category}” does not exist. Use an existing category, or ask an administrator to add it.` },
          );
        }
      }
      const taken = await this.deps.repo.findByCaseCode(actor.id, doc.id, exceptCaseId);
      if (taken) {
        items.push({
          level: "error",
          message: `Case ID ${doc.id} is already used by “${taken.title}”. Existing cases are never overwritten: change the id to import this as a new case.`,
        });
      }
      duplicates = await this.findSimilar(actor.id, fingerprintOf(doc), exceptCaseId);
      const similar = duplicates.filter((d) => !d.sameCaseId);
      if (similar.length > 0) {
        items.push({ level: "warning", message: `Possible duplicate: ${similar.length === 1 ? "1 similar case" : `${similar.length} similar cases`} already exist.` });
      }
    }

    const ok = doc !== null && !items.some((i) => i.level === "error");
    return {
      ok,
      items: sortItems(items),
      duplicates,
      document: ok ? doc : null,
      domainId,
      summary: doc
        ? {
            caseCode: doc.id,
            title: doc.title,
            category: doc.category,
            subcategory: doc.subcategory,
            difficulty: doc.difficulty,
            stageCount: doc.stages.length,
            diagnosis: doc.diagnosis.displayName,
            differentialCount: doc.differentialDiagnoses.length,
          }
        : null,
    };
  }

  async validateDocument(actor: Actor | null, raw: unknown, exceptCaseId?: string): Promise<DocumentCheck> {
    const { ok, items, duplicates, summary } = await this.checkDocument(actor, raw, exceptCaseId);
    return { ok, items, duplicates, summary };
  }

  /**
   * Creates a new DRAFT from a case file. Re-checks everything on the server (the browser's check is
   * never trusted). Possible duplicates must be confirmed with `allowDuplicates`; an existing Case ID
   * always blocks the import. Nothing is ever overwritten.
   */
  async importDocument(actor: Actor | null, raw: unknown, options: { allowDuplicates: boolean }) {
    const check = await this.checkDocument(actor, raw);
    if (!check.ok || !check.document || !check.domainId) {
      throw new ServiceError(
        "INVALID_CASE_FILE",
        "Case file invalid",
        check.items.filter((i) => i.level === "error").map((i) => i.message),
      );
    }
    if (check.duplicates.length > 0 && !options.allowDuplicates) {
      throw new ServiceError("DUPLICATE_CONFIRMATION_REQUIRED", "Duplicates not confirmed", check.duplicates.map((d) => `${d.caseCode} — ${d.title} (${d.similarity}%)`));
    }
    const a = actor as Actor & { kind: "user" };
    const content = documentToDraftContent(check.document, { domainId: check.domainId, slug: slugify(check.document.title), newId: this.deps.newId });
    const blockers = saveBlockers(content);
    if (blockers.length > 0) throw new ServiceError("INVALID_CASE_FILE", "Case file incomplete", blockers);
    const caseId = await this.deps.repo.createCase(a.id, content, this.writeOptions(a));
    return { caseId, items: check.items };
  }

  /** Possible duplicates of an existing draft (used by the editor's "Validate"). */
  async duplicatesOf(actor: Actor | null, caseId: string): Promise<DuplicateMatch[]> {
    const draft = await this.getDraft(actor, caseId);
    const a = actor as Actor & { kind: "user" };
    return this.findSimilar(
      a.id,
      { caseCode: draft.caseCode, title: draft.title, diagnosisNames: diagnosisNames(draft.diagnosis), clueText: draft.stages.map((s) => s.content).join(" ") },
      caseId,
    );
  }

  private async findSimilar(userId: string, fingerprint: CaseFingerprint, exceptCaseId?: string): Promise<DuplicateMatch[]> {
    // Two cheap queries regardless of library size: light fingerprints of every case, then clue text
    // for a short list of candidates only (no per-case queries).
    const all = await this.deps.repo.duplicateCandidates(userId, exceptCaseId);
    const candidates = all.filter((e) => isCandidate(fingerprint, e)).slice(0, 25);
    const clues = await this.deps.repo.clueTexts(userId, candidates.map((c) => c.id));
    return findDuplicates(fingerprint, candidates.map((c) => ({ ...c, clueText: clues.get(c.id) ?? "" })));
  }

  /* ------------------------------------------------------------------ condition inventory */

  private async conditions(userId: string) {
    const now = this.deps.clock().getTime();
    if (!this.conditionCache || now - this.conditionCache.at > CONDITION_CACHE_MS) {
      const all = mergeConditions(this.deps.conditionSeeds ?? [], await this.deps.repo.conditionsFromCases(userId));
      this.conditionCache = { at: now, index: new ConditionIndex(all), all };
    }
    return this.conditionCache;
  }

  /** Author autocomplete. Staff only: it includes names written in draft cases. */
  async searchConditions(actor: Actor | null, query: string, limit = 10): Promise<Condition[]> {
    this.require(actor, "admin:access");
    if (!query.trim()) return [];
    return (await this.conditions(actor.id)).index.search(query.slice(0, 100), limit);
  }

  async conditionInventory(actor: Actor | null, query: string, page: number, pageSize = 50) {
    this.require(actor, "admin:access");
    const { index, all } = await this.conditions(actor.id);
    const matches = query.trim() ? index.search(query.slice(0, 100), 50) : all;
    const start = (Math.max(page, 1) - 1) * pageSize;
    return { items: matches.slice(start, start + pageSize), total: matches.length, inventoryCount: all.length };
  }
}

function fingerprintOf(doc: CaseDocument): CaseFingerprint {
  return {
    caseCode: doc.id,
    title: doc.title,
    diagnosisNames: [doc.diagnosis.primary, doc.diagnosis.displayName, ...doc.diagnosis.acceptedAnswers, ...doc.diagnosis.aliases],
    clueText: doc.stages.map((s) => s.clue).join(" "),
  };
}

const ORDER: Record<CheckItem["level"], number> = { ok: 0, info: 1, warning: 2, error: 3 };
const sortItems = (items: CheckItem[]) => [...items].sort((a, b) => ORDER[a.level] - ORDER[b.level]);

/** Converts a draft into an engine case, or explains in plain words why it cannot be played yet. */
export function buildSnapshot(draft: CaseDraft, names: SnapshotNames, version: number, mode: "publish" | "preview"): CaseDefinition {
  const readiness = checkReadiness(draft);
  const blocking = mode === "publish" ? [...readiness.playErrors, ...readiness.publishErrors] : readiness.playErrors;
  if (blocking.length > 0) {
    throw new ServiceError("NOT_READY", "Draft incomplete", blocking.map((i) => i.message));
  }
  return parseCaseDefinition(
    draftToCaseDefinitionInput(draft, {
      caseId: draft.id,
      caseNumber: draft.caseNumber,
      version,
      domainName: names.domainName,
      categoryName: names.categoryName,
      isDemo: draft.isDemo,
      mode,
    }),
  );
}

export { STATUS_LABEL };
