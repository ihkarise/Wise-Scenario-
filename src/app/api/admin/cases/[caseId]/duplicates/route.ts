import type { NextRequest } from "next/server";
import { createAdminHandlers } from "@/features/admin/http/admin-handlers";
import { getContainer } from "@/lib/server/container";

const handlers = createAdminHandlers(getContainer);
type Params = { params: Promise<{ caseId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  return handlers.duplicatesOf(request, (await params).caseId);
}
