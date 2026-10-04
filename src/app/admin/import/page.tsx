import type { Metadata } from "next";
import { ErrorState } from "@/components/ui/state-views";
import { ImportWizard } from "@/features/case-manager/components/import-wizard";
import { can } from "@/lib/auth/actor";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Import JSON" };

export default async function ImportPage() {
  const actor = await getRequestActor();
  if (!can(actor, "case:edit")) return <ErrorState title="Editors only" message="Your role can view cases but not import them." />;
  return (
    <div className="grid max-w-3xl gap-5">
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold">Import JSON</h1>
        <p className="text-ink-muted">
          Add a case from a JSON file. It is checked before anything is saved, and existing cases are never overwritten.{" "}
          <a href="/api/admin/template" download className="font-semibold text-wise-blue hover:underline">
            Download the JSON template
          </a>
          .
        </p>
      </header>
      <ImportWizard />
    </div>
  );
}
