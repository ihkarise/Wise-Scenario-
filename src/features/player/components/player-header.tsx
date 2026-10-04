import { Badge } from "@/components/ui/badge";
import { LifeIndicator } from "@/components/ui/life-indicator";
import { ProgressIndicator } from "@/components/ui/progress-indicator";
import type { Difficulty } from "@/lib/engine/types";
import { formatCaseNumber } from "@/lib/engine/view";
import { DIFFICULTY_LABEL } from "../labels";

type PlayerHeaderProps = {
  title: string;
  caseNumber: number;
  domain: string;
  category: string;
  difficulty: Difficulty;
  isDemo: boolean;
  lives: number;
  maxLives: number;
  stageOrder: number;
  stageCount: number;
  completed: boolean;
};

export function PlayerHeader(p: PlayerHeaderProps) {
  return (
    <header className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <span>
          {p.domain} · {p.category}
        </span>
        <Badge>{DIFFICULTY_LABEL[p.difficulty]}</Badge>
        {p.isDemo && <Badge tone="amber">DEMO CONTENT</Badge>}
      </div>
      <h1 className="text-2xl font-bold text-balance sm:text-3xl">
        <span className="mr-2 font-mono text-base font-medium text-ink-subtle">{formatCaseNumber(p.caseNumber)}</span>
        {p.title}
      </h1>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
        <LifeIndicator lives={p.lives} maxLives={p.maxLives} />
        <ProgressIndicator current={p.stageOrder} total={p.stageCount} completed={p.completed} />
      </div>
    </header>
  );
}
