import type { Metadata } from "next";
import { ErrorState } from "@/components/ui/state-views";
import { CaseEditor } from "@/features/case-manager/components/editor/case-editor";
import { loadOr404 } from "@/features/case-manager/load-case";
import { can } from "@/lib/auth/actor";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Edit case" };

type Params = { params: Promise<{ caseId: string }> };

export default async function EditCasePage({ params }: Params) {
  const actor = await getRequestActor();
  if (!can(actor, "case:edit")) return <ErrorState title="Editors only" message="Your role can view cases but not edit them." />;
  const admin = getContainer().admin!;
  const { caseId } = await params;
  const [draft, { domains, categories }] = await Promise.all([loadOr404(caseId, (id) => admin.getDraft(actor, id)), admin.taxonomy(actor)]);
  return (
    <CaseEditor
      key={draft.id}
      initialDraft={draft}
      domains={domains.filter((d) => d.isActive || d.id === draft.domainId).map((d) => ({ id: d.id, name: d.name }))}
      categories={categories.filter((c) => c.isActive).map((c) => ({ domainId: c.domainId, name: c.name }))}
      canAddCategory={can(actor, "taxonomy:manage")}
    />
  );
}
