import type { AttemptStatus, CaseAttempt } from "@/lib/engine/types";

export type AttemptHistoryItem = {
  attemptId: string;
  caseSlug: string;
  caseTitle: string;
  status: AttemptStatus;
  score: number | null;
  livesRemaining: number;
  startedAt: string | null;
  completedAt: string | null;
};

/**
 * Persistence for ATTEMPT state (never for content).
 * The PostgreSQL implementation (postgres-attempt-repository.ts) maps these to:
 *  - insertIfNoActive → INSERT guarded by unique partial indexes on (user_id|guest_id, case_id) WHERE status = 'IN_PROGRESS'
 *  - update           → UPDATE … WHERE id = $1 AND revision = $expected, plus INSERT INTO attempt_answers
 *                        (unique on attempt_id + submission_id and attempt_id + sequence), in one transaction
 */
export interface AttemptRepository {
  findById(id: string): Promise<CaseAttempt | null>;
  findActive(ownerId: string, caseId: string): Promise<CaseAttempt | null>;
  /** Inserts the attempt unless the owner already has one in progress for this case; returns whichever is active. */
  insertIfNoActive(attempt: CaseAttempt): Promise<CaseAttempt>;
  /** Compare-and-swap. Saves only if the stored revision equals `expectedRevision`; returns false otherwise. */
  update(attempt: CaseAttempt, expectedRevision: number): Promise<boolean>;
  /** Most recent attempts of one owner, newest first. */
  listHistory(ownerKey: string, limit: number): Promise<AttemptHistoryItem[]>;
}
