import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state-views";
import { STATUS_LABEL } from "@/features/admin/draft";
import { InventoryTable } from "@/features/case-manager/components/inventory-table";
import { can } from "@/lib/auth/actor";
import { PUBLICATION_STATUSES } from "@/lib/engine/types";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

export default async function CaseManagerHome() {
  const actor = await getRequestActor();
  const { counts, recentCases } = await getContainer().admin!.dashboard(actor);
  const canEdit = can(actor, "case:edit");

  return (
    <div className="grid gap-8">
      <header className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold tracking-wider text-wise-blue uppercase">Case Manager</p>
          <h1 className="text-3xl font-bold">Case Manager</h1>
          <p className="text-ink-muted">Create, edit and manage clinical cases.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Link href="/admin/cases/new" className={buttonClasses("primary")}>
              + Create case
            </Link>
          )}
          {canEdit && (
            <Link href="/admin/import" className={buttonClasses("secondary")}>
              Import JSON
            </Link>
          )}
          <a href="/api/admin/template" download className={buttonClasses("secondary")}>
            Download JSON template
          </a>
          <Link href="/admin/cases" className={buttonClasses("secondary")}>
            Case inventory
          </Link>
        </div>
      </header>

      <section aria-labelledby="counts-heading" className="grid gap-3">
        <h2 id="counts-heading" className="sr-only">
          Cases by status
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card className="grid gap-1 p-4 sm:p-4">
            <dt className="text-xs font-semibold tracking-wider text-ink-subtle uppercase">All cases</dt>
            <dd className="text-2xl font-bold tabular-nums">{counts.total}</dd>
          </Card>
          {PUBLICATION_STATUSES.map((s) => (
            <Card key={s} className="grid gap-1 p-4 sm:p-4">
              <dt className="text-xs font-semibold tracking-wider text-ink-subtle uppercase">{STATUS_LABEL[s]}</dt>
              <dd className="text-2xl font-bold tabular-nums">
                <Link href={`/admin/cases?status=${s}`} className="hover:text-wise-blue">
                  {counts[s]}
                </Link>
              </dd>
            </Card>
          ))}
        </dl>
      </section>

      <section aria-labelledby="recent-heading" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="recent-heading" className="text-xl font-semibold">
            Recently updated
          </h2>
          <Link href="/admin/cases" className="text-sm font-semibold text-wise-blue hover:underline">
            Open the full inventory →
          </Link>
        </div>
        {recentCases.length === 0 ? (
          <EmptyState title="No cases yet" message="Create a case or import one from a JSON file to get started." />
        ) : (
          <InventoryTable items={recentCases} canEdit={canEdit} canPublish={can(actor, "case:publish")} />
        )}
      </section>

      <p className="text-sm text-ink-muted">
        New and imported cases are always drafts. Learners only ever see published cases. Only a super administrator can publish.
      </p>
    </div>
  );
}
