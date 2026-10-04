import Link from "next/link";
import type { CaseListItem } from "@/features/admin/admin-repository";
import { DIFFICULTY_LABEL } from "@/features/player/labels";
import { CaseActions } from "./case-actions";
import { StatusBadge } from "./status-badge";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const when = (iso: string) => dateFormat.format(new Date(iso));
const link = "font-semibold text-wise-blue hover:underline";

function RowLinks({ c, withExport = true }: { c: CaseListItem; withExport?: boolean }) {
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-sm">
      <Link href={`/admin/cases/${c.id}`} className={link}>
        View
      </Link>
      <Link href={`/admin/cases/${c.id}/edit`} className={link}>
        Edit
      </Link>
      <Link href={`/admin/cases/${c.id}/preview`} className={link}>
        Preview
      </Link>
      {withExport && (
        <a href={`/api/admin/cases/${c.id}/export`} className={link}>
          Export JSON
        </a>
      )}
    </span>
  );
}

/** One page of the inventory. Never renders more rows than the server returned for the page. */
export function InventoryTable({ items, canEdit, canPublish }: { items: CaseListItem[]; canEdit: boolean; canPublish: boolean }) {
  return (
    <>
      <div className="hidden rounded-2xl border border-line bg-surface lg:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            {["9%", "19%", "13%", "11%", "6%", "11%", "6%", "11%", "14%"].map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead className="bg-canvas text-xs tracking-wider text-ink-subtle uppercase">
            <tr>
              {["Case ID", "Title", "Category", "Difficulty", "Stages", "Status", "Version", "Updated", "Actions"].map((h) => (
                <th key={h} scope="col" className="px-2 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t border-line align-top">
                <td className="px-2 py-3 font-mono text-xs break-all">{c.caseCode}</td>
                <th scope="row" className="px-2 py-3 font-semibold">
                  <Link href={`/admin/cases/${c.id}`} className="hover:text-wise-blue">
                    {c.title}
                  </Link>
                </th>
                <td className="px-2 py-3">
                  {c.category ?? "—"}
                  {c.subcategory && <span className="block text-xs text-ink-muted">{c.subcategory}</span>}
                </td>
                <td className="px-2 py-3">{DIFFICULTY_LABEL[c.difficulty]}</td>
                <td className="px-2 py-3 tabular-nums">{c.stageCount}</td>
                <td className="px-2 py-3">
                  <StatusBadge status={c.status} changed={c.hasUnpublishedChanges} />
                </td>
                <td className="px-2 py-3 tabular-nums">{c.publishedVersion ? `v${c.publishedVersion}` : "—"}</td>
                <td className="px-2 py-3 text-xs text-ink-muted">
                  <time dateTime={c.updatedAt}>{when(c.updatedAt)}</time>
                </td>
                <td className="px-2 py-3">
                  <div className="grid gap-1">
                    <RowLinks c={c} withExport={false} />
                    <details className="relative">
                      <summary className="cursor-pointer list-none text-sm font-semibold text-wise-blue hover:underline [&::-webkit-details-marker]:hidden">More ▾</summary>
                      <div className="absolute right-0 z-20 mt-1 grid w-64 gap-2 rounded-xl border border-line-strong bg-surface p-3 shadow-lg">
                        <a href={`/api/admin/cases/${c.id}/export`} className={link}>
                          Export JSON
                        </a>
                        <CaseActions compact caseId={c.id} title={c.title} status={c.status} hasUnpublishedChanges={c.hasUnpublishedChanges} canEdit={canEdit} canPublish={canPublish} />
                      </div>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-3 lg:hidden">
        {items.map((c) => (
          <li key={c.id} className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <span className="font-mono">{c.caseCode}</span>
              <StatusBadge status={c.status} changed={c.hasUnpublishedChanges} />
              {c.publishedVersion && <span>v{c.publishedVersion}</span>}
            </div>
            <Link href={`/admin/cases/${c.id}`} className="font-semibold hover:text-wise-blue">
              {c.title}
            </Link>
            <p className="text-sm text-ink-muted">
              {[c.category, c.subcategory, DIFFICULTY_LABEL[c.difficulty], `${c.stageCount} stages`].filter(Boolean).join(" · ")}
            </p>
            <p className="text-xs text-ink-subtle">Updated {when(c.updatedAt)}</p>
            <RowLinks c={c} />
            <CaseActions compact caseId={c.id} title={c.title} status={c.status} hasUnpublishedChanges={c.hasUnpublishedChanges} canEdit={canEdit} canPublish={canPublish} />
          </li>
        ))}
      </ul>
    </>
  );
}
