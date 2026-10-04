import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitAnswerBodySchema } from "@/lib/schemas/api";
import { slugSchema, uuidSchema } from "@/lib/schemas/ids";
import type { Container } from "@/lib/server/container";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/server/http";
import { ServiceError } from "@/lib/server/service-error";
import { caseActionBodySchema, createCaseBodySchema, saveDraftBodySchema } from "../draft";

const domainBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
  domainType: z.enum(["medical", "materia_medica", "repertory", "general"]),
});
const categoryBodySchema = z.strictObject({ domainId: uuidSchema, name: z.string().trim().min(1).max(80), slug: slugSchema });

/** HTTP layer for authoring. Authorization happens in AdminCaseService and again in the database. */
export function createAdminHandlers(getContainer: () => Container) {
  const context = async (request: NextRequest) => {
    const container = getContainer();
    if (!container.admin) throw new ServiceError("FORBIDDEN", "Authoring unavailable");
    const actor = await container.identity.resolve(request.cookies);
    return { admin: container.admin, actor };
  };
  const id = (raw: string, notFound: "CASE_NOT_FOUND" | "ATTEMPT_NOT_FOUND" = "CASE_NOT_FOUND") => {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success) throw new ServiceError(notFound);
    return parsed.data;
  };
  const handle = (fn: () => Promise<NextResponse>) => fn().catch(toErrorResponse);

  return {
    createCase: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = createCaseBodySchema.parse(await readJsonBody(request));
        return jsonOk({ caseId: await admin.createCase(actor, body) }, 201);
      }),

    saveDraft: (request: NextRequest, caseId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = saveDraftBodySchema.parse(await readJsonBody(request));
        return jsonOk(await admin.saveDraft(actor, id(caseId), body.content, body.expectedRevision));
      }),

    duplicate: (request: NextRequest, caseId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        await readJsonBody(request);
        return jsonOk({ caseId: await admin.duplicate(actor, id(caseId)) }, 201);
      }),

    action: (request: NextRequest, caseId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = caseActionBodySchema.parse(await readJsonBody(request));
        return jsonOk(await admin.applyAction(actor, id(caseId), body.action));
      }),

    startPreview: (request: NextRequest, caseId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        await readJsonBody(request);
        return jsonOk({ view: await admin.startPreview(actor, id(caseId)) }, 201);
      }),

    getPreview: (request: NextRequest, sessionId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        return jsonOk({ view: await admin.getPreview(actor, id(sessionId, "ATTEMPT_NOT_FOUND")) });
      }),

    submitPreview: (request: NextRequest, sessionId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = submitAnswerBodySchema.parse(await readJsonBody(request));
        return jsonOk(await admin.submitPreviewAnswer(actor, id(sessionId, "ATTEMPT_NOT_FOUND"), body));
      }),

    createDomain: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = domainBodySchema.parse(await readJsonBody(request));
        return jsonOk({ id: await admin.createDomain(actor, body) }, 201);
      }),

    createCategory: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = categoryBodySchema.parse(await readJsonBody(request));
        return jsonOk({ id: await admin.createCategory(actor, body) }, 201);
      }),
  };
}
