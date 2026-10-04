import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/ui/state-views";
import { AdminNav } from "@/features/case-manager/components/admin-nav";
import { isStaff } from "@/lib/auth/actor";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: { default: "Case Manager", template: "%s · Case Manager · WiseCases" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Signed-out visitors never reach admin pages (src/proxy.ts redirects them). Signed-in non-staff are
 * refused here, on the server, using roles loaded from the database. Every page and API call checks
 * permissions again in AdminCaseService, and the database checks them a third time (RLS).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await getRequestActor();
  if (!isStaff(actor)) {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState title="Administrators only" message="Your account does not have access to the admin area." />
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <AdminNav />
      {children}
    </div>
  );
}
