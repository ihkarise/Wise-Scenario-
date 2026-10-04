import { beginAttempt, createAttempt, submitAnswer, toPlayerView, type PlayerView } from "@/lib/engine";
import type { AnswerSubmission, CaseAttempt, CaseDefinition } from "@/lib/engine/types";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/actor";
import { ServiceError, serviceErrorFromEngine } from "@/lib/server/service-error";
import type { CaseRepository } from "@/features/cases/case-repository";
import type { AttemptHistoryItem, AttemptRepository } from "./attempt-repository";
import { ownerKeyFor } from "./owner";

export type AttemptServiceDeps = {
  cases: CaseRepository;
  attempts: AttemptRepository;
  clock: () => Date;
  newId: () => string;
};

export type SubmitResult = { view: PlayerView; duplicate: boolean };

/**
 * The server-authoritative boundary for play. Every decision about correctness, lives, score,
 * stage progression, completion and publication status is made here (via the pure engine),
 * never trusted from the browser. Only PlayerView projections leave this service.
 */
export class AttemptService {
  constructor(private readonly deps: AttemptServiceDeps) {}

  /** Starts a new attempt, or resumes the learner's in-progress attempt so a refresh never restores lives. */
  async startOrResume(actor: Actor, caseSlug: string): Promise<PlayerView> {
    this.requirePlay(actor);
    const caseDef = await this.findPublishedBySlug(caseSlug);

    const active = await this.deps.attempts.findActive(ownerKeyFor(actor), caseDef.id);
    if (active) return toPlayerView(await this.loadVersion(active), active);

    const fresh = beginAttempt(createAttempt(caseDef, { attemptId: this.deps.newId(), ownerId: ownerKeyFor(actor) }), this.deps.clock());
    // Two rapid "Start" clicks resolve to the same attempt.
    const stored = await this.deps.attempts.insertIfNoActive(fresh);
    return toPlayerView(stored.id === fresh.id ? caseDef : await this.loadVersion(stored), stored);
  }

  /** The learner's in-progress attempt for a case, if any (used to resume on page load). */
  async getActiveView(actor: Actor | null, caseSlug: string): Promise<PlayerView | null> {
    if (!actor || !can(actor, "case:play")) return null;
    const caseDef = await this.deps.cases.findBySlug(caseSlug);
    if (!caseDef || caseDef.publicationStatus !== "PUBLISHED") return null;
    const active = await this.deps.attempts.findActive(ownerKeyFor(actor), caseDef.id);
    return active ? toPlayerView(await this.loadVersion(active), active) : null;
  }

  /** The signed-in learner's (or guest's) recent attempts. */
  async history(actor: Actor, limit = 20): Promise<AttemptHistoryItem[]> {
    return this.deps.attempts.listHistory(ownerKeyFor(actor), Math.min(Math.max(limit, 1), 100));
  }

  async getView(actor: Actor, attemptId: string): Promise<PlayerView> {
    const attempt = await this.loadOwnedAttempt(actor, attemptId);
    return toPlayerView(await this.loadVersion(attempt), attempt);
  }

  async submitAnswer(actor: Actor, attemptId: string, submission: AnswerSubmission): Promise<SubmitResult> {
    this.requirePlay(actor);
    // Two passes at most: if another request saved first, re-evaluate against the fresh state.
    // The second pass resolves as an idempotent duplicate or a stale-state rejection; it never double-applies.
    for (let pass = 0; pass < 2; pass++) {
      const attempt = await this.loadOwnedAttempt(actor, attemptId);
      const caseDef = await this.loadVersion(attempt);
      await this.requireStillPublished(attempt.caseId);

      const outcome = submitAnswer(caseDef, attempt, submission, { now: this.deps.clock() });
      if (!outcome.ok) throw serviceErrorFromEngine(outcome.error.code, outcome.error.detail);
      if (outcome.duplicate) return { view: toPlayerView(caseDef, attempt), duplicate: true };

      if (await this.deps.attempts.update(outcome.attempt, attempt.revision)) {
        return { view: toPlayerView(caseDef, outcome.attempt), duplicate: false };
      }
    }
    throw new ServiceError("STALE_STATE", "Concurrent update could not be resolved");
  }

  private requirePlay(actor: Actor) {
    if (!can(actor, "case:play")) throw new ServiceError("FORBIDDEN");
  }

  private async findPublishedBySlug(slug: string): Promise<CaseDefinition> {
    const caseDef = await this.deps.cases.findBySlug(slug);
    // Drafts, archived and missing cases look identical to learners, so draft slugs are not revealed.
    if (!caseDef || caseDef.publicationStatus !== "PUBLISHED") throw new ServiceError("CASE_UNAVAILABLE");
    return caseDef;
  }

  private async requireStillPublished(caseId: string) {
    const live = await this.deps.cases.findById(caseId);
    if (!live || live.publicationStatus !== "PUBLISHED") throw new ServiceError("CASE_UNAVAILABLE");
  }

  /** Someone else's attempt is reported as "not found" so attempt IDs cannot be probed. */
  private async loadOwnedAttempt(actor: Actor, attemptId: string): Promise<CaseAttempt> {
    const attempt = await this.deps.attempts.findById(attemptId);
    if (!attempt || attempt.ownerId !== ownerKeyFor(actor)) throw new ServiceError("ATTEMPT_NOT_FOUND");
    return attempt;
  }

  private async loadVersion(attempt: CaseAttempt): Promise<CaseDefinition> {
    const caseDef = await this.deps.cases.findVersion(attempt.caseId, attempt.caseVersion);
    if (!caseDef) throw new ServiceError("CASE_UNAVAILABLE", `Missing case version ${attempt.caseId}@${attempt.caseVersion}`);
    return caseDef;
  }
}
