"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import { STATUS_LABEL } from "@/features/admin/draft";
import { DIFFICULTY_LABEL } from "@/features/player/labels";
import { DIFFICULTIES, PUBLICATION_STATUSES } from "@/lib/engine/types";

type Props = { categories: { id: string; label: string }[] };

/** Search and filters live in the URL, so results can be bookmarked and the server does the filtering. */
export function InventoryFilters({ categories }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search: one request after the author stops typing, not one per keystroke.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update("q", q.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on typing only
  }, [q]);

  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5" aria-busy={pending || undefined}>
      <div className="sm:col-span-2 lg:col-span-1">
        <Input id="inventory-search" type="search" label="Search" placeholder="Case ID, title, category…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Select id="inventory-status" label="Status" value={params.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
        <option value="">All statuses</option>
        {PUBLICATION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
      <Select id="inventory-difficulty" label="Difficulty" value={params.get("difficulty") ?? ""} onChange={(e) => update("difficulty", e.target.value)}>
        <option value="">All difficulties</option>
        {DIFFICULTIES.map((d) => (
          <option key={d} value={d}>
            {DIFFICULTY_LABEL[d]}
          </option>
        ))}
      </Select>
      <Select id="inventory-category" label="Category" value={params.get("category") ?? ""} onChange={(e) => update("category", e.target.value)}>
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>
      <Select id="inventory-sort" label="Sort by" value={params.get("sort") ?? "updated_desc"} onChange={(e) => update("sort", e.target.value)}>
        <option value="updated_desc">Last updated (newest)</option>
        <option value="updated_asc">Last updated (oldest)</option>
        <option value="title_asc">Title (A–Z)</option>
        <option value="code_asc">Case ID</option>
        <option value="number_desc">Newest created</option>
      </Select>
    </div>
  );
}
