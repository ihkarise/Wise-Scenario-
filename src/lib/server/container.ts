import "server-only";
import { randomUUID } from "node:crypto";
import type { CaseDefinition } from "@/lib/engine/types";
import { DEMO_CASES } from "@/features/cases/demo/demo-cases";
import type { CaseRepository } from "@/features/cases/case-repository";
import { MemoryCaseRepository } from "@/features/cases/memory-case-repository";
import type { AttemptRepository } from "@/features/attempts/attempt-repository";
import { MemoryAttemptRepository } from "@/features/attempts/memory-attempt-repository";
import { AttemptService } from "@/features/attempts/attempt-service";

/** Server-side wiring. The only place that chooses concrete repository implementations. */
export type Container = {
  cases: CaseRepository;
  attempts: AttemptRepository;
  attemptService: AttemptService;
};

export type MemoryContainerOptions = {
  cases?: readonly CaseDefinition[];
  clock?: () => Date;
  newId?: () => string;
};

export function createMemoryContainer(options: MemoryContainerOptions = {}): Container {
  const cases = new MemoryCaseRepository(options.cases ?? DEMO_CASES);
  const attempts = new MemoryAttemptRepository();
  const attemptService = new AttemptService({
    cases,
    attempts,
    clock: options.clock ?? (() => new Date()),
    newId: options.newId ?? randomUUID,
  });
  return { cases, attempts, attemptService };
}

const globalForContainer = globalThis as unknown as { __wisecasesContainer?: Container };

export function getContainer(): Container {
  if (!globalForContainer.__wisecasesContainer) {
    const source = process.env.WISECASES_DATA_SOURCE ?? "memory";
    if (source !== "memory") {
      throw new Error(`WISECASES_DATA_SOURCE="${source}" is not available yet. Supabase repositories arrive in Milestone 2.`);
    }
    globalForContainer.__wisecasesContainer = createMemoryContainer();
  }
  return globalForContainer.__wisecasesContainer;
}
