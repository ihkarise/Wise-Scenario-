import type { NextRequest } from "next/server";
import { createAttemptHandlers } from "@/features/attempts/http/attempt-handlers";
import { getContainer } from "@/lib/server/container";

const handlers = createAttemptHandlers(getContainer);

export async function GET(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return handlers.get(request, attemptId);
}
