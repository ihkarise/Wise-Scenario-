import type { ReactNode } from "react";
import { InvestigationTable } from "@/components/ui/investigation-table";
import type { ReasoningView } from "@/lib/engine/view";

/**
 * Extra reasoning written in the Case Manager, shown after the existing result sections. Every block
 * appears only when the author wrote it; nothing here is generated. Cases without these fields never
 * render this component (their `reasoning` is null).
 */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold tracking-wider text-ink-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}

const Paragraph = ({ text }: { text: string }) => <p className="leading-relaxed whitespace-pre-line">{text}</p>;

export function ReasoningDebrief({ reasoning: r }: { reasoning: ReasoningView }) {
  return (
    <div className="grid gap-6">
      {r.yourWrongAnswers.length > 0 && (
        <Block title="About your wrong answers">
          <ul className="grid gap-2">
            {r.yourWrongAnswers.map((w) => (
              <li key={w.optionLabel} className="grid gap-1 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                <span className="font-semibold">{w.optionLabel}</span>
                <span className="whitespace-pre-line">{w.explanation}</span>
                {w.missedClues.length > 0 && (
                  <span className="text-sm text-ink-muted">Clues that point elsewhere: {w.missedClues.join("; ")}</span>
                )}
                {w.betterDirection && <span className="text-sm text-ink-muted">Better direction: {w.betterDirection}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {r.clinicalSummary && (
        <Block title="Clinical summary">
          <Paragraph text={r.clinicalSummary} />
        </Block>
      )}
      {r.detailedExplanation && (
        <Block title="Detailed explanation">
          <Paragraph text={r.detailedExplanation} />
        </Block>
      )}
      {r.diagnosticReasoning && (
        <Block title="Diagnostic reasoning">
          <Paragraph text={r.diagnosticReasoning} />
        </Block>
      )}
      {r.stageReview.length > 0 && (
        <Block title="Clue by clue">
          <ol className="grid gap-2">
            {r.stageReview.map((s) => (
              <li key={s.order} className="grid gap-1 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                <span className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                  Clue {s.order} · {s.title}
                </span>
                {s.explanation && <Paragraph text={s.explanation} />}
                {s.investigations.length > 0 && <InvestigationTable investigations={s.investigations} />}
                {s.crossReference && <span className="text-sm text-ink-muted">See also: {s.crossReference}</span>}
              </li>
            ))}
          </ol>
        </Block>
      )}
      {r.investigationSummary && (
        <Block title="Investigation summary">
          <Paragraph text={r.investigationSummary} />
        </Block>
      )}
      {r.differentialDetails.length > 0 && (
        <Block title="Differential diagnoses in detail">
          <ul className="grid gap-2">
            {r.differentialDetails.map((d) => (
              <li key={d.name} className="grid gap-1 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                <span className="font-semibold">{d.name}</span>
                {d.whyConsidered && <span>Why considered: {d.whyConsidered}</span>}
                {d.whyRejected && <span>Why rejected: {d.whyRejected}</span>}
                {d.clinicalExplanation && <span className="text-ink-muted">{d.clinicalExplanation}</span>}
                {d.crossReferences.length > 0 && <span className="text-sm text-ink-muted">See also: {d.crossReferences.join("; ")}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {r.whereReasoningCanGoWrong && (
        <Block title="Where reasoning can go wrong">
          <Paragraph text={r.whereReasoningCanGoWrong} />
        </Block>
      )}
      {r.clinicalInsight && (
        <Block title="Clinical insight">
          <Paragraph text={r.clinicalInsight} />
        </Block>
      )}
      {r.finalReasoning && (
        <Block title="Final reasoning">
          <Paragraph text={r.finalReasoning} />
        </Block>
      )}
    </div>
  );
}
