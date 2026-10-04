import type { PlayerView } from "@/lib/engine/view";
import type { ServiceErrorCode } from "@/lib/server/service-error";

/** Browser-side client for the play API. It sends IDs only; it never sends lives, score or correctness. */
export type ApiErrorCode = ServiceErrorCode | "NETWORK_ERROR";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ApiErrorCode; message: string };

const NETWORK_MESSAGE = "We could not reach WiseCases. Check your connection and try again.";

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR", message: NETWORK_MESSAGE };
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { code: ServiceErrorCode; message: string } }) | null;
  if (!res.ok || !body) {
    return { ok: false, code: body?.error?.code ?? "INTERNAL", message: body?.error?.message ?? "Something went wrong on our side. Please try again." };
  }
  return { ok: true, data: body };
}

export type SubmitAnswerRequest = { submissionId: string; stageId: string; optionId: string; expectedRevision: number };

export const playerApi = {
  start: (caseSlug: string) =>
    request<{ view: PlayerView }>("/api/attempts", { method: "POST", body: JSON.stringify({ caseSlug }) }),
  get: (attemptId: string) => request<{ view: PlayerView }>(`/api/attempts/${encodeURIComponent(attemptId)}`),
  submit: (attemptId: string, body: SubmitAnswerRequest) =>
    request<{ view: PlayerView; duplicate: boolean }>(`/api/attempts/${encodeURIComponent(attemptId)}/answers`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
