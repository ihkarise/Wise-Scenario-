import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { actorFromGuestCookie, guestActor, GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, type Actor } from "@/lib/auth/actor";
import { attemptIdSchema, startAttemptBodySchema, submitAnswerBodySchema } from "@/lib/schemas/api";
import type { Container } from "@/lib/server/container";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/server/http";
import { ServiceError } from "@/lib/server/service-error";

/**
 * HTTP layer for play. Thin by design: validate input, identify the actor from the cookie,
 * call the service, map errors. The browser may send only a case slug, an attempt ID, a stage ID,
 * an option ID, an idempotency key and the revision it saw.
 */
export function createAttemptHandlers(getContainer: () => Container) {
  const requireActor = (request: NextRequest): Actor => {
    const actor = actorFromGuestCookie(request.cookies.get(GUEST_COOKIE)?.value);
    if (!actor) throw new ServiceError("UNAUTHORIZED");
    return actor;
  };

  const parseAttemptId = (raw: string): string => {
    const parsed = attemptIdSchema.safeParse(raw);
    // A malformed ID is indistinguishable from a missing attempt.
    if (!parsed.success) throw new ServiceError("ATTEMPT_NOT_FOUND");
    return parsed.data;
  };

  return {
    /** POST /api/attempts { caseSlug } */
    async start(request: NextRequest): Promise<NextResponse> {
      try {
        const body = startAttemptBodySchema.parse(await readJsonBody(request));
        const existing = actorFromGuestCookie(request.cookies.get(GUEST_COOKIE)?.value);
        const actor = existing ?? guestActor(randomUUID());
        const view = await getContainer().attemptService.startOrResume(actor, body.caseSlug);
        const response = jsonOk({ view }, 201);
        if (!existing) {
          response.cookies.set(GUEST_COOKIE, actor.id, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: GUEST_COOKIE_MAX_AGE,
          });
        }
        return response;
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    /** GET /api/attempts/:attemptId */
    async get(request: NextRequest, rawAttemptId: string): Promise<NextResponse> {
      try {
        const actor = requireActor(request);
        const view = await getContainer().attemptService.getView(actor, parseAttemptId(rawAttemptId));
        return jsonOk({ view });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    /** POST /api/attempts/:attemptId/answers { submissionId, stageId, optionId, expectedRevision } */
    async submit(request: NextRequest, rawAttemptId: string): Promise<NextResponse> {
      try {
        const actor = requireActor(request);
        const attemptId = parseAttemptId(rawAttemptId);
        const body = submitAnswerBodySchema.parse(await readJsonBody(request));
        const result = await getContainer().attemptService.submitAnswer(actor, attemptId, body);
        return jsonOk(result);
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}
