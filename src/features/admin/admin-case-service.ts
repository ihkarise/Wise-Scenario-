import { beginAttempt, createAttempt, submitAnswer, toPlayerView, type PlayerView } from "@/lib/engine";
import type { AnswerSubmission, CaseDefinition, PublicationStatus } from "@/lib/engine/types";
import { can, type Actor } from "@/lib/auth/actor";
import type { Permission } from "@/lib/auth/roles";
import { parseCaseDefinition } from "@/lib/schemas/case";
import { ServiceError, serviceErrorFromEngine } from "@/lib/server/service-error";
import type { AdminRepository, CaseListQuery, SnapshotNames } from "./admin-repository";
import {
  checkReadiness,
  draftToCaseDefinitionInput,
  emptyStage,
  slugify,
  STATUS_LABEL,
  type CaseAction,
  type CaseDraft,
  type CaseDraftContent,
  type CreateCaseInput,
} from "./draft";

export type AdminServiceDeps = { repo: AdminRepository; newId: () => string; clock: () => Date };

/**
 * Authoring rules. Every method checks the actor's permissions here AND runs its queries as that user,
 * so the database (RLS + publish trigger) enforces the same rules independently.
 * Only SUPER_ADMIN holds `case:publish` for now.
 */
export class AdminCaseService {
  constructor(private readonly deps: AdminServiceDeps) {}

  private require(actor: Actor | null, permission: Permission): asserts actor is Actor & { kind: "user" } {
    if (!actor || actor.kind !== "user") throw new ServiceError("UNAUTHORIZED");
    if (!can(actor, permission)) throw new ServiceError("FORBIDDEN");
  }

  async dashboard(actor: Actor | null) {
    this.require(actor, "admin:access");
    return this.deps.repo.dashboard(actor.id);
  }

  async listCases(actor: Actor | null, query: CaseListQuery) {
    this.require(actor, "admin:access");
    return this.deps.repo.listCases(actor.id, query);
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

  async createCase(actor: Actor | null, input: CreateCaseInput): Promise<string> {
    this.require(actor, "case:edit");
    const slug = await this.uniqueSlug(actor.id, slugify(input.title));
    return this.deps.repo.createCase(actor.id, { ...input, slug, firstStage: emptyStage(this.deps.newId) });
  }

  async saveDraft(actor: Actor | null, caseId: string, content: CaseDraftContent, expectedRevision: number) {
    this.require(actor, "case:edit");
    const result = await this.deps.repo.saveDraft(actor.id, caseId, content, expectedRevision);
    if (result.status === "not_found") throw new ServiceError("CASE_NOT_FOUND");
    if (result.status === "conflict") throw new ServiceError("EDIT_CONFLICT");
    return result;
  }

  async duplicate(actor: Actor | null, caseId: string): Promise<string> {
    this.require(actor, "case:edit");
    const id = await this.deps.repo.duplicate(actor.id, caseId, this.deps.newId);
    if (!id) throw new ServiceError("CASE_NOT_FOUND");
    return id;
  }

  async applyAction(actor: Actor | null, caseId: string, action: CaseAction): Promise<{ status: PublicationStatus; version?: number }> {
    if (action === "publish") return this.publish(actor, caseId);

    const draft = await this.getDraft(actor, caseId);
    const a = actor as Actor & { kind: "user" };
    const set = async (status: PublicationStatus, auditAction: string, verb: string) => {
      const ok = await this.deps.repo.setStatus(a.id, caseId, status, { action: auditAction, summary: `${verb} “${draft.title}”` });
      if (!ok) throw new ServiceError("CASE_NOT_FOUND");
      return { status };
    };

    switch (action) {
      case "unpublish":
        this.require(actor, "case:publish");
        if (draft.status !== "PUBLISHED") throw new ServiceError("INVALID_TRANSITION");
        return set("DRAFT", "case.unpublished", "Unpublished");
      case "archive":
        this.require(actor, draft.status === "PUBLISHED" ? "case:publish" : "case:edit");
        if (draft.status === "ARCHIVED") throw new ServiceError("INVALID_TRANSITION");
        return set("ARCHIVED", "case.archived", "Archived");
      case "restore":
        this.require(actor, "case:edit");
        if (draft.status !== "ARCHIVED") throw new ServiceError("INVALID_TRANSITION");
        return set("DRAFT", "case.restored", "Restored");
      case "submit_for_review": {
        this.require(actor, "case:submit_review");
        if (draft.status !== "DRAFT") throw new ServiceError("INVALID_TRANSITION");
        const readiness = checkReadiness(draft);
        if (!readiness.canPublish) {
          throw new ServiceError("NOT_READY", "Draft incomplete", [...readiness.playErrors, ...readiness.publishErrors].map((i) => i.message));
        }
        return set("READY_FOR_REVIEW", "case.submitted_for_review", "Submitted for review");
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
   * Starts a preview of the CURRENT working copy. The snapshot is stored server-side in a preview
   * session (never sent to the browser); the browser receives the same PlayerView as a learner would.
   * No attempt, statistic or learner history is created.
   */
  async startPreview(actor: Actor | null, caseId: string): Promise<PlayerView> {
    this.require(actor, "case:read_draft");
    const loaded = await this.deps.repo.getDraftWithNames(actor.id, caseId);
    if (!loaded) throw new ServiceError("CASE_NOT_FOUND");
    const snapshot = buildSnapshot(loaded.draft, loaded.names, (loaded.draft.publishedVersion ?? 0) + 1, "preview");
    const sessionId = this.deps.newId();
    const attempt = beginAttempt(createAttempt(snapshot, { attemptId: sessionId, ownerId: `preview:${actor.id}` }), this.deps.clock());
    await this.deps.repo.createPreview(actor.id, { id: sessionId, caseId, snapshot, attempt });
    return toPreviewView(snapshot, attempt);
  }

  async getPreview(actor: Actor | null, sessionId: string): Promise<PlayerView> {
    this.require(actor, "case:read_draft");
    const session = await this.deps.repo.getPreview(actor.id, sessionId);
    if (!session) throw new ServiceError("ATTEMPT_NOT_FOUND");
    return toPreviewView(session.snapshot, session.attempt);
  }

  async submitPreviewAnswer(actor: Actor | null, sessionId: string, submission: AnswerSubmission) {
    this.require(actor, "case:read_draft");
    for (let pass = 0; pass < 2; pass++) {
      const session = await this.deps.repo.getPreview(actor.id, sessionId);
      if (!session) throw new ServiceError("ATTEMPT_NOT_FOUND");
      const outcome = submitAnswer(session.snapshot, session.attempt, submission, { now: this.deps.clock() });
      if (!outcome.ok) throw serviceErrorFromEngine(outcome.error.code, outcome.error.detail);
      if (outcome.duplicate) return { view: toPreviewView(session.snapshot, session.attempt), duplicate: true };
      if (await this.deps.repo.updatePreview(actor.id, sessionId, outcome.attempt, session.attempt.revision)) {
        return { view: toPreviewView(session.snapshot, outcome.attempt), duplicate: false };
      }
    }
    throw new ServiceError("STALE_STATE");
  }

  async createDomain(actor: Actor | null, input: { name: string; slug: string; domainType: string }) {
    this.require(actor, "case:publish");
    return this.deps.repo.createDomain(actor.id, input);
  }

  async createCategory(actor: Actor | null, input: { domainId: string; name: string; slug: string }) {
    this.require(actor, "case:publish");
    return this.deps.repo.createCategory(actor.id, input);
  }

  private async uniqueSlug(userId: string, base: string): Promise<string> {
    let slug = base;
    for (let n = 2; await this.deps.repo.slugExists(userId, slug); n++) slug = `${base.slice(0, 70)}-${n}`;
    return slug;
  }
}

/** Converts a draft into an engine case, or explains in plain words why it cannot be played yet. */
export function buildSnapshot(draft: CaseDraft, names: SnapshotNames, version: number, mode: "publish" | "preview"): CaseDefinition {
  const readiness = checkReadiness(draft);
  const blocking = mode === "publish" ? [...readiness.playErrors, ...readiness.publishErrors] : readiness.playErrors;
  if (blocking.length > 0) {
    throw new ServiceError("NOT_READY", "Draft incomplete", blocking.map((i) => i.message));
  }
  const input = draftToCaseDefinitionInput(draft, {
    caseId: draft.id,
    caseNumber: draft.caseNumber,
    version,
    domainName: names.domainName,
    categoryName: names.categoryName,
    isDemo: draft.isDemo,
    mode,
  });
  const parsed = parseCaseDefinition(input);
  return parsed;
}

function toPreviewView(snapshot: CaseDefinition, attempt: Parameters<typeof toPlayerView>[1]): PlayerView {
  return toPlayerView(snapshot, attempt);
}

export { STATUS_LABEL };
