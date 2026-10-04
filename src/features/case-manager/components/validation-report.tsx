import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import type { CheckItem } from "@/features/case-manager/case-document";
import type { DuplicateMatch } from "@/features/case-manager/duplicates";
import { cn } from "@/lib/utils/cn";
import { StatusBadge } from "./status-badge";

const ICON: Record<CheckItem["level"], { symbol: string; className: string; label: string }> = {
  ok: { symbol: "✓", className: "bg-teal-soft text-teal", label: "Passed" },
  info: { symbol: "i", className: "bg-blue-soft text-wise-blue", label: "Note" },
  warning: { symbol: "!", className: "bg-amber-soft text-amber-ink", label: "Warning" },
  error: { symbol: "✕", className: "bg-red-soft text-wise-red", label: "Problem" },
};

/** The ✓ / ✕ report. Uses symbols and words, never colour alone. */
export function ValidationReport({ title, items }: { title: string; items: CheckItem[] }) {
  const errors = items.filter((i) => i.level === "error").length;
  const warnings = items.filter((i) => i.level === "warning").length;
  return (
    <section aria-label={title} className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-wider uppercase">{title}</h2>
        <p className={cn("text-sm font-semibold", errors ? "text-wise-red" : "text-teal")} role="status">
          {errors ? `${errors} ${errors === 1 ? "problem" : "problems"} to fix` : "No problems found"}
          {warnings ? ` · ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : ""}
        </p>
      </div>
      <ul className="grid gap-1.5">
        {items.map((item, i) => {
          const icon = ICON[item.level];
          return (
            <li key={i} className="flex gap-2 text-sm">
              <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold", icon.className)}>
                {icon.symbol}
              </span>
              <span>
                <span className="sr-only">{icon.label}: </span>
                {item.message}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** POSSIBLE DUPLICATE panel. Nothing is merged or overwritten; the author decides. */
export function DuplicateList({ newCase, duplicates, actions }: { newCase: { caseCode: string; title: string }; duplicates: DuplicateMatch[]; actions?: ReactNode }) {
  if (duplicates.length === 0) return null;
  return (
    <section aria-label="Possible duplicates" className="grid gap-3 rounded-2xl border-2 border-amber-ink/30 bg-amber-soft p-4 sm:p-5">
      <h2 className="text-sm font-bold tracking-wider text-amber-ink uppercase">Possible duplicate</h2>
      {duplicates.map((d) => (
        <div key={d.caseId} className="grid gap-2 rounded-xl bg-surface p-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-ink-muted">Existing</dt>
            <dd>
              <span className="font-mono">{d.caseCode}</span> — {d.title} <StatusBadge status={d.status} />
            </dd>
            <dt className="font-semibold text-ink-muted">New</dt>
            <dd>
              <span className="font-mono">{newCase.caseCode}</span> — {newCase.title}
            </dd>
            <dt className="font-semibold text-ink-muted">Similarity</dt>
            <dd>
              <span className="text-lg font-bold tabular-nums">{d.similarity}%</span>
              {d.reasons.length > 0 && <span className="text-ink-muted"> · {d.reasons.join(" · ")}</span>}
            </dd>
          </dl>
          <Link href={`/admin/cases/${d.caseId}`} target="_blank" rel="noopener" className={buttonClasses("secondary", "md", "justify-self-start")}>
            View existing ↗
          </Link>
        </div>
      ))}
      {actions}
    </section>
  );
}
