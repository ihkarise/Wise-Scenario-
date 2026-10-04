import type { EngineErrorCode } from "@/lib/engine/errors";

/**
 * Errors a learner can see. Messages are plain language and never contain database details.
 */
export const SERVICE_ERRORS = {
  INVALID_REQUEST: { status: 400, message: "The request was not valid." },
  UNAUTHORIZED: { status: 401, message: "Your session has expired. Open the case again to continue." },
  FORBIDDEN: { status: 403, message: "You do not have permission to do that." },
  CASE_UNAVAILABLE: { status: 404, message: "This case is not available." },
  ATTEMPT_NOT_FOUND: { status: 404, message: "We could not find that attempt." },
  ATTEMPT_NOT_STARTED: { status: 409, message: "Start the case before answering." },
  ATTEMPT_COMPLETED: { status: 409, message: "This case is already finished." },
  STALE_STATE: { status: 409, message: "Your answer was already received. Showing the latest state." },
  INVALID_STAGE: { status: 409, message: "That answer was for a different clue. Showing the current clue." },
  NO_LIVES_REMAINING: { status: 409, message: "No lives remain for this attempt." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Requests must be sent as JSON." },
  INVALID_ANSWER: { status: 422, message: "That answer option is not available for this clue." },
  CASE_NOT_FOUND: { status: 404, message: "We could not find that case." },
  SLUG_TAKEN: { status: 409, message: "That web address is already used by another case. Choose a different one." },
  SLUG_LOCKED: { status: 409, message: "The web address cannot be changed after a case has been published." },
  EDIT_CONFLICT: { status: 409, message: "This case was changed in another tab or by someone else. Reload to see the latest version before saving." },
  NOT_READY: { status: 422, message: "The case is not ready yet." },
  CASE_ID_TAKEN: { status: 409, message: "Another case already uses this Case ID. Choose a different Case ID." },
  DUPLICATE_CONFIRMATION_REQUIRED: { status: 409, message: "This case looks like one that already exists. Review the possible duplicates before importing." },
  INVALID_CASE_FILE: { status: 422, message: "The case file has problems. Fix them and try again." },
  DRAFT_INCOMPLETE: { status: 422, message: "Some required fields are empty. Fill them in before saving." },
  INVALID_TRANSITION: { status: 409, message: "That action is not available for this case right now." },
  INTERNAL: { status: 500, message: "Something went wrong on our side. Please try again." },
} as const;

export type ServiceErrorCode = keyof typeof SERVICE_ERRORS;

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;

  /** Plain-language items safe to show (e.g. "Clue 3 has no correct answer."). */
  readonly issues: string[];

  constructor(code: ServiceErrorCode, detail?: string, issues: string[] = []) {
    super(detail ?? SERVICE_ERRORS[code].message);
    this.name = "ServiceError";
    this.code = code;
    this.status = SERVICE_ERRORS[code].status;
    this.issues = issues;
  }

  /** The body sent to the browser: code + safe message (+ author-facing issues), never the internal detail. */
  toJSON() {
    const error: { code: ServiceErrorCode; message: string; issues?: string[] } = { code: this.code, message: SERVICE_ERRORS[this.code].message };
    if (this.issues.length > 0) error.issues = this.issues;
    return { error };
  }
}

const ENGINE_TO_SERVICE: Record<EngineErrorCode, ServiceErrorCode> = {
  ATTEMPT_NOT_STARTED: "ATTEMPT_NOT_STARTED",
  ATTEMPT_COMPLETED: "ATTEMPT_COMPLETED",
  STALE_STATE: "STALE_STATE",
  STAGE_MISMATCH: "INVALID_STAGE",
  OPTION_NOT_FOUND: "INVALID_ANSWER",
  OPTION_NOT_IN_STAGE: "INVALID_ANSWER",
  OPTION_ALREADY_TRIED: "INVALID_ANSWER",
  NO_LIVES_REMAINING: "NO_LIVES_REMAINING",
  IDEMPOTENCY_KEY_REUSED: "INVALID_REQUEST",
  CASE_VERSION_MISMATCH: "INTERNAL",
};

export function serviceErrorFromEngine(code: EngineErrorCode, detail: string): ServiceError {
  return new ServiceError(ENGINE_TO_SERVICE[code], detail);
}
