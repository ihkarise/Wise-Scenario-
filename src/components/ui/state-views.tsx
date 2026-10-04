import type { ReactNode } from "react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-3 rounded-2xl border border-line bg-surface p-6">
      <span className="sr-only">{label}</span>
      <div className="h-4 w-2/3 animate-pulse rounded bg-blue-soft" />
      <div className="h-4 w-full animate-pulse rounded bg-blue-soft" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-blue-soft" />
    </div>
  );
}

export function ErrorState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="grid gap-2 rounded-2xl border border-wise-red/30 bg-red-soft p-5">
      <p className="font-semibold text-ink">{title}</p>
      <p className="text-sm text-ink-muted">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      <p className="max-w-prose text-sm text-ink-muted">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
