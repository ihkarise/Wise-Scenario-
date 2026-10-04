import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state-views";
import { SearchBox } from "@/features/case-manager/components/search-box";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Conditions" };

const PAGE_SIZE = 50;

export default async function ConditionsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = "", page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const actor = await getRequestActor();
  const { items, total, inventoryCount } = await getContainer().admin!.conditionInventory(actor, q, page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold">Condition inventory</h1>
        <p className="text-ink-muted">
          {inventoryCount} conditions: a starter terminology list plus every diagnosis and differential already written in your medical cases. Used for diagnosis
          autocomplete in the editor. Staff only; learners never see it.
        </p>
      </header>
      <div className="max-w-md">
        <Suspense>
          <SearchBox id="condition-search" label="Search conditions" placeholder="Name, abbreviation, keyword, specialty…" />
        </Suspense>
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {q ? `${total} best matches for “${q}”` : `${total} conditions`}
      </p>
      {items.length === 0 ? (
        <EmptyState title="No matching conditions" message="Try a shorter word or an abbreviation." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-canvas text-xs tracking-wider text-ink-subtle uppercase">
              <tr>
                {["Condition", "Aliases", "Keywords", "Specialty", "Category", "Source"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.name} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-2 font-semibold">
                    {c.name}
                  </th>
                  <td className="px-3 py-2">{c.aliases.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.keywords.join(", ") || "—"}</td>
                  <td className="px-3 py-2">{c.specialty || "—"}</td>
                  <td className="px-3 py-2">{c.category || "—"}</td>
                  <td className="px-3 py-2">{c.source === "cases" ? <Badge tone="blue">From cases</Badge> : <Badge>Starter list</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link className={buttonClasses("secondary")} href={`/admin/conditions?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`}>
              ← Previous
            </Link>
          )}
          <span className="px-2 text-ink-muted">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className={buttonClasses("secondary")} href={`/admin/conditions?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`}>
              Next →
            </Link>
          )}
        </nav>
      )}
      <p className="text-sm text-ink-muted">
        Adding and editing conditions directly will need a small database table; until then, the starter list lives in <code>data/conditions.json</code> and names
        written in cases are added automatically.
      </p>
    </div>
  );
}
