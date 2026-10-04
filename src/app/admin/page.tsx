import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/state-views";
import { actorFromGuestCookie, can, GUEST_COOKIE } from "@/lib/auth/actor";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/**
 * `src/proxy.ts` already answers 403 for anyone without admin access. This second server-side check
 * means the page stays protected even if the proxy matcher is changed by mistake.
 * Milestone 1 has no signed-in users, so nobody reaches the placeholder below.
 */
export default async function AdminPage() {
  const actor = actorFromGuestCookie((await cookies()).get(GUEST_COOKIE)?.value);
  if (!can(actor, "admin:access")) notFound();
  return <EmptyState title="Admin panel" message="The Case Builder arrives in Milestone 3." />;
}
