"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { LifeIndicator } from "@/components/ui/life-indicator";
import { StageCard } from "@/components/ui/stage-card";
import type { CaseResultView } from "@/lib/engine/view";
import { cn } from "@/lib/utils/cn";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold tracking-wider text-ink-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}

const REASON_TEXT: Record<CaseResultView["reason"], string> = {
  SOLVED: "Solved",
  OUT_OF_LIVES: "Out of lives",
  FINAL_STAGE_REVEAL: "Not solved",
  FINAL_STAGE_END: "Not solved",
  FINAL_ATTEMPT_USED: "Not solved",
};

export function ResultPanel({ result, onPlayAgain, starting }: { result: CaseResultView; onPlayAgain: () => void; starting: boolean }) {
  const solved = result.status === "COMPLETED_SUCCESS";
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(result.shareText);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="grid gap-6">
      <div className={cn("grid justify-items-center gap-2 rounded-2xl p-6 text-center", solved ? "bg-teal-soft" : "bg-red-soft")}>
        <span className={cn("grid size-12 place-items-center rounded-full text-white", solved ? "bg-teal" : "bg-wise-red")} aria-hidden="true">
          {solved ? "✓" : "✕"}
        </span>
        <h2 id="result-heading" tabIndex={-1} className="text-2xl font-bold">
          {solved ? "Correct" : REASON_TEXT[result.reason]}
        </h2>
        {result.answerRevealed ? (
          <>
            <p className="text-sm text-ink-muted">{solved ? "Answer" : "The answer was"}</p>
            <p className="text-xl font-semibold text-balance">{result.correctAnswer}</p>
          </>
        ) : (
          <p className="max-w-prose text-sm text-ink-muted">The answer is kept hidden for this case so you can try it again.</p>
        )}
        <dl className="mt-3 grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-ink-subtle">{solved ? "Solved after" : "Clues reached"}</dt>
            <dd className="font-semibold tabular-nums">
              {result.stageReached} of {result.stageCount} clues
            </dd>
          </div>
          <div className="grid justify-items-center rounded-xl bg-surface p-3">
            <dt className="text-xs text-ink-subtle">Lives remaining</dt>
            <dd>
              <LifeIndicator lives={result.livesRemaining} maxLives={result.maxLives} size="sm" />
            </dd>
          </div>
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-ink-subtle">Score</dt>
            <dd className="font-semibold tabular-nums">{result.score}</dd>
          </div>
        </dl>
      </div>

      <Section title="Your path">
        <ol className="grid gap-2">
          {result.history.map((h, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
              <span className="font-mono text-xs text-ink-subtle">Clue {h.stageOrder}</span>
              <span className="min-w-0 flex-1">{h.optionLabel}</span>
              {h.wasCorrect ? <Badge tone="teal">✓ Correct</Badge> : <Badge tone="red">✕ Wrong</Badge>}
            </li>
          ))}
        </ol>
      </Section>

      {result.answerRevealed && (
        <>
          {result.keyClues.length > 0 && (
            <Section title="Key clues">
              <ul className="grid list-disc gap-1 pl-5">
                {result.keyClues.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </Section>
          )}
          {result.finalExplanation && (
            <Section title={`Why ${result.correctAnswer} fits`}>
              <p className="leading-relaxed">{result.finalExplanation}</p>
            </Section>
          )}
          {result.differentials.length > 0 && (
            <Section title="Why the other answers fit less well">
              <ul className="grid gap-2">
                {result.differentials.map((d) => (
                  <li key={d.label} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                    <span className="font-semibold">{d.label}</span>: {d.reason}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {result.learningPoints.length > 0 && (
            <Section title="Learning points">
              <ul className="grid list-disc gap-1 pl-5">
                {result.learningPoints.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>
          )}
          {result.unseenClues.length > 0 && (
            <Section title="Clues you did not reach">
              <div className="grid gap-2">
                {result.unseenClues.map((c) => (
                  <StageCard key={c.stageId} order={c.order} title={c.title} content={c.content} />
                ))}
              </div>
            </Section>
          )}
          <Section title="References">
            {result.references.length === 0 ? (
              <p className="text-sm text-ink-muted">No references added yet.</p>
            ) : (
              <ul className="grid gap-2">
                {result.references.map((r) => (
                  <li key={r.title} className="text-sm">
                    {r.title}
                    {r.year ? ` (${r.year})` : ""} {r.isPlaceholder && <Badge tone="amber">Placeholder, not verified</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <Section title="Share your result (no answer shown)">
        <pre className="overflow-x-auto rounded-xl bg-navy p-4 font-mono text-sm leading-relaxed whitespace-pre text-white">{result.shareText}</pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={copyShare}>
            Copy result
          </Button>
          <span role="status" className="text-sm text-ink-muted">
            {copied === "copied" ? "Copied." : copied === "failed" ? "Copy is not available here. Select the text above instead." : ""}
          </span>
        </div>
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onPlayAgain} loading={starting}>
          Play again
        </Button>
        <Link href="/play" className={buttonClasses("secondary")}>
          Back to cases
        </Link>
      </div>
    </div>
  );
}
