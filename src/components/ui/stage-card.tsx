import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type StageCardProps = {
  order: number;
  title: string;
  content: string;
  /** Highlights the newest clue. */
  current?: boolean;
  badge?: ReactNode;
  headingId?: string;
};

/** Container for one clue/stage of a case. */
export function StageCard({ order, title, content, current = false, badge, headingId }: StageCardProps) {
  return (
    <article className={cn("rounded-2xl p-4 sm:p-5", current ? "border-2 border-wise-blue bg-surface" : "bg-blue-soft/60")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 id={headingId} tabIndex={headingId ? -1 : undefined} className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Clue {order} · {title}
        </h3>
        {badge}
      </div>
      <p className="text-base leading-relaxed text-ink">{content}</p>
    </article>
  );
}
