import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatCaseNumber } from "@/lib/engine/view";
import { DIFFICULTY_LABEL } from "@/features/player/labels";
import type { CaseSummary } from "../case-repository";

export function CaseCard({ summary }: { summary: CaseSummary }) {
  return (
    <Link
      href={`/case/${summary.slug}`}
      className="group grid gap-2 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-wise-blue"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <span className="font-mono">{formatCaseNumber(summary.caseNumber)}</span>
        <span>
          {summary.domain} · {summary.category}
        </span>
      </div>
      <h2 className="text-lg font-semibold text-ink group-hover:text-wise-blue">{summary.title}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{DIFFICULTY_LABEL[summary.difficulty]}</Badge>
        <Badge tone="blue">
          {summary.stageCount} clues · {summary.maxLives} lives
        </Badge>
        {summary.isDemo && <Badge tone="amber">DEMO CONTENT</Badge>}
      </div>
    </Link>
  );
}
