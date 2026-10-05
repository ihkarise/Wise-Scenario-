import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { isServiceError, ServiceError } from "./service-error";

const MAX_BODY_BYTES = 8 * 1024;
/** Case files and full drafts (authoring only). */
export const MAX_CASE_BODY_BYTES = 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function jsonError(error: ServiceError): NextResponse {
  return NextResponse.json(error.toJSON(), { status: error.status, headers: NO_STORE });
}

/** Converts any thrown value into a safe response. Unknown errors are logged, never echoed. */
export function toErrorResponse(error: unknown): NextResponse {
  if (isServiceError(error)) return jsonError(error);
  if (error instanceof ZodError) return jsonError(new ServiceError("INVALID_REQUEST"));
  console.error("[wisecases] unexpected error", error);
  return jsonError(new ServiceError("INTERNAL"));
}

/**
 * Reads a JSON body from a state-changing request.
 * CSRF defence: JSON content type is required (a cross-site HTML form cannot send it without a CORS
 * preflight, which we never allow), and a present Origin header must match this site.
 */
export async function readJsonBody(request: NextRequest, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) throw new ServiceError("FORBIDDEN", "Cross-origin request");

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new ServiceError("UNSUPPORTED_MEDIA_TYPE");

  const raw = await request.text();
  if (raw.length > maxBytes) throw new ServiceError("INVALID_REQUEST", "Body too large", [`The file is too large (limit ${Math.round(maxBytes / 1024)} KB).`]);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ServiceError("INVALID_REQUEST", "Malformed JSON");
  }
}
