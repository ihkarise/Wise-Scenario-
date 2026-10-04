"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import {
  checkReadiness,
  cleanDraft,
  draftContent,
  emptyDifferential,
  emptyReference,
  emptyWrongAnswer,
  LIMITS,
  REFERENCE_TYPES,
  saveBlockers,
  TERMINAL_BEHAVIOR_LABEL,
  type CaseDraft,
  type DraftDifferential,
  type DraftReference,
  type DraftWrongAnswer,
  type ReadinessSection,
} from "@/features/admin/draft";
import type { DocumentCheck } from "@/features/admin/admin-case-service";
import { draftToDocument } from "@/features/case-manager/case-document";
import { DIFFICULTY_LABEL } from "@/features/player/labels";
import { DIFFICULTIES, TERMINAL_BEHAVIORS, type Difficulty, type TerminalBehavior } from "@/lib/engine/types";
import { matchesAnswerKey } from "@/lib/matching/text";
import { uuidv4 } from "@/lib/utils/uuid";
import { adminRequest } from "../../admin-api";
import { StatusBadge } from "../status-badge";
import { DuplicateList, ValidationReport } from "../validation-report";
import { ConditionAutocomplete } from "./condition-autocomplete";
import { EditorSection, LinesField, move, RowTools } from "./fields";
import { StageBuilder } from "./stage-builder";

type Props = {
  initialDraft: CaseDraft;
  domains: { id: string; name: string }[];
  categories: { domainId: string; name: string }[];
  canAddCategory: boolean;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string; issues: string[]; conflict: boolean };

const SECTION_ANCHOR: Record<ReadinessSection, string> = {
  basic: "section-basic",
  stages: "section-stages",
  diagnosis: "section-diagnosis",
  differentials: "section-differentials",
  wrongAnswers: "section-wrong",
  learning: "section-learning",
  references: "section-references",
};

export function CaseEditor({ initialDraft, domains, categories, canAddCategory }: Props) {
  const [draft, setDraft] = useState<CaseDraft>(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [check, setCheck] = useState<DocumentCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [answerTest, setAnswerTest] = useState("");
  const saving = useRef(false);

  const update = useCallback((patch: Partial<CaseDraft> | ((d: CaseDraft) => Partial<CaseDraft>)) => {
    setDraft((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
    setDirty(true);
    setCheck(null);
  }, []);
  const dx = draft.diagnosis;
  const setDx = (patch: Partial<CaseDraft["diagnosis"]>) => update((d) => ({ diagnosis: { ...d.diagnosis, ...patch } }));

  const readiness = useMemo(() => checkReadiness(draft), [draft]);
  const allIssues = [...readiness.playErrors, ...readiness.publishErrors];
  const issuesIn = (section: ReadinessSection) => allIssues.filter((i) => i.section === section).length;
  const issuesByStage = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const i of readiness.playErrors) if (i.stageIndex !== undefined) map.set(i.stageIndex, [...(map.get(i.stageIndex) ?? []), i.message]);
    return map;
  }, [readiness]);
  const domainName = domains.find((d) => d.id === draft.domainId)?.name ?? "";
  const locked = draft.publishedVersion !== null;

  const doSave = useCallback(async () => {
    if (saving.current) return;
    const cleaned = cleanDraft(draft);
    const blockers = saveBlockers(cleaned);
    if (blockers.length > 0) {
      setSave({ kind: "error", message: "Fill in these fields before saving:", issues: blockers, conflict: false });
      return;
    }
    saving.current = true;
    setSave({ kind: "saving" });
    const res = await adminRequest<{ revision: number; updatedAt: string; hasUnpublishedChanges: boolean }>(`/api/admin/cases/${draft.id}`, {
      method: "PUT",
      body: { content: draftContent(cleaned as CaseDraft), expectedRevision: draft.revision },
    });
    saving.current = false;
    if (res.ok) {
      setDraft({ ...(cleaned as CaseDraft), revision: res.data.revision, updatedAt: res.data.updatedAt, hasUnpublishedChanges: res.data.hasUnpublishedChanges });
      setDirty(false);
      setSave({ kind: "saved", at: res.data.updatedAt });
    } else {
      setSave({ kind: "error", message: res.message, issues: res.issues, conflict: res.code === "EDIT_CONFLICT" });
    }
  }, [draft]);

  // Ctrl/Cmd + S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void doSave();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [doSave, dirty]);

  const validate = async () => {
    setChecking(true);
    const res = await adminRequest<DocumentCheck>("/api/admin/import/validate", {
      method: "POST",
      body: { document: draftToDocument(draft, { domain: domainName }), exceptCaseId: draft.id },
    });
    setChecking(false);
    if (res.ok) setCheck(res.data);
    else setSave({ kind: "error", message: res.message, issues: res.issues, conflict: false });
    requestAnimationFrame(() => document.getElementById("validation-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const list = <T,>(key: "differentialDiagnoses" | "wrongAnswerExplanations" | "references") => ({
    set: (i: number, patch: Partial<T>) => update((d) => ({ [key]: (d[key] as T[]).map((x, j) => (j === i ? { ...x, ...patch } : x)) }) as Partial<CaseDraft>),
    move: (i: number, to: number) => update((d) => ({ [key]: move(d[key] as T[], i, to) }) as Partial<CaseDraft>),
    remove: (i: number) => update((d) => ({ [key]: (d[key] as T[]).filter((_, j) => j !== i) }) as Partial<CaseDraft>),
  });
  const diffs = list<DraftDifferential>("differentialDiagnoses");
  const wrongs = list<DraftWrongAnswer>("wrongAnswerExplanations");
  const refs = list<DraftReference>("references");
  const investigationCount = draft.stages.reduce((n, s) => n + s.investigations.length, 0);

  return (
    <div className="grid gap-5 pb-28">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span className="font-mono">{draft.caseCode || "No Case ID"}</span>
          <StatusBadge status={draft.status} changed={draft.hasUnpublishedChanges} />
          {draft.publishedVersion && <span>Live version: v{draft.publishedVersion}</span>}
          {draft.isDemo && <Badge tone="amber">DEMO CONTENT</Badge>}
        </div>
        <h1 className="text-3xl font-bold text-balance">{draft.title || "Untitled case"}</h1>
        {draft.status === "PUBLISHED" && (
          <p className="text-sm text-ink-muted">Learners keep playing the published version until a super administrator publishes your changes.</p>
        )}
      </header>

      <section aria-label="Readiness" className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={readiness.canPreview ? "teal" : "red"}>{readiness.canPreview ? "✓ Ready to preview" : "✕ Not ready to preview"}</Badge>
          <Badge tone={readiness.canPublish ? "teal" : "red"}>{readiness.canPublish ? "✓ Ready to publish" : "✕ Not ready to publish"}</Badge>
          {readiness.warnings.length > 0 && <Badge tone="amber">{readiness.warnings.length} warnings</Badge>}
        </div>
        {allIssues.length + readiness.warnings.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-wise-blue">Show what is missing</summary>
            <ul className="mt-2 grid gap-1 text-sm">
              {allIssues.map((i, k) => (
                <li key={`e${k}`}>
                  ✕ <a className="hover:underline" href={`#${SECTION_ANCHOR[i.section]}`}>{i.message}</a>
                </li>
              ))}
              {readiness.warnings.map((i, k) => (
                <li key={`w${k}`} className="text-ink-muted">
                  ! <a className="hover:underline" href={`#${SECTION_ANCHOR[i.section]}`}>{i.message}</a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* 1 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-basic" number={1} title="Basic information" summary={[draft.category, draft.subcategory, DIFFICULTY_LABEL[draft.difficulty]].filter(Boolean).join(" · ")} issues={issuesIn("basic")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="f-code" label="Case ID" maxLength={40} value={draft.caseCode} onChange={(e) => update({ caseCode: e.target.value })} hint="e.g. CASE-005. Must be unique." />
          <Input id="f-title" label="Title" maxLength={200} value={draft.title} onChange={(e) => update({ title: e.target.value })} hint="Do not give away the diagnosis." />
          <Input
            id="f-slug"
            label="Web address"
            maxLength={80}
            value={draft.slug}
            disabled={locked}
            onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
            hint={locked ? "Fixed after the first publication." : "Lower-case letters, numbers and dashes."}
          />
          <Select id="f-domain" label="Domain" value={draft.domainId} onChange={(e) => update({ domainId: e.target.value })}>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div>
            <Input id="f-category" label="Category" list="f-category-list" maxLength={80} value={draft.category} onChange={(e) => update({ category: e.target.value })} hint={canAddCategory ? "Choose one or type a new category." : "Choose an existing category."} />
            <datalist id="f-category-list">
              {categories
                .filter((c) => c.domainId === draft.domainId)
                .map((c) => (
                  <option key={c.name} value={c.name} />
                ))}
            </datalist>
          </div>
          <Input id="f-subcategory" label="Subcategory" maxLength={80} value={draft.subcategory} onChange={(e) => update({ subcategory: e.target.value })} />
          <Select id="f-difficulty" label="Difficulty" value={draft.difficulty} onChange={(e) => update({ difficulty: e.target.value as Difficulty })}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </Select>
          <Input id="f-lives" type="number" label="Starting lives" min={LIMITS.minLives} max={LIMITS.maxLives} value={draft.maxLives} onChange={(e) => update({ maxLives: Number(e.target.value) || LIMITS.minLives })} />
          <div className="grid gap-1.5">
            <Input id="f-lifeloss" type="number" label="Life loss per wrong answer (default for stages)" min={0} max={LIMITS.maxLifeCost} value={draft.lifeLossPerWrong} onChange={(e) => update({ lifeLossPerWrong: Math.max(0, Number(e.target.value) || 0) })} />
            <Button variant="ghost" className="min-h-9 justify-self-start text-xs" onClick={() => update((d) => ({ stages: d.stages.map((s) => ({ ...s, lifeCost: d.lifeLossPerWrong })) }))}>
              Apply to all stages
            </Button>
          </div>
          <Input id="f-score" type="number" label="Starting score (optional)" min={0} max={LIMITS.maxScore} value={draft.startingScore ?? ""} onChange={(e) => update({ startingScore: e.target.value === "" ? null : Number(e.target.value) })} />
          <Input
            id="f-penalty"
            type="number"
            label="Wrong-answer penalty (optional)"
            min={0}
            max={LIMITS.maxScore}
            value={draft.wrongAnswerPenalty ?? ""}
            onChange={(e) => update({ wrongAnswerPenalty: e.target.value === "" ? null : Number(e.target.value) })}
            hint="Saved with the case. The game currently keeps its existing scoring."
          />
          <Select id="f-final" label="If the last stage is answered wrongly" value={draft.terminalBehavior} onChange={(e) => update({ terminalBehavior: e.target.value as TerminalBehavior })} hint={TERMINAL_BEHAVIOR_LABEL[draft.terminalBehavior].help}>
            {TERMINAL_BEHAVIORS.map((t) => (
              <option key={t} value={t}>
                {TERMINAL_BEHAVIOR_LABEL[t].title}
              </option>
            ))}
          </Select>
        </div>
        <Textarea id="f-summary" label="Summary (shown on the case card)" rows={2} maxLength={500} value={draft.summary} onChange={(e) => update({ summary: e.target.value })} />
        <Textarea id="f-objective" label="Learning objective (optional)" rows={2} maxLength={1000} value={draft.learningObjective} onChange={(e) => update({ learningObjective: e.target.value })} />
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" className="size-5 accent-wise-blue" checked={draft.revealCorrectOptionOnWrong} onChange={(e) => update({ revealCorrectOptionOnWrong: e.target.checked })} />
          Show the correct option right after a wrong answer (off by default)
        </label>
      </EditorSection>

      {/* 2 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-stages" number={2} title="Stages" summary={`${draft.stages.length} ${draft.stages.length === 1 ? "stage" : "stages"}`} issues={issuesIn("stages")}>
        <StageBuilder draft={draft} issuesByStage={issuesByStage} onStages={(stages) => update({ stages })} />
      </EditorSection>

      {/* 3 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-diagnosis" number={3} title="Diagnosis" summary={dx.displayName || dx.primary || "Not set"} issues={issuesIn("diagnosis")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <ConditionAutocomplete id="f-dx-primary" label="Primary diagnosis" value={dx.primary} onChange={(v) => setDx({ primary: v })} placeholder="Start typing, e.g. AIH" hint="Suggestions come from the condition inventory." />
          <Input id="f-dx-display" label="Display name (shown to learners)" maxLength={300} value={dx.displayName} onChange={(e) => setDx({ displayName: e.target.value })} hint="Leave empty to show the primary diagnosis." />
          <LinesField id="f-dx-accepted" label="Accepted answers" value={dx.acceptedAnswers} onChange={(v) => setDx({ acceptedAnswers: v })} hint="One per line. Matching ignores capital letters and extra spaces." />
          <LinesField id="f-dx-aliases" label="Aliases and abbreviations" value={dx.aliases} onChange={(v) => setDx({ aliases: v })} />
        </div>
        <div className="grid gap-2 rounded-xl border border-line bg-canvas p-3">
          <Input id="f-dx-test" label="Check an answer" value={answerTest} onChange={(e) => setAnswerTest(e.target.value)} placeholder="Type an answer to see if it would be accepted" />
          {answerTest.trim() && (
            <p role="status" className="text-sm font-semibold">
              {matchesAnswerKey(answerTest, dx) ? <span className="text-teal">✓ Accepted (exact, capital letters, spacing or alias match)</span> : <span className="text-wise-red">✕ Not accepted. Add it as an accepted answer or alias if it should be.</span>}
            </p>
          )}
          <p className="text-xs text-ink-subtle">Authoring check only. During play, answers are always checked on the server.</p>
        </div>
        <Textarea id="f-dx-explanation" label="Explanation (shown as “Why … fits”)" rows={4} maxLength={8000} value={dx.explanation} onChange={(e) => setDx({ explanation: e.target.value })} />
        <Textarea id="f-dx-detailed" label="Detailed explanation (optional)" rows={4} maxLength={8000} value={dx.detailedExplanation} onChange={(e) => setDx({ detailedExplanation: e.target.value })} />
        <LinesField id="f-dx-findings" label="Decisive findings (shown as “Key clues”)" value={dx.decisiveFindings} onChange={(v) => setDx({ decisiveFindings: v })} />
        <Textarea id="f-dx-final" label="Final reasoning (optional)" rows={3} maxLength={8000} value={dx.finalReasoning} onChange={(e) => setDx({ finalReasoning: e.target.value })} />
      </EditorSection>

      {/* 4 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-differentials" number={4} title="Differential diagnoses" summary={`${draft.differentialDiagnoses.length} added`} issues={issuesIn("differentials")}>
        {draft.differentialDiagnoses.map((d, i) => (
          <fieldset key={i} className="grid gap-3 rounded-xl border border-line-strong bg-canvas p-3">
            <legend className="px-1 text-sm font-semibold">Differential {i + 1}</legend>
            <RowTools index={i} count={draft.differentialDiagnoses.length} onMove={(to) => diffs.move(i, to)} onRemove={() => diffs.remove(i)} label={`differential ${i + 1}`} />
            <div className="grid gap-3 sm:grid-cols-2">
              <ConditionAutocomplete id={`f-diff-${i}-name`} label="Name" value={d.name} onChange={(v) => diffs.set(i, { name: v })} />
              <LinesField id={`f-diff-${i}-aliases`} label="Aliases" rows={2} value={d.aliases} onChange={(v) => diffs.set(i, { aliases: v })} />
            </div>
            <Textarea id={`f-diff-${i}-considered`} label="Why considered" rows={2} maxLength={1000} value={d.whyConsidered} onChange={(e) => diffs.set(i, { whyConsidered: e.target.value })} />
            <Textarea id={`f-diff-${i}-rejected`} label="Why rejected" rows={2} maxLength={1000} value={d.whyRejected} onChange={(e) => diffs.set(i, { whyRejected: e.target.value })} hint="Shown in “Why the other answers fit less well”." />
            <Textarea id={`f-diff-${i}-explanation`} label="Clinical explanation (optional)" rows={2} maxLength={4000} value={d.clinicalExplanation} onChange={(e) => diffs.set(i, { clinicalExplanation: e.target.value })} />
            <LinesField id={`f-diff-${i}-xref`} label="Cross-references (optional)" rows={2} value={d.crossReferences} onChange={(v) => diffs.set(i, { crossReferences: v })} />
          </fieldset>
        ))}
        <Button variant="secondary" className="justify-self-start" disabled={draft.differentialDiagnoses.length >= LIMITS.maxDifferentials} onClick={() => update((d) => ({ differentialDiagnoses: [...d.differentialDiagnoses, emptyDifferential()] }))}>
          + Add differential diagnosis
        </Button>
      </EditorSection>

      {/* 5 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-wrong" number={5} title="Wrong answer explanations" summary={`${draft.wrongAnswerExplanations.length} added`} issues={issuesIn("wrongAnswers")}>
        <p className="text-sm text-ink-muted">Specific feedback when a learner picks this answer. If none matches, learners see the general explanation, as today.</p>
        {draft.wrongAnswerExplanations.map((w, i) => (
          <fieldset key={i} className="grid gap-3 rounded-xl border border-line-strong bg-canvas p-3">
            <legend className="px-1 text-sm font-semibold">Wrong answer {i + 1}</legend>
            <RowTools index={i} count={draft.wrongAnswerExplanations.length} onMove={(to) => wrongs.move(i, to)} onRemove={() => wrongs.remove(i)} label={`wrong answer ${i + 1}`} />
            <div className="grid gap-3 sm:grid-cols-2">
              <ConditionAutocomplete id={`f-wrong-${i}-condition`} label="Condition" value={w.condition} onChange={(v) => wrongs.set(i, { condition: v })} hint="Matched to the learner's chosen option by name or alias." />
              <LinesField id={`f-wrong-${i}-aliases`} label="Aliases" rows={2} value={w.aliases} onChange={(v) => wrongs.set(i, { aliases: v })} />
            </div>
            <Textarea id={`f-wrong-${i}-explanation`} label="Explanation" rows={3} maxLength={4000} value={w.explanation} onChange={(e) => wrongs.set(i, { explanation: e.target.value })} />
            <LinesField id={`f-wrong-${i}-missed`} label="Missed clues" rows={2} value={w.missedClues} onChange={(v) => wrongs.set(i, { missedClues: v })} />
            <Textarea id={`f-wrong-${i}-direction`} label="Better direction" rows={2} maxLength={2000} value={w.betterDirection} onChange={(e) => wrongs.set(i, { betterDirection: e.target.value })} />
          </fieldset>
        ))}
        <Button variant="secondary" className="justify-self-start" disabled={draft.wrongAnswerExplanations.length >= LIMITS.maxWrongAnswers} onClick={() => update((d) => ({ wrongAnswerExplanations: [...d.wrongAnswerExplanations, emptyWrongAnswer()] }))}>
          + Add wrong-answer explanation
        </Button>
      </EditorSection>

      {/* 6 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-investigations" number={6} title="Investigations" summary={`${investigationCount} results across stages`}>
        <p className="text-sm text-ink-muted">
          Test results are added to each stage in section 2, so learners see them only when they reach that stage. WiseCases never invents or fills in results.
        </p>
        <ul className="grid gap-1 text-sm">
          {draft.stages.map((s, i) =>
            s.investigations.length > 0 ? (
              <li key={s.id}>
                Stage {i + 1} ({s.title || "untitled"}): {s.investigations.map((inv) => inv.name || "unnamed test").join(", ")}
              </li>
            ) : null,
          )}
        </ul>
        <Textarea id="f-inv-summary" label="Investigation summary (optional)" rows={3} maxLength={8000} value={draft.investigationSummary} onChange={(e) => update({ investigationSummary: e.target.value })} />
      </EditorSection>

      {/* 7 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-reasoning" number={7} title="Clinical reasoning">
        <Textarea id="f-summary-clinical" label="Clinical summary (optional)" rows={3} maxLength={8000} value={draft.clinicalSummary} onChange={(e) => update({ clinicalSummary: e.target.value })} />
        <Textarea id="f-reasoning" label="Diagnostic reasoning (optional)" rows={4} maxLength={8000} value={draft.diagnosticReasoning} onChange={(e) => update({ diagnosticReasoning: e.target.value })} />
        <Textarea id="f-wrong-turns" label="Where reasoning can go wrong (optional)" rows={3} maxLength={8000} value={draft.whereReasoningCanGoWrong} onChange={(e) => update({ whereReasoningCanGoWrong: e.target.value })} />
      </EditorSection>

      {/* 8 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-insight" number={8} title="Clinical insight">
        <Textarea id="f-insight" label="Clinical insight (optional)" rows={3} maxLength={8000} value={draft.clinicalInsight} onChange={(e) => update({ clinicalInsight: e.target.value })} hint="The take-home insight shown at the end." />
      </EditorSection>

      {/* 9 ------------------------------------------------------------------------------------------ */}
      <EditorSection id="section-learning" number={9} title="Learning points" summary={`${draft.learningPoints.length} added`} issues={issuesIn("learning")}>
        <LinesField id="f-learning" label="Learning points" rows={5} value={draft.learningPoints} onChange={(v) => update({ learningPoints: v })} hint={`One per line (up to ${LIMITS.maxListItems}).`} />
      </EditorSection>

      {/* 10 ----------------------------------------------------------------------------------------- */}
      <EditorSection id="section-references" number={10} title="References" summary={`${draft.references.length} added`} issues={issuesIn("references")}>
        {draft.references.map((r, i) => (
          <fieldset key={r.id} className="grid gap-3 rounded-xl border border-line-strong bg-canvas p-3">
            <legend className="px-1 text-sm font-semibold">Reference {i + 1}</legend>
            <RowTools index={i} count={draft.references.length} onMove={(to) => refs.move(i, to)} onRemove={() => refs.remove(i)} label={`reference ${i + 1}`} />
            <Input id={`f-ref-${i}-title`} label="Title" maxLength={500} value={r.title} onChange={(e) => refs.set(i, { title: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input id={`f-ref-${i}-authors`} label="Authors" maxLength={500} value={r.authors} onChange={(e) => refs.set(i, { authors: e.target.value })} />
              <Input id={`f-ref-${i}-source`} label="Source" maxLength={300} value={r.source} onChange={(e) => refs.set(i, { source: e.target.value })} />
              <Input id={`f-ref-${i}-year`} type="number" label="Year" min={1500} max={2100} value={r.year ?? ""} onChange={(e) => refs.set(i, { year: e.target.value === "" ? null : Number(e.target.value) })} />
              <Input id={`f-ref-${i}-url`} type="url" label="Web address" maxLength={2000} value={r.url} onChange={(e) => refs.set(i, { url: e.target.value })} />
              <Input id={`f-ref-${i}-doi`} label="DOI" maxLength={200} value={r.doi} onChange={(e) => refs.set(i, { doi: e.target.value })} />
              <Select id={`f-ref-${i}-type`} label="Type" value={r.refType} onChange={(e) => refs.set(i, { refType: e.target.value as DraftReference["refType"] })}>
                {REFERENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" className="size-5 accent-teal" checked={r.verified && !r.isPlaceholder} onChange={(e) => refs.set(i, { verified: e.target.checked, isPlaceholder: false })} />
              I have checked this reference (otherwise learners see “not verified”)
            </label>
          </fieldset>
        ))}
        <Button variant="secondary" className="justify-self-start" disabled={draft.references.length >= LIMITS.maxReferences} onClick={() => update((d) => ({ references: [...d.references, emptyReference(uuidv4)] }))}>
          + Add reference
        </Button>
      </EditorSection>

      <div id="validation-result" className="grid scroll-mt-24 gap-4">
        {check && <ValidationReport title="Validation" items={check.items} />}
        {check && <DuplicateList newCase={{ caseCode: draft.caseCode, title: draft.title }} duplicates={check.duplicates} />}
      </div>

      {/* Save bar ------------------------------------------------------------------------------------ */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto grid max-w-5xl gap-2 px-4 py-3">
          {save.kind === "error" && (
            <div role="alert" className="max-h-32 overflow-y-auto rounded-lg bg-red-soft px-3 py-2 text-sm">
              <p className="font-semibold">{save.message}</p>
              {save.issues.length > 0 && (
                <ul className="list-disc pl-5">
                  {save.issues.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              {save.conflict && (
                <button type="button" className="mt-1 font-semibold text-wise-blue underline" onClick={() => window.location.reload()}>
                  Reload the latest version (your unsaved changes will be lost)
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void doSave()} loading={save.kind === "saving"} disabled={!dirty && save.kind !== "error"}>
              Save draft
            </Button>
            <Button variant="secondary" onClick={() => void validate()} loading={checking}>
              Validate
            </Button>
            <Link
              href={`/admin/cases/${draft.id}/preview`}
              className={buttonClasses("secondary")}
              onClick={(e) => {
                if (dirty && !window.confirm("Preview shows the last SAVED version. Continue without saving?")) e.preventDefault();
              }}
            >
              Preview
            </Link>
            <a href={`/api/admin/cases/${draft.id}/export`} className={buttonClasses("ghost")}>
              Export JSON
            </a>
            <Link href={`/admin/cases/${draft.id}`} className={buttonClasses("ghost")}>
              Case page
            </Link>
            <span role="status" className="ml-auto text-sm text-ink-muted">
              {save.kind === "saving" ? "Saving…" : dirty ? "Unsaved changes" : save.kind === "saved" ? "All changes saved" : "No changes"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
