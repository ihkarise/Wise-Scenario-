import "server-only";
import { randomUUID } from "node:crypto";
import type { CaseDefinition } from "@/lib/engine/types";
import { createSql, ConfigurationError, type Sql } from "@/lib/db/client";
import { assertSessionSecret } from "@/lib/auth/guest-cookie";
import { IdentityResolver, type AuthGateway, type RoleSource } from "@/lib/auth/identity";
import { PostgresRoleSource } from "@/lib/auth/postgres-role-source";
import { noAuthGateway, SupabaseAuthGateway, supabasePublicConfig } from "@/lib/auth/supabase";
import { DEMO_CASES } from "@/features/cases/demo/demo-cases";
import type { CaseRepository } from "@/features/cases/case-repository";
import { MemoryCaseRepository } from "@/features/cases/memory-case-repository";
import { PostgresCaseRepository } from "@/features/cases/postgres-case-repository";
import type { AttemptRepository } from "@/features/attempts/attempt-repository";
import { MemoryAttemptRepository } from "@/features/attempts/memory-attempt-repository";
import { PostgresAttemptRepository } from "@/features/attempts/postgres-attempt-repository";
import { AttemptService } from "@/features/attempts/attempt-service";
import { AdminCaseService } from "@/features/admin/admin-case-service";
import { PostgresAdminRepository } from "@/features/admin/postgres-admin-repository";

/** Server-side wiring. The only place that chooses concrete implementations. */
export type Container = {
  cases: CaseRepository;
  attempts: AttemptRepository;
  attemptService: AttemptService;
  identity: IdentityResolver;
  /** Null when authoring is unavailable (unit-test memory containers). */
  admin: AdminCaseService | null;
};

type Common = { clock?: () => Date; newId?: () => string; auth?: AuthGateway; roles?: RoleSource; sessionSecret?: string };

const TEST_SECRET = "test-session-secret-at-least-32-characters";

export function createPostgresContainer(options: Common & { sql: Sql; sessionSecret: string }): Container {
  const clock = options.clock ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const cases = new PostgresCaseRepository(options.sql);
  const attempts = new PostgresAttemptRepository(options.sql);
  return {
    cases,
    attempts,
    attemptService: new AttemptService({ cases, attempts, clock, newId }),
    identity: new IdentityResolver(options.auth ?? noAuthGateway, options.roles ?? new PostgresRoleSource(options.sql), options.sessionSecret),
    admin: new AdminCaseService({ repo: new PostgresAdminRepository(options.sql), newId, clock }),
  };
}

/** In-memory container for unit tests: demo content, no authoring. */
export function createMemoryContainer(options: Common & { cases?: readonly CaseDefinition[] } = {}): Container {
  const cases = new MemoryCaseRepository(options.cases ?? DEMO_CASES);
  const attempts = new MemoryAttemptRepository();
  return {
    cases,
    attempts,
    attemptService: new AttemptService({ cases, attempts, clock: options.clock ?? (() => new Date()), newId: options.newId ?? randomUUID }),
    identity: new IdentityResolver(options.auth ?? noAuthGateway, options.roles ?? { rolesFor: async () => [] }, options.sessionSecret ?? TEST_SECRET),
    admin: null,
  };
}

const globalForContainer = globalThis as unknown as { __wisecasesContainer?: Container };

export function getContainer(): Container {
  if (!globalForContainer.__wisecasesContainer) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new ConfigurationError("DATABASE_URL is not set. See .env.example and docs/DATABASE.md.");
    const supabase = supabasePublicConfig();
    globalForContainer.__wisecasesContainer = createPostgresContainer({
      sql: createSql(url),
      sessionSecret: assertSessionSecret(process.env.WISECASES_SESSION_SECRET),
      auth: supabase ? new SupabaseAuthGateway(supabase) : noAuthGateway,
    });
  }
  return globalForContainer.__wisecasesContainer;
}
