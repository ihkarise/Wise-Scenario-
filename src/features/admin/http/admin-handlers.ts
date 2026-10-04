import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DIFFICULTIES, PUBLICATION_STATUSES } from "@/lib/engine/types";
import { uuidSchema } from "@/lib/schemas/ids";
import type { Container } from "@/lib/server/container";
import { jsonOk, MAX_CASE_BODY_BYTES, readJsonBody, toErrorResponse } from "@/lib/server/http";
import { ServiceError } from "@/lib/server/service-error";
import { CASE_SORTS, type CaseListQuery } from "../admin-repository";
import { caseActionBodySchema, createCaseBodySchema, saveDraftBodySchema } from "../draft";
import template from "../../../../data/case-template.json";

const importBodySchema = z.strictObject({ document: z.unknown(), allowDuplicates: z.boolean().default(false) });
const validateBodySchema = z.strictObject({ document: z.unknown(), exceptCaseId: uuidSchema.optional() });

/** Parses inventory filters from a query string; invalid values are ignored rather than rejected. */
export function parseListQuery(params: URLSearchParams, pageSize = 25): CaseListQuery {
  const pick = <T extends string>(value: string | null, allowed: readonly T[]) => (allowed.includes(value as T) ? (value as T) : undefined);
  const uuid = (v: string | null) => (v && uuidSchema.safeParse(v).success ? v : undefined);
  const page = Number(params.get("page"));
  return {
    q: params.get("q")?.slice(0, 100) || undefined,
    status: pick(params.get("status"), PUBLICATION_STATUSES),
    difficulty: pick(params.get("difficulty"), DIFFICULTIES),
    categoryId: uuid(params.get("category")),
    domainId: uuid(params.get("domain")),
    sort: pick(params.get("sort"), CASE_SORTS) ?? "updated_desc",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
    pageSize,
  };
}

const download = (body: string, fileName: string, type: string) =>
  new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });

/** Spreadsheet-safe CSV cell (also blocks formula injection when opened in Excel). */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** HTTP layer for authoring. Authorization happens in AdminCaseService and again in the database. */
export function createAdminHandlers(getContainer: () => Container) {
  const context = async (request: NextRequest) => {
    const container = getContainer();
    if (!container.admin) throw new ServiceError("FORBIDDEN", "Authoring unavailable");
    const actor = await container.identity.resolve(request.cookies);
    return { admin: container.admin, actor };
  };
  const id = (raw: string) => {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success) throw new ServiceError("CASE_NOT_FOUND");
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
        const parsed = saveDraftBodySchema.safeParse(await readJsonBody(request, MAX_CASE_BODY_BYTES));
        if (!parsed.success) {
          throw new ServiceError("INVALID_REQUEST", "Invalid draft", parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(" › ")}: ${i.message}`));
        }
        return jsonOk(await admin.saveDraft(actor, id(caseId), parsed.data.content, parsed.data.expectedRevision));
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

    duplicatesOf: (request: NextRequest, caseId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        return jsonOk({ duplicates: await admin.duplicatesOf(actor, id(caseId)) });
      }),

    exportCase: (request: NextRequest, caseId: string) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const { fileName, document } = await admin.exportCase(actor, id(caseId));
        return download(`${JSON.stringify(document, null, 2)}\n`, fileName, "application/json");
      }),

    validateImport: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = validateBodySchema.parse(await readJsonBody(request, MAX_CASE_BODY_BYTES));
        return jsonOk(await admin.validateDocument(actor, body.document, body.exceptCaseId));
      }),

    importCase: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const body = importBodySchema.parse(await readJsonBody(request, MAX_CASE_BODY_BYTES));
        return jsonOk(await admin.importDocument(actor, body.document, { allowDuplicates: body.allowDuplicates }), 201);
      }),

    template: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        admin.assertAccess(actor);
        return download(`${JSON.stringify(template, null, 2)}\n`, "wisecases-case-template.json", "application/json");
      }),

    conditions: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const params = request.nextUrl.searchParams;
        const limit = Math.min(Math.max(Number(params.get("limit")) || 8, 1), 20);
        return jsonOk({ items: await admin.searchConditions(actor, params.get("q") ?? "", limit) });
      }),

    inventoryCsv: (request: NextRequest) =>
      handle(async () => {
        const { admin, actor } = await context(request);
        const query = parseListQuery(request.nextUrl.searchParams, 5000);
        const { items } = await admin.listCases(actor, { ...query, page: 1 }, 5000);
        const header = ["Case ID", "Title", "Domain", "Category", "Subcategory", "Difficulty", "Stages", "Lives", "Status", "Published version", "Unpublished changes", "Last updated"];
        const rows = items.map((c) => [
          c.caseCode,
          c.title,
          c.domain,
          c.category,
          c.subcategory,
          c.difficulty,
          c.stageCount,
          c.maxLives,
          c.status,
          c.publishedVersion,
          c.hasUnpublishedChanges ? "yes" : "no",
          c.updatedAt,
        ]);
        const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
        return download(`﻿${csv}\r\n`, `wisecases-inventory-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
      }),
  };
}
