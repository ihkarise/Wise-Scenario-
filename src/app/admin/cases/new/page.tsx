import type { Metadata } from "next";
import { ErrorState } from "@/components/ui/state-views";
import { DEFAULT_DOMAIN_NAME } from "@/features/admin/draft";
import { CreateCaseForm } from "@/features/case-manager/components/create-case-form";
import { can } from "@/lib/auth/actor";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Create case" };

export default async function NewCasePage() {
  const actor = await getRequestActor();
  if (!can(actor, "case:edit")) return <ErrorState title="Editors only" message="Your role can view cases but not create them." />;
  const { domains, categories } = await getContainer().admin!.taxonomy(actor);
  const active = domains.filter((d) => d.isActive);
  if (active.length === 0) return <ErrorState title="No domains yet" message="Add a domain (for example “Medical Diagnosis”) before creating cases." />;
  const defaultDomain = active.find((d) => d.name === DEFAULT_DOMAIN_NAME) ?? active[0]!;
  return (
    <div className="grid max-w-3xl gap-5">
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold">Create case</h1>
        <p className="text-ink-muted">Start with the basics. You will add stages, the diagnosis and teaching in the editor.</p>
      </header>
      <CreateCaseForm
        domains={active.map((d) => ({ id: d.id, name: d.name }))}
        categories={categories.filter((c) => c.isActive).map((c) => ({ domainId: c.domainId, name: c.name }))}
        defaultDomainId={defaultDomain.id}
        canAddCategory={can(actor, "taxonomy:manage")}
      />
    </div>
  );
}
