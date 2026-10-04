import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GUEST_COOKIE } from "@/lib/auth/actor";
import type { PlayerView } from "@/lib/engine";
import { createMemoryContainer } from "@/lib/server/container";
import { fixtureCase, NOW } from "../../../../tests/support/fixtures";
import { createAttemptHandlers } from "./attempt-handlers";

const ORIGIN = "http://localhost:3000";
const published = fixtureCase({ stages: 4, maxLives: 3 });
const draft = { ...fixtureCase({ id: "draft-case" }), publicationStatus: "DRAFT" as const };

function setup() {
  const container = createMemoryContainer({ cases: [published, draft], clock: () => NOW });
  return createAttemptHandlers(() => container);
}

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = `${GUEST_COOKIE}=${init.cookie}`;
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

async function start(handlers: ReturnType<typeof setup>) {
  const res = await handlers.start(req("/api/attempts", { body: { caseSlug: published.slug } }));
  const cookie = res.cookies.get(GUEST_COOKIE)?.value;
  const { view } = (await res.json()) as { view: PlayerView };
  return { res, cookie: cookie!, view };
}

function wrongFor(view: PlayerView) {
  const stage = published.stages.find((s) => s.id === view.current!.stageId)!;
  return stage.interaction.options.find((o) => !o.isCorrect)!;
}

describe("attempt HTTP handlers", () => {
  it("starts an attempt, sets an httpOnly guest cookie and returns only the current stage", async () => {
    const handlers = setup();
    const { res, cookie, view } = await start(handlers);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(cookie).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(view.current?.order).toBe(1);
    const json = JSON.stringify(view);
    expect(json).not.toContain("isCorrect");
    expect(json).not.toContain(published.stages[1]!.content);
  });

  it("unauthenticated access to an unpublished case returns 404 without details", async () => {
    const handlers = setup();
    const res = await handlers.start(req("/api/attempts", { body: { caseSlug: draft.slug } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "CASE_UNAVAILABLE", message: "This case is not available." } });
  });

  it("rejects attempts by the client to set lives, score, correctness, completion or stage", async () => {
    const handlers = setup();
    const { cookie, view } = await start(handlers);
    const option = wrongFor(view);
    const base = { submissionId: crypto.randomUUID(), stageId: view.current!.stageId, optionId: option.id, expectedRevision: view.revision };
    for (const tamper of [
      { livesRemaining: 99 },
      { score: 100000 },
      { isCorrect: true },
      { completed: true },
      { currentStage: 4 },
      { status: "COMPLETED_SUCCESS" },
    ]) {
      const res = await handlers.submit(req(`/api/attempts/${view.attemptId}/answers`, { cookie, body: { ...base, ...tamper } }), view.attemptId);
      expect(res.status).toBe(400);
    }
    // Nothing changed.
    const current = await handlers.get(req(`/api/attempts/${view.attemptId}`, { cookie }), view.attemptId);
    expect(((await current.json()) as { view: PlayerView }).view.livesRemaining).toBe(3);
  });

  it("server decides correctness: a wrong option costs a life even if the client claims otherwise", async () => {
    const handlers = setup();
    const { cookie, view } = await start(handlers);
    const res = await handlers.submit(
      req(`/api/attempts/${view.attemptId}/answers`, {
        cookie,
        body: { submissionId: crypto.randomUUID(), stageId: view.current!.stageId, optionId: wrongFor(view).id, expectedRevision: view.revision },
      }),
      view.attemptId,
    );
    const body = (await res.json()) as { view: PlayerView; duplicate: boolean };
    expect(res.status).toBe(200);
    expect(body.view).toMatchObject({ livesRemaining: 2, currentStageOrder: 2 });
    expect(body.duplicate).toBe(false);
  });

  it("another learner's cookie cannot read or answer the attempt", async () => {
    const handlers = setup();
    const { view } = await start(handlers);
    const otherCookie = "33333333-3333-4333-8333-333333333333";
    expect((await handlers.get(req(`/api/attempts/${view.attemptId}`, { cookie: otherCookie }), view.attemptId)).status).toBe(404);
    const res = await handlers.submit(
      req(`/api/attempts/${view.attemptId}/answers`, {
        cookie: otherCookie,
        body: { submissionId: crypto.randomUUID(), stageId: view.current!.stageId, optionId: wrongFor(view).id, expectedRevision: view.revision },
      }),
      view.attemptId,
    );
    expect(res.status).toBe(404);
  });

  it("requires a session, JSON, a same-origin request and a well-formed attempt ID", async () => {
    const handlers = setup();
    const { cookie, view } = await start(handlers);
    const path = `/api/attempts/${view.attemptId}/answers`;
    const body = { submissionId: crypto.randomUUID(), stageId: view.current!.stageId, optionId: wrongFor(view).id, expectedRevision: view.revision };

    expect((await handlers.submit(req(path, { body }), view.attemptId)).status).toBe(401);
    expect((await handlers.submit(req(path, { cookie, body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } }), view.attemptId)).status).toBe(415);
    expect((await handlers.submit(req(path, { cookie, body, headers: { "content-type": "application/json", origin: "https://evil.example" } }), view.attemptId)).status).toBe(403);
    expect((await handlers.submit(req(path, { cookie, body: "{not json" }), view.attemptId)).status).toBe(400);
    expect((await handlers.get(req("/api/attempts/not-a-uuid", { cookie }), "not-a-uuid")).status).toBe(404);
  });

  it("maps engine rejections to safe messages without internal detail", async () => {
    const handlers = setup();
    const { cookie, view } = await start(handlers);
    const res = await handlers.submit(
      req(`/api/attempts/${view.attemptId}/answers`, {
        cookie,
        body: { submissionId: crypto.randomUUID(), stageId: view.current!.stageId, optionId: "made-up-option", expectedRevision: view.revision },
      }),
      view.attemptId,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "INVALID_ANSWER", message: "That answer option is not available for this clue." } });
  });
});
