"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StageCard } from "@/components/ui/stage-card";
import { ErrorState } from "@/components/ui/state-views";
import type { CaseSummary } from "@/features/cases/case-repository";
import type { PlayerView } from "@/lib/engine/view";
import { useCasePlayer } from "../use-case-player";
import { AnswerForm } from "./answer-form";
import { FeedbackBanner } from "./feedback-banner";
import { PlayerHeader } from "./player-header";
import { ResultPanel } from "./result-panel";

type CasePlayerProps = { summary: CaseSummary; initialView: PlayerView | null };

export function CasePlayer({ summary, initialView }: CasePlayerProps) {
  const { view, selectedOptionId, setSelectedOptionId, busy, error, start, submit } = useCasePlayer(summary.slug, initialView);
  const firstRender = useRef(true);

  // Move focus to the newest clue or the result so keyboard and screen-reader users follow the case.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById(view?.result ? "result-heading" : "current-clue")?.focus();
  }, [view?.attemptId, view?.revision, view?.result]);

  const errorBox = error && <ErrorState title="That did not go through" message={error.message} />;

  if (!view) {
    return (
      <Card className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>
            {summary.domain} · {summary.category}
          </span>
          {summary.isDemo && <Badge tone="amber">DEMO CONTENT</Badge>}
        </div>
        <h1 className="text-2xl font-bold text-balance sm:text-3xl">{summary.title}</h1>
        <p className="text-ink-muted">{summary.summary}</p>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-ink-muted">
          <li>
            {summary.stageCount} clues and {summary.maxLives} {summary.maxLives === 1 ? "life" : "lives"}.
          </li>
          <li>Each wrong answer usually costs a life and reveals the next clue, with new answer options.</li>
          <li>Fewer clues and more lives left give a higher score.</li>
        </ul>
        {errorBox}
        <Button size="lg" onClick={start} loading={busy === "starting"}>
          Start case
        </Button>
      </Card>
    );
  }

  const completed = view.result !== null;
  return (
    <div className="grid gap-5">
      <PlayerHeader
        title={view.case.title}
        caseNumber={view.case.caseNumber}
        domain={view.case.domain}
        category={view.case.category}
        difficulty={view.case.difficulty}
        isDemo={view.case.isDemo}
        lives={view.livesRemaining}
        maxLives={view.maxLives}
        stageOrder={view.currentStageOrder}
        stageCount={view.stageCount}
        completed={completed}
      />

      {view.result ? (
        <>
          {view.clues.length > 0 && (
            <details className="rounded-xl bg-surface p-4 ring-1 ring-line">
              <summary className="cursor-pointer font-semibold">Clues you saw ({view.clues.length})</summary>
              <div className="mt-3 grid gap-2">
                {view.clues.map((c) => (
                  <StageCard key={c.stageId} order={c.order} title={c.title} content={c.content} />
                ))}
              </div>
            </details>
          )}
          <ResultPanel result={view.result} onPlayAgain={start} starting={busy === "starting"} />
        </>
      ) : (
        view.current && (
          <>
            {view.lastAnswer && <FeedbackBanner lastAnswer={view.lastAnswer} stageOrder={view.currentStageOrder} />}
            <div className="grid gap-3">
              {view.clues.map((c) => (
                <StageCard key={c.stageId} order={c.order} title={c.title} content={c.content} />
              ))}
              <StageCard
                order={view.current.order}
                title={view.current.title}
                content={view.current.content}
                current
                headingId="current-clue"
                badge={view.lastAnswer?.progression === "ADVANCED" ? <Badge tone="navy">New clue</Badge> : undefined}
              />
            </div>
            {errorBox}
            <AnswerForm
              stage={view.current}
              selectedOptionId={selectedOptionId}
              onSelect={setSelectedOptionId}
              onSubmit={submit}
              submitting={busy === "submitting"}
            />
          </>
        )
      )}
    </div>
  );
}
