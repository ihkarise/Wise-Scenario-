import type { ServiceErrorCode } from "@/lib/server/service-error";

/** Browser-side calls to the Case Manager API. Authorization is always decided by the server. */
export type AdminResult<T> = { ok: true; data: T } | { ok: false; code: ServiceErrorCode | "NETWORK_ERROR"; message: string; issues: string[] };

export async function adminRequest<T>(url: string, init?: { method?: string; body?: unknown }): Promise<AdminResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { Accept: "application/json", ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR", message: "We could not reach WiseCases. Check your connection and try again.", issues: [] };
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { code: ServiceErrorCode; message: string; issues?: string[] } }) | null;
  if (!res.ok || !body) {
    return {
      ok: false,
      code: body?.error?.code ?? "INTERNAL",
      message: body?.error?.message ?? "Something went wrong on our side. Please try again.",
      issues: body?.error?.issues ?? [],
    };
  }
  return { ok: true, data: body };
}
