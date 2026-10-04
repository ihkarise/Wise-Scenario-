"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/field";

/** Debounced search box that keeps the query in the URL (the server does the searching). */
export function SearchBox({ id, label, placeholder }: { id: string; label: string; placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    if ((params.get("q") ?? "") === q.trim()) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on typing only
  }, [q]);

  return <Input id={id} type="search" label={label} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />;
}
