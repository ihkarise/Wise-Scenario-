import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state-views";
import { parseListQuery } from "@/features/admin/http/admin-handlers";
import { InventoryFilters } from "@/features/case-manager/components/inventory-filters";
import { InventoryTable } from "@/features/case-manager/components/inventory-table";
import { can } from "@/lib/auth/actor";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Case inventory" };

const PAGE_SIZE = 25;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const query = parseListQuery(params, PAGE_SIZE);
  const actor = await getRequestActor();
  const admin = getContainer().admin!;
  const [{ items, total }, { categories }] = await Promise.all([admin.listCases(actor, query), admin.taxonomy(actor)]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageLink = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/admin/cases?${next.toString()}`;
  };
  const canEdit = can(actor, "case:edit");

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-3xl font-bold">Case inventory</h1>
          <p className="text-ink-muted" role="status">
            {total === 1 ? "1 case" : `${total} cases`}
            {query.q ? ` matching “${query.q}”` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Link href="/admin/cases/new" className={buttonClasses("primary")}>
              + Create case
            </Link>
          )}
          <a href={`/api/admin/inventory/csv?${params.toString()}`} className={buttonClasses("secondary")}>
            Export spreadsheet (CSV)
          </a>
        </div>
      </header>

      <Suspense>
        <InventoryFilters categories={categories.map((c) => ({ id: c.id, label: `${c.name} (${c.domainName})` }))} />
      </Suspense>

      {items.length === 0 ? (
        <EmptyState title="No cases found" message={query.q || query.status || query.difficulty || query.categoryId ? "Try a different search or clear the filters." : "Create or import a case to get started."} />
      ) : (
        <InventoryTable items={items} canEdit={canEdit} canPublish={can(actor, "case:publish")} />
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-2 text-sm">
          {query.page > 1 && (
            <Link href={pageLink(query.page - 1)} className={buttonClasses("secondary")}>
              ← Previous
            </Link>
          )}
          <span className="px-2 text-ink-muted">
            Page {query.page} of {pages}
          </span>
          {query.page < pages && (
            <Link href={pageLink(query.page + 1)} className={buttonClasses("secondary")}>
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
