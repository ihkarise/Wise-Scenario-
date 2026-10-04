"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const LINKS = [
  { href: "/admin", label: "Case Manager", exact: true },
  { href: "/admin/cases", label: "Case inventory" },
  { href: "/admin/import", label: "Import JSON" },
  { href: "/admin/conditions", label: "Conditions" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Case Manager" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line pb-2 text-sm font-semibold">
      {LINKS.map((l) => {
        const active = l.exact ? path === l.href : path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 whitespace-nowrap",
              active ? "bg-blue-soft text-wise-blue" : "text-ink-muted hover:bg-blue-soft hover:text-wise-blue",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
