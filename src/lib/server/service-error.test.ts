import { describe, expect, it, vi } from "vitest";

/**
 * In production, Next.js bundles pages and route handlers separately, so service-error.ts can be loaded
 * twice. Errors from one copy must still be recognised by the other (they used to become HTTP 500).
 */
async function twoCopies() {
  const http = await import("./http");
  const local = await import("./service-error");
  vi.resetModules();
  const other = await import("./service-error"); // a second, separate copy of the module
  return { http, local, other };
}

describe("expected errors keep their status across module copies", () => {
  it("the second copy really is a different class (the original failure condition)", async () => {
    const { local, other } = await twoCopies();
    expect(other.ServiceError).not.toBe(local.ServiceError);
    expect(new other.ServiceError("STALE_STATE") instanceof local.ServiceError).toBe(false);
    expect(local.isServiceError(new other.ServiceError("STALE_STATE"))).toBe(true);
  });

  it.each([
    ["STALE_STATE", 409],
    ["FORBIDDEN", 403],
    ["UNAUTHORIZED", 401],
    ["INVALID_CASE_FILE", 422],
    ["DRAFT_INCOMPLETE", 422],
    ["CASE_NOT_FOUND", 404],
  ] as const)("%s from the other copy → %i with its safe message and issues", async (code, status) => {
    const { http, other } = await twoCopies();
    const res = http.toErrorResponse(new other.ServiceError(code, "internal detail", ["Stage 3 needs clue text."]));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toEqual({ error: { code, message: other.SERVICE_ERRORS[code].message, issues: ["Stage 3 needs clue text."] } });
    expect(JSON.stringify(body)).not.toContain("internal detail");
  });

  it("unexpected errors are still a generic 500 that reveals nothing", async () => {
    const { http } = await twoCopies();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const thrown of [
      new Error("connection to db.secret-host failed"),
      { code: "STALE_STATE", status: 409, message: "look-alike without the brand" },
      Object.assign(new Error("x"), { [Symbol.for("wisecases.ServiceError")]: true, code: "NOT_A_REAL_CODE" }),
      "a string",
      null,
    ]) {
      const res = http.toErrorResponse(thrown);
      expect(res.status).toBe(500);
      const body = JSON.stringify(await res.json());
      expect(body).toContain("INTERNAL");
      expect(body).not.toMatch(/secret-host|look-alike|NOT_A_REAL_CODE/);
    }
    spy.mockRestore();
  });
});
