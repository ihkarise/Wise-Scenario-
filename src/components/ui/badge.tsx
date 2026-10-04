import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "neutral" | "blue" | "teal" | "red" | "amber" | "navy";

const tones: Record<Tone, string> = {
  neutral: "border border-line bg-surface text-ink-muted",
  blue: "bg-blue-soft text-wise-blue",
  teal: "bg-teal-soft text-teal",
  red: "bg-red-soft text-wise-red",
  amber: "bg-amber-soft text-amber-ink",
  navy: "bg-navy text-white",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}
