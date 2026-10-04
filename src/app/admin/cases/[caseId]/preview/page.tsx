import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state-views";
import { loadOr404 } from "@/features/case-manager/load-case";
import { PreviewPlayer } from "@/features/case-manager/components/preview-player";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";
import { ServiceError } from "@/lib/server/service-error";

export const metadata: Metadata = { title: "Preview" };

type Params = { params: Promise<{ caseId: string }> };

export default async function PreviewPage({ params }: Params) {
  const actor = await getRequestActor();
  const { caseId } = await params;
  const admin = getContainer().admin!;
  const back = (
    <div className="flex flex-wrap gap-2">
      <Link href={`/admin/cases/${caseId}/edit`} className={buttonClasses("secondary")}>
        ← Back to editor
      </Link>
      <Link href={`/admin/cases/${caseId}`} className={buttonClasses("ghost")}>
        Case page
      </Link>
    </div>
  );

  let snapshot;
  try {
    snapshot = await loadOr404(caseId, (id) => admin.previewSnapshot(actor, id));
  } catch (e) {
    if (e instanceof ServiceError && e.code === "NOT_READY") {
      return (
        <div className="mx-auto grid max-w-2xl gap-4">
          <ErrorState title="This case cannot be previewed yet" message={e.issues.join(" ")} />
          {back}
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div role="note" className="grid gap-2 rounded-xl border-2 border-dashed border-wise-blue bg-blue-soft p-4 text-sm">
        <p className="font-bold tracking-wider text-wise-blue uppercase">Preview as learner</p>
        <p className="text-ink-muted">
          This is the last saved draft, played exactly as learners will see it. Nothing is recorded, and learners cannot see this case until it is published.
        </p>
        {back}
      </div>
      <PreviewPlayer snapshot={snapshot} />
    </div>
  );
}
