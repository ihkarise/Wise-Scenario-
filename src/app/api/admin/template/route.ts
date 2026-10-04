import type { NextRequest } from "next/server";
import { createAdminHandlers } from "@/features/admin/http/admin-handlers";
import { getContainer } from "@/lib/server/container";

const handlers = createAdminHandlers(getContainer);

export function GET(request: NextRequest) {
  return handlers.template(request);
}
