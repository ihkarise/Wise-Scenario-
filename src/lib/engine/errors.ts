/**
 * Reasons the engine refuses an answer. None of them changes the attempt or costs a life.
 */
export const ENGINE_ERROR_CODES = [
  "ATTEMPT_NOT_STARTED",
  "ATTEMPT_COMPLETED",
  "STALE_STATE",
  "STAGE_MISMATCH",
  "OPTION_NOT_FOUND",
  "OPTION_NOT_IN_STAGE",
  "OPTION_ALREADY_TRIED",
  "NO_LIVES_REMAINING",
  "IDEMPOTENCY_KEY_REUSED",
  "CASE_VERSION_MISMATCH",
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export type EngineError = {
  code: EngineErrorCode;
  /** Developer-facing detail. Never shown to learners verbatim. */
  detail: string;
};

export const engineError = (code: EngineErrorCode, detail: string): EngineError => ({ code, detail });
