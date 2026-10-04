import type { NextRequest } from "next/server";
import { createAttemptHandlers } from "@/features/attempts/http/attempt-handlers";
import { getContainer } from "@/lib/server/container";

const handlers = createAttemptHandlers(getContainer);

export async function POST(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return handlers.submit(request, attemptId);
}
