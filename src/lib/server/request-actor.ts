import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Actor } from "@/lib/auth/actor";
import { getContainer } from "./container";

/** The actor for the current server-component request (memoised per request). */
export const getRequestActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  return getContainer().identity.resolve(store);
});
