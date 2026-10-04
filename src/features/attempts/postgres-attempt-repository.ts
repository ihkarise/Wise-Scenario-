import type { AnswerRecord, AttemptStatus, CaseAttempt, CompletionReason } from "@/lib/engine/types";
import { toIso, type Sql } from "@/lib/db/client";
import type { AttemptHistoryItem, AttemptRepository } from "./attempt-repository";
import { parseOwnerKey } from "./owner";

type AttemptRow = {
  id: string;
  user_id: string | null;
  guest_id: string | null;
  case_id: string;
  case_version: number;
  status: AttemptStatus;
  current_stage_index: number;
  lives_remaining: number;
  score: number | null;
  completion_reason: CompletionReason | null;
  revision: number;
  started_at: Date | null;
  completed_at: Date | null;
};

type AnswerRow = {
  submission_id: string;
  sequence: number;
  stage_id: string;
  stage_position: number;
  option_id: string;
  is_correct: boolean;
  lives_before: number;
  lives_after: number;
  answered_at: Date;
};

/**
 * Attempts in PostgreSQL. Uses the server's privileged connection: learners have no write access to
 * attempts at all, and every call is made only after AttemptService has checked ownership.
 */
export class PostgresAttemptRepository implements AttemptRepository {
  constructor(private readonly sql: Sql) {}

  async findById(id: string) {
    const [row] = await this.sql<AttemptRow[]>`select * from public.attempts where id = ${id}`;
    return row ? this.withAnswers(row) : null;
  }

  async findActive(ownerKey: string, caseId: string) {
    const owner = parseOwnerKey(ownerKey);
    const column = owner.kind === "user" ? this.sql`user_id` : this.sql`guest_id`;
    const [row] = await this.sql<AttemptRow[]>`
      select * from public.attempts where ${column} = ${owner.id} and case_id = ${caseId} and status = 'IN_PROGRESS'`;
    return row ? this.withAnswers(row) : null;
  }

  async insertIfNoActive(attempt: CaseAttempt) {
    const owner = parseOwnerKey(attempt.ownerId);
    // A unique partial index allows only one in-progress attempt per owner and case; a concurrent
    // second insert does nothing and the existing attempt is returned instead.
    const inserted = await this.sql`
      insert into public.attempts (id, user_id, guest_id, case_id, case_version, status, current_stage_index,
        lives_remaining, score, completion_reason, revision, started_at, completed_at)
      values (${attempt.id}, ${owner.kind === "user" ? owner.id : null}, ${owner.kind === "guest" ? owner.id : null},
        ${attempt.caseId}, ${attempt.caseVersion}, ${attempt.status}, ${attempt.currentStageIndex},
        ${attempt.livesRemaining}, ${attempt.score}, ${attempt.completionReason}, ${attempt.revision},
        ${attempt.startedAt}, ${attempt.completedAt})
      on conflict do nothing
      returning id`;
    if (inserted.length > 0) return attempt;
    const active = await this.findActive(attempt.ownerId, attempt.caseId);
    if (!active) throw new Error("Attempt insert conflicted but no active attempt was found");
    return active;
  }

  async update(attempt: CaseAttempt, expectedRevision: number) {
    return this.sql.begin(async (tx) => {
      const updated = await tx`
        update public.attempts set
          status = ${attempt.status},
          current_stage_index = ${attempt.currentStageIndex},
          lives_remaining = ${attempt.livesRemaining},
          score = ${attempt.score},
          completion_reason = ${attempt.completionReason},
          started_at = ${attempt.startedAt},
          completed_at = ${attempt.completedAt},
          revision = ${attempt.revision}
        where id = ${attempt.id} and revision = ${expectedRevision}
        returning id`;
      if (updated.length === 0) return false;
      if (attempt.answers.length > 0) {
        const rows = attempt.answers.map((a) => ({
          attempt_id: attempt.id,
          sequence: a.sequence,
          submission_id: a.submissionId,
          stage_id: a.stageId,
          stage_position: a.stageOrder,
          option_id: a.optionId,
          is_correct: a.isCorrect,
          lives_before: a.livesBefore,
          lives_after: a.livesAfter,
          answered_at: a.answeredAt,
        }));
        // Earlier answers already exist; unique (attempt_id, sequence) and (attempt_id, submission_id) skip them.
        await tx`insert into public.attempt_answers ${tx(rows)} on conflict do nothing`;
      }
      return true;
    });
  }

  async listHistory(ownerKey: string, limit: number): Promise<AttemptHistoryItem[]> {
    const owner = parseOwnerKey(ownerKey);
    const column = owner.kind === "user" ? this.sql`a.user_id` : this.sql`a.guest_id`;
    const rows = await this.sql<
      { id: string; slug: string; title: string; status: AttemptStatus; score: number | null; lives_remaining: number; started_at: Date | null; completed_at: Date | null }[]
    >`
      select a.id, v.slug, v.title, a.status, a.score, a.lives_remaining, a.started_at, a.completed_at
      from public.attempts a
      join public.case_versions v on v.case_id = a.case_id and v.version = a.case_version
      where ${column} = ${owner.id}
      order by a.created_at desc
      limit ${limit}`;
    return rows.map((r) => ({
      attemptId: r.id,
      caseSlug: r.slug,
      caseTitle: r.title,
      status: r.status,
      score: r.score,
      livesRemaining: r.lives_remaining,
      startedAt: toIso(r.started_at),
      completedAt: toIso(r.completed_at),
    }));
  }

  private async withAnswers(row: AttemptRow): Promise<CaseAttempt> {
    const answers = await this.sql<AnswerRow[]>`
      select * from public.attempt_answers where attempt_id = ${row.id} order by sequence`;
    return {
      id: row.id,
      ownerId: row.user_id ? `user:${row.user_id}` : `guest:${row.guest_id}`,
      caseId: row.case_id,
      caseVersion: row.case_version,
      status: row.status,
      currentStageIndex: row.current_stage_index,
      livesRemaining: row.lives_remaining,
      score: row.score,
      completionReason: row.completion_reason,
      startedAt: toIso(row.started_at),
      completedAt: toIso(row.completed_at),
      revision: row.revision,
      answers: answers.map(
        (a): AnswerRecord => ({
          submissionId: a.submission_id,
          sequence: a.sequence,
          stageId: a.stage_id,
          stageOrder: a.stage_position,
          optionId: a.option_id,
          isCorrect: a.is_correct,
          livesBefore: a.lives_before,
          livesAfter: a.lives_after,
          answeredAt: toIso(a.answered_at)!,
        }),
      ),
    };
  }
}
