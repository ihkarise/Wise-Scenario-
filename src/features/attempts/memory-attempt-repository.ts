import type { CaseAttempt } from "@/lib/engine/types";
import type { AttemptRepository } from "./attempt-repository";

/**
 * In-memory attempts for local development and tests. Data is lost when the server restarts and is
 * not shared between serverless instances, so this is never used in production.
 * Each method does its check-and-write without awaiting in between, so it is atomic in Node's event loop.
 */
export class MemoryAttemptRepository implements AttemptRepository {
  private readonly rows = new Map<string, CaseAttempt>();

  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async findActive(ownerId: string, caseId: string) {
    const row = this.active(ownerId, caseId);
    return row ? structuredClone(row) : null;
  }

  async insertIfNoActive(attempt: CaseAttempt) {
    const existing = this.active(attempt.ownerId, attempt.caseId);
    if (existing) return structuredClone(existing);
    if (this.rows.has(attempt.id)) throw new Error(`Attempt ${attempt.id} already exists`);
    this.rows.set(attempt.id, structuredClone(attempt));
    return structuredClone(attempt);
  }

  async update(attempt: CaseAttempt, expectedRevision: number) {
    const stored = this.rows.get(attempt.id);
    if (!stored || stored.revision !== expectedRevision) return false;
    this.rows.set(attempt.id, structuredClone(attempt));
    return true;
  }

  private active(ownerId: string, caseId: string): CaseAttempt | undefined {
    for (const row of this.rows.values()) {
      if (row.ownerId === ownerId && row.caseId === caseId && row.status === "IN_PROGRESS") return row;
    }
    return undefined;
  }
}
