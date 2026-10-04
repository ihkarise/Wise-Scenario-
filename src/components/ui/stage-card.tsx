import type { ReactNode } from "react";
import type { Investigation } from "@/lib/engine/types";
import { cn } from "@/lib/utils/cn";
import { InvestigationTable } from "./investigation-table";

type StageCardProps = {
  order: number;
  title: string;
  content: string;
  /** Highlights the newest clue. */
  current?: boolean;
  badge?: ReactNode;
  headingId?: string;
  /** Author-supplied results for this clue, if any. */
  investigations?: readonly Investigation[];
};

/** Container for one clue/stage of a case. */
export function StageCard({ order, title, content, current = false, badge, headingId, investigations }: StageCardProps) {
  return (
    <article className={cn("rounded-2xl p-4 sm:p-5", current ? "border-2 border-wise-blue bg-surface" : "bg-blue-soft/60")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 id={headingId} tabIndex={headingId ? -1 : undefined} className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Clue {order} · {title}
        </h3>
        {badge}
      </div>
      <p className="text-base leading-relaxed whitespace-pre-line text-ink">{content}</p>
      {investigations && investigations.length > 0 && <InvestigationTable investigations={investigations} />}
    </article>
  );
}
