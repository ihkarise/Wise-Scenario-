import "server-only";
import { notFound } from "next/navigation";
import { uuidSchema } from "@/lib/schemas/ids";
import { isServiceError } from "@/lib/server/service-error";

/** Validates the case ID in the URL and turns "not found" into the 404 page. */
export async function loadOr404<T>(rawId: string, load: (id: string) => Promise<T>): Promise<T> {
  if (!uuidSchema.safeParse(rawId).success) notFound();
  try {
    return await load(rawId);
  } catch (e) {
    if (isServiceError(e) && e.code === "CASE_NOT_FOUND") notFound();
    throw e;
  }
}
