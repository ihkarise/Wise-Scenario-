"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { Condition } from "@/features/case-manager/conditions";
import { cn } from "@/lib/utils/cn";
import { adminRequest } from "../../admin-api";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
};

/**
 * Diagnosis autocomplete for AUTHORS (WAI-ARIA combobox). Suggestions come from the staff-only
 * condition inventory API, filtered on the server with partial, alias and typo-tolerant matching.
 * It only suggests names; the author can always type any name.
 */
export function ConditionAutocomplete({ id, label, value, onChange, hint, placeholder }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Condition[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  /** What the author typed (null until they type, so loading a saved name does not open suggestions). */
  const [typed, setTyped] = useState<string | null>(null);

  useEffect(() => {
    const q = typed?.trim() ?? "";
    if (!open || q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await adminRequest<{ items: Condition[] }>(`/api/admin/conditions?limit=8&q=${encodeURIComponent(q)}`);
      if (!controller.signal.aborted) {
        setItems(res.ok ? res.data.items : []);
        setActive(-1);
        setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [typed, open]);

  const pick = (c: Condition) => {
    onChange(c.name);
    setOpen(false);
    setItems([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && active >= 0 && items[active]) {
      e.preventDefault();
      pick(items[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && (typed?.trim().length ?? 0) >= 2 && items.length > 0;
  return (
    <div className="relative grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        maxLength={200}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className="min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-subtle focus:border-wise-blue focus:ring-3 focus:ring-blue-soft focus:outline-none"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-subtle">
          {hint}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {open && !loading && (typed?.trim().length ?? 0) >= 2 ? `${items.length} suggestions` : ""}
      </span>
      {showList && (
        <ul id={listId} role="listbox" className="absolute top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line-strong bg-surface py-1 shadow-lg">
          {items.map((c, i) => (
            <li
              key={`${c.name}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              className={cn("grid min-h-11 cursor-pointer gap-0.5 px-3 py-2", i === active ? "bg-blue-soft" : "hover:bg-canvas")}
            >
              <span className="font-semibold">{c.name}</span>
              <span className="text-xs text-ink-muted">
                {[c.aliases.slice(0, 3).join(", "), c.specialty, c.source === "cases" ? "from your cases" : ""].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
