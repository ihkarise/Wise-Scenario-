import type { NextRequest } from "next/server";
import { createAttemptHandlers } from "@/features/attempts/http/attempt-handlers";
import { getContainer } from "@/lib/server/container";

const handlers = createAttemptHandlers(getContainer);

export function POST(request: NextRequest) {
  return handlers.start(request);
}
