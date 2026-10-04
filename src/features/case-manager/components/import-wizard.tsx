"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/state-views";
import type { DocumentCheck } from "@/features/admin/admin-case-service";
import { parseJsonText } from "@/features/case-manager/parse-json";
import { cn } from "@/lib/utils/cn";
import { adminRequest } from "../admin-api";
import { DuplicateList, ValidationReport } from "./validation-report";

const MAX_FILE_BYTES = 1024 * 1024;
const STEPS = ["Choose file", "Validate", "Review", "Import"] as const;

type State =
  | { step: "choose"; error: string | null }
  | { step: "checking"; fileName: string }
  | { step: "review"; fileName: string; document: unknown; check: DocumentCheck; allowDuplicates: boolean; error: string | null }
  | { step: "importing"; fileName: string }
  | { step: "done"; caseId: string; title: string };

/**
 * Choose JSON file → parse → validate (server) → check duplicates (server) → report → review → confirm →
 * create a DRAFT. The server repeats every check when importing; the browser is never trusted.
 */
export function ImportWizard() {
  const [state, setState] = useState<State>({ step: "choose", error: null });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setState({ step: "choose", error: `“${file.name}” is too large (limit 1 MB).` });
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
      return setState({ step: "choose", error: `“${file.name}” is not a .json file.` });
    }
    const parsed = parseJsonText(await file.text());
    if (!parsed.ok) return setState({ step: "choose", error: `${file.name}: ${parsed.message}` });
    setState({ step: "checking", fileName: file.name });
    const res = await adminRequest<DocumentCheck>("/api/admin/import/validate", { method: "POST", body: { document: parsed.value } });
    if (!res.ok) return setState({ step: "choose", error: [res.message, ...res.issues].join(" ") });
    setState({ step: "review", fileName: file.name, document: parsed.value, check: res.data, allowDuplicates: false, error: null });
  };

  const confirmImport = async () => {
    if (state.step !== "review") return;
    const { document, allowDuplicates, fileName, check } = state;
    setState({ step: "importing", fileName });
    const res = await adminRequest<{ caseId: string }>("/api/admin/import", { method: "POST", body: { document, allowDuplicates } });
    if (res.ok) return setState({ step: "done", caseId: res.data.caseId, title: check.summary?.title ?? "" });
    setState({ ...state, error: [res.message, ...res.issues].join(" ") });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void readFile(e.dataTransfer.files[0]);
  };
  const reset = () => {
    if (input.current) input.current.value = "";
    setState({ step: "choose", error: null });
  };

  const current = { choose: 0, checking: 1, review: 2, importing: 3, done: 3 }[state.step];
  return (
    <div className="grid gap-5">
      <ol aria-label="Import steps" className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === current ? "step" : undefined} className={cn("rounded-full px-3 py-1 font-semibold", i === current ? "bg-wise-blue text-white" : i < current ? "bg-teal-soft text-teal" : "bg-surface text-ink-subtle ring-1 ring-line")}>
            {i < current ? "✓ " : `${i + 1}. `}
            {label}
          </li>
        ))}
      </ol>

      {state.step === "choose" && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn("grid justify-items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center sm:p-12", dragging ? "border-wise-blue bg-blue-soft" : "border-line-strong bg-surface")}
          >
            <p className="text-lg font-semibold">Drag a case JSON file here</p>
            <p className="text-sm text-ink-muted">or</p>
            <input ref={input} id="import-file" type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
            <label htmlFor="import-file" className={buttonClasses("primary", "lg", "cursor-pointer")}>
              Choose JSON file
            </label>
            <p className="text-xs text-ink-subtle">One case per file, up to 1 MB.</p>
          </div>
          {state.error && <ErrorState title="That file cannot be imported" message={state.error} />}
        </>
      )}

      {(state.step === "checking" || state.step === "importing") && (
        <Card role="status" className="grid gap-2">
          <p className="font-semibold">{state.step === "checking" ? `Validating ${state.fileName}…` : `Importing ${state.fileName}…`}</p>
          <div className="h-2 w-full animate-pulse rounded bg-blue-soft" />
        </Card>
      )}

      {state.step === "review" && (
        <>
          {state.check.summary && (
            <Card className="grid gap-2">
              <p className="text-xs font-semibold tracking-wider text-ink-subtle uppercase">Review · {state.fileName}</p>
              <p className="text-xl font-bold">
                <span className="mr-2 font-mono text-base text-ink-muted">{state.check.summary.caseCode}</span>
                {state.check.summary.title}
              </p>
              <p className="text-sm text-ink-muted">
                {[state.check.summary.category, state.check.summary.subcategory, state.check.summary.difficulty.toLowerCase(), `${state.check.summary.stageCount} stages`, `${state.check.summary.differentialCount} differentials`].filter(Boolean).join(" · ")}
              </p>
              <p className="text-sm">
                Diagnosis: <span className="font-semibold">{state.check.summary.diagnosis}</span>
              </p>
            </Card>
          )}
          <ValidationReport title="Import validation" items={state.check.items} />
          {state.check.summary && (
            <DuplicateList
              newCase={{ caseCode: state.check.summary.caseCode, title: state.check.summary.title }}
              duplicates={state.check.duplicates}
              actions={
                state.check.ok && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant={state.allowDuplicates ? "primary" : "secondary"} onClick={() => setState({ ...state, allowDuplicates: true })} aria-pressed={state.allowDuplicates}>
                      {state.allowDuplicates ? "✓ Add anyway (confirmed)" : "Add anyway"}
                    </Button>
                    <Button variant="ghost" onClick={reset}>
                      Cancel
                    </Button>
                  </div>
                )
              }
            />
          )}
          {state.error && <ErrorState title="Import failed" message={state.error} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={() => void confirmImport()} disabled={!state.check.ok || (state.check.duplicates.length > 0 && !state.allowDuplicates)}>
              Confirm import as draft
            </Button>
            <Button variant="secondary" onClick={reset}>
              Choose another file
            </Button>
            <span className="text-sm text-ink-muted">
              {!state.check.ok ? "Fix the problems in the file, then choose it again." : state.check.duplicates.length > 0 && !state.allowDuplicates ? "Review the possible duplicate first." : "Nothing is published. The case is created as a draft."}
            </span>
          </div>
        </>
      )}

      {state.step === "done" && (
        <Card className="grid gap-3">
          <p className="text-lg font-semibold">✓ Imported “{state.title}” as a draft.</p>
          <p className="text-sm text-ink-muted">Learners cannot see it until a super administrator publishes it.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/cases/${state.caseId}/edit`} className={buttonClasses("primary")}>
              Open in editor
            </Link>
            <Link href={`/admin/cases/${state.caseId}/preview`} className={buttonClasses("secondary")}>
              Preview as learner
            </Link>
            <Button variant="ghost" onClick={reset}>
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
