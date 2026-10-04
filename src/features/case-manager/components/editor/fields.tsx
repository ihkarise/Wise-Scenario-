"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/field";

/** A list edited as text, one item per line. Keeps the author's typing (including blank lines) while editing. */
export function LinesField({ id, label, hint, value, onChange, rows = 3 }: { id: string; label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  const [text, setText] = useState(value.join("\n"));
  // Keep the author's typing (blank lines, trailing newline) unless the list was changed from outside.
  const shown = sameList(text, value) ? text : value.join("\n");
  return (
    <Textarea
      id={id}
      label={label}
      hint={hint ?? "One per line."}
      rows={rows}
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
      }}
    />
  );
}

const sameList = (text: string, list: string[]) => {
  const a = text.split("\n").map((s) => s.trim()).filter(Boolean);
  return a.length === list.length && a.every((x, i) => x === list[i]);
};

/** A collapsible editor section. Open by default; shows how many problems it contains. */
export function EditorSection({ id, number, title, summary, issues = 0, children, defaultOpen = true }: { id: string; number: number; title: string; summary?: string; issues?: number; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details id={id} open={defaultOpen} className="group scroll-mt-24 rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-soft text-xs font-bold text-wise-blue">{number}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold tracking-wider uppercase">{title}</span>
          {summary && <span className="block truncate text-sm text-ink-muted">{summary}</span>}
        </span>
        {issues > 0 && <Badge tone="red">{issues === 1 ? "1 issue" : `${issues} issues`}</Badge>}
        <span aria-hidden="true" className="text-ink-subtle transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="grid gap-4 border-t border-line px-4 py-4 sm:px-5">{children}</div>
    </details>
  );
}

export function RowTools({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void; label: string }) {
  const btn = "min-h-9 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink-muted hover:border-line-strong disabled:opacity-40";
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" className={btn} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${label} up`}>
        ↑ Up
      </button>
      <button type="button" className={btn} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${label} down`}>
        ↓ Down
      </button>
      <button type="button" className={`${btn} text-wise-red`} onClick={onRemove} aria-label={`Delete ${label}`}>
        Delete
      </button>
    </div>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
