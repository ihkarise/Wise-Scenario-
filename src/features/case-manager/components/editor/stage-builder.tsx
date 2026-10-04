"use client";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import {
  buildOptionsFromAuthorContent,
  emptyInvestigation,
  emptyStage,
  LIMITS,
  type CaseDraftContent,
  type DraftStage,
} from "@/features/admin/draft";
import { uuidv4 } from "@/lib/utils/uuid";
import { move, RowTools } from "./fields";

type Props = {
  draft: CaseDraftContent;
  onStages: (stages: DraftStage[]) => void;
  /** Problems per stage index, from the readiness check. */
  issuesByStage: Map<number, string[]>;
};

/** Builds any number of stages (1–50). Order is the order shown here; stage numbers follow it. */
export function StageBuilder({ draft, onStages, issuesByStage }: Props) {
  const stages = draft.stages;
  const setStage = (i: number, patch: Partial<DraftStage>) => onStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const addStage = () => {
    const stage = emptyStage(uuidv4, stages.length + 1, draft.lifeLossPerWrong);
    onStages([...stages, stage]);
    requestAnimationFrame(() => document.getElementById(`stage-${stage.id}-clue`)?.focus());
  };

  return (
    <div className="grid gap-4">
      {stages.length === 0 && <p className="text-sm text-ink-muted">No stages yet. A case needs at least one stage. Add as many as the case needs.</p>}
      {stages.map((stage, i) => (
        <StageEditor
          key={stage.id}
          index={i}
          count={stages.length}
          stage={stage}
          draft={draft}
          issues={issuesByStage.get(i) ?? []}
          onChange={(patch) => setStage(i, patch)}
          onMove={(to) => onStages(move(stages, i, to))}
          onRemove={() => {
            if (window.confirm(`Delete stage ${i + 1}${stage.title ? ` (“${stage.title}”)` : ""}? This cannot be undone after saving.`)) {
              onStages(stages.filter((_, j) => j !== i));
            }
          }}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={addStage} disabled={stages.length >= LIMITS.maxStages}>
          + Add stage
        </Button>
        <span className="text-sm text-ink-muted">
          {stages.length} {stages.length === 1 ? "stage" : "stages"} (up to {LIMITS.maxStages})
        </span>
      </div>
    </div>
  );
}

function StageEditor({
  index,
  count,
  stage,
  draft,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  stage: DraftStage;
  draft: CaseDraftContent;
  issues: string[];
  onChange: (patch: Partial<DraftStage>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const pid = `stage-${stage.id}`;
  const correctId = stage.options.find((o) => o.isCorrect)?.id ?? null;

  const fillOptions = () => {
    const built = buildOptionsFromAuthorContent(draft, `${draft.caseCode}|${n}`, uuidv4);
    if (!built) {
      window.alert("Add the diagnosis and at least one differential diagnosis first. Options are built only from names you have written.");
      return;
    }
    if (stage.options.some((o) => o.label.trim()) && !window.confirm("Replace this stage's answer options with your diagnosis and differential diagnoses?")) return;
    onChange({ options: built });
  };

  return (
    <details open className="rounded-xl border border-line-strong bg-canvas">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-xs font-bold text-wise-blue">STAGE {n}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{stage.title || "Untitled stage"}</span>
        {issues.length > 0 && <span className="text-xs font-semibold text-wise-red">{issues.length} to fix</span>}
      </summary>
      <div className="grid gap-4 border-t border-line px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <RowTools index={index} count={count} onMove={onMove} onRemove={onRemove} label={`stage ${n}`} />
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Lives lost for a wrong answer
            <input
              type="number"
              min={0}
              max={LIMITS.maxLifeCost}
              value={stage.lifeCost}
              onChange={(e) => onChange({ lifeCost: Math.max(0, Math.min(LIMITS.maxLifeCost, Number(e.target.value) || 0)) })}
              className="min-h-10 w-20 rounded-lg border border-line-strong bg-surface px-2"
            />
          </label>
        </div>
        {issues.length > 0 && (
          <ul className="grid gap-1 rounded-lg bg-red-soft px-3 py-2 text-sm text-ink">
            {issues.map((m) => (
              <li key={m}>✕ {m}</li>
            ))}
          </ul>
        )}
        <Input id={`${pid}-title`} label="Stage title" maxLength={120} value={stage.title} onChange={(e) => onChange({ title: e.target.value })} />
        <Textarea id={`${pid}-clue`} label="Clue" rows={4} maxLength={4000} value={stage.content} onChange={(e) => onChange({ content: e.target.value })} hint="What the learner reads at this stage." />

        <fieldset className="grid gap-3 rounded-xl border border-line bg-surface p-3">
          <legend className="px-1 text-sm font-semibold text-ink-muted">Decision point</legend>
          <Input id={`${pid}-question`} label="Question" maxLength={500} value={stage.question} onChange={(e) => onChange({ question: e.target.value })} />
          <div className="grid gap-2">
            <p className="text-sm font-semibold text-ink-muted">Answer options (select the correct one)</p>
            {stage.options.map((o, j) => (
              <div key={o.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${pid}-correct`}
                  aria-label={`Option ${j + 1} is correct`}
                  checked={o.id === correctId}
                  onChange={() => onChange({ options: stage.options.map((x) => ({ ...x, isCorrect: x.id === o.id })) })}
                  className="size-5 shrink-0 accent-teal"
                />
                <input
                  aria-label={`Option ${j + 1}`}
                  value={o.label}
                  maxLength={300}
                  onChange={(e) => onChange({ options: stage.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3"
                />
                <button
                  type="button"
                  className="min-h-11 rounded-lg px-2 text-sm font-semibold text-wise-red hover:bg-red-soft"
                  onClick={() => onChange({ options: stage.options.filter((x) => x.id !== o.id) })}
                  aria-label={`Remove option ${j + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                className="min-h-9 text-xs"
                disabled={stage.options.length >= LIMITS.maxOptions}
                onClick={() => onChange({ options: [...stage.options, { id: uuidv4(), label: "", isCorrect: stage.options.length === 0 }] })}
              >
                + Add option
              </Button>
              <Button variant="ghost" className="min-h-9 text-xs" onClick={fillOptions}>
                Use diagnosis + differentials as options
              </Button>
            </div>
            <p className="text-xs text-ink-subtle">A correct answer at any stage solves the case, so the correct option should be the diagnosis.</p>
          </div>
          <Input id={`${pid}-hint`} label="Hint (optional)" maxLength={500} value={stage.hint} onChange={(e) => onChange({ hint: e.target.value })} />
        </fieldset>

        <Textarea
          id={`${pid}-explanation`}
          label="Stage explanation (optional)"
          rows={3}
          maxLength={4000}
          value={stage.explanation}
          onChange={(e) => onChange({ explanation: e.target.value })}
          hint="Shown only in the review after the case ends."
        />

        <fieldset className="grid gap-2 rounded-xl border border-line bg-surface p-3">
          <legend className="px-1 text-sm font-semibold text-ink-muted">Investigations (optional)</legend>
          <p className="text-xs text-ink-subtle">Shown with this clue. Only what you enter is displayed; nothing is filled in automatically.</p>
          {stage.investigations.map((inv, j) => {
            const set = (patch: Partial<typeof inv>) => onChange({ investigations: stage.investigations.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
            return (
              <div key={j} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-6">
                <input aria-label={`Investigation ${j + 1} test name`} placeholder="Test name" value={inv.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} className="min-h-10 rounded-lg border border-line-strong px-2 sm:col-span-2" />
                <input aria-label={`Investigation ${j + 1} value`} placeholder="Value" value={inv.value} maxLength={200} onChange={(e) => set({ value: e.target.value })} className="min-h-10 rounded-lg border border-line-strong px-2" />
                <input aria-label={`Investigation ${j + 1} unit`} placeholder="Unit" value={inv.unit} maxLength={60} onChange={(e) => set({ unit: e.target.value })} className="min-h-10 rounded-lg border border-line-strong px-2" />
                <input aria-label={`Investigation ${j + 1} reference range`} placeholder="Reference range" value={inv.referenceRange} maxLength={200} onChange={(e) => set({ referenceRange: e.target.value })} className="min-h-10 rounded-lg border border-line-strong px-2 sm:col-span-2" />
                <input aria-label={`Investigation ${j + 1} interpretation`} placeholder="Interpretation" value={inv.interpretation} maxLength={1000} onChange={(e) => set({ interpretation: e.target.value })} className="min-h-10 rounded-lg border border-line-strong px-2 sm:col-span-5" />
                <button type="button" className="min-h-10 rounded-lg text-sm font-semibold text-wise-red hover:bg-red-soft" onClick={() => onChange({ investigations: stage.investigations.filter((_, k) => k !== j) })}>
                  Remove
                </button>
              </div>
            );
          })}
          <Button variant="ghost" className="min-h-9 justify-self-start text-xs" disabled={stage.investigations.length >= LIMITS.maxInvestigations} onClick={() => onChange({ investigations: [...stage.investigations, emptyInvestigation()] })}>
            + Add investigation
          </Button>
        </fieldset>

        <Input id={`${pid}-xref`} label="Cross-reference (optional)" maxLength={1000} value={stage.crossReference} onChange={(e) => onChange({ crossReference: e.target.value })} hint="e.g. another Case ID or chapter. Shown only in the final review." />
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={stage.showPreviousClues} onChange={(e) => onChange({ showPreviousClues: e.target.checked })} className="size-5 accent-wise-blue" />
          Keep earlier clues on screen at this stage
        </label>
      </div>
    </details>
  );
}
