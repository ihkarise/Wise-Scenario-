import type { Metadata } from "next";
import { EmptyState, ErrorState } from "@/components/ui/state-views";
import { isStaff } from "@/lib/auth/actor";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/**
 * Signed-out visitors never reach this page (src/proxy.ts redirects them). Signed-in non-staff are
 * refused here, on the server, using roles loaded from the database.
 * The Case Builder is built after the Supabase foundation is verified.
 */
export default async function AdminPage() {
  const actor = await getRequestActor();
  if (!isStaff(actor)) {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState title="Administrators only" message="Your account does not have access to the admin area." />
      </div>
    );
  }
  return <EmptyState title="Admin panel" message="The Case Builder arrives after the Supabase foundation is verified." />;
}
