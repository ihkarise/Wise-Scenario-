import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { attemptIdSchema, startAttemptBodySchema, submitAnswerBodySchema } from "@/lib/schemas/api";
import type { Container } from "@/lib/server/container";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/server/http";
import { ServiceError } from "@/lib/server/service-error";

/**
 * HTTP layer for play. Thin by design: validate input, identify the actor (Supabase session or signed
 * guest cookie), call the service, map errors. The browser may send only a case slug, an attempt ID,
 * a stage ID, an option ID, an idempotency key and the revision it saw.
 */
export function createAttemptHandlers(getContainer: () => Container) {
  const requireActor = async (request: NextRequest) => {
    const actor = await getContainer().identity.resolve(request.cookies);
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
        const container = getContainer();
        const existing = await container.identity.resolve(request.cookies);
        const guest = existing ? null : container.identity.newGuest();
        const actor = existing ?? guest!.actor;
        const view = await container.attemptService.startOrResume(actor, body.caseSlug);
        const response = jsonOk({ view }, 201);
        if (guest) response.cookies.set(guest.cookie.name, guest.cookie.value, guest.cookie.options);
        return response;
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    /** GET /api/attempts/:attemptId */
    async get(request: NextRequest, rawAttemptId: string): Promise<NextResponse> {
      try {
        const actor = await requireActor(request);
        const view = await getContainer().attemptService.getView(actor, parseAttemptId(rawAttemptId));
        return jsonOk({ view });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    /** POST /api/attempts/:attemptId/answers { submissionId, stageId, optionId, expectedRevision } */
    async submit(request: NextRequest, rawAttemptId: string): Promise<NextResponse> {
      try {
        const actor = await requireActor(request);
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
