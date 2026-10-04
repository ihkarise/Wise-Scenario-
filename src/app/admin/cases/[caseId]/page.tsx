import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InvestigationTable } from "@/components/ui/investigation-table";
import { checkReadiness, TERMINAL_BEHAVIOR_LABEL } from "@/features/admin/draft";
import type { CheckItem } from "@/features/case-manager/case-document";
import { CaseActions } from "@/features/case-manager/components/case-actions";
import { StatusBadge } from "@/features/case-manager/components/status-badge";
import { DuplicateList, ValidationReport } from "@/features/case-manager/components/validation-report";
import { loadOr404 } from "@/features/case-manager/load-case";
import { DIFFICULTY_LABEL } from "@/features/player/labels";
import { can } from "@/lib/auth/actor";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Case" };

type Params = { params: Promise<{ caseId: string }> };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-ink-subtle uppercase">{title}</h2>
      {children}
    </section>
  );
}
const Empty = () => <p className="text-sm text-ink-subtle">Not written yet.</p>;

export default async function CasePage({ params }: Params) {
  const actor = await getRequestActor();
  const admin = getContainer().admin!;
  const { caseId } = await params;
  const draft = await loadOr404(caseId, (id) => admin.getDraft(actor, id));
  const duplicates = await admin.duplicatesOf(actor, draft.id);
  const readiness = checkReadiness(draft);
  const canEdit = can(actor, "case:edit");
  const dx = draft.diagnosis;

  const report: CheckItem[] = [
    readiness.canPreview ? { level: "ok", message: "Ready to preview" } : { level: "error", message: "Not ready to preview" },
    readiness.canPublish ? { level: "ok", message: "Ready to publish" } : { level: "error", message: "Not ready to publish" },
    ...readiness.playErrors.map((i): CheckItem => ({ level: "error", message: i.message })),
    ...readiness.publishErrors.map((i): CheckItem => ({ level: "error", message: `Before publishing: ${i.message}` })),
    ...readiness.warnings.map((i): CheckItem => ({ level: "warning", message: i.message })),
  ];

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span className="font-mono">{draft.caseCode}</span>
          <StatusBadge status={draft.status} changed={draft.hasUnpublishedChanges} />
          <span>{draft.publishedVersion ? `Live version v${draft.publishedVersion}` : "Never published"}</span>
          {draft.isDemo && <Badge tone="amber">DEMO CONTENT</Badge>}
        </div>
        <h1 className="text-3xl font-bold text-balance">{draft.title}</h1>
        <p className="text-sm text-ink-muted">
          Last updated {new Date(draft.updatedAt).toUTCString()} · Web address /case/{draft.slug}
        </p>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Link href={`/admin/cases/${draft.id}/edit`} className={buttonClasses("primary")}>
              Edit
            </Link>
          )}
          <Link href={`/admin/cases/${draft.id}/preview`} className={buttonClasses("secondary")}>
            Preview as learner
          </Link>
          <a href={`/api/admin/cases/${draft.id}/export`} className={buttonClasses("secondary")}>
            Export JSON
          </a>
          {draft.status === "PUBLISHED" && (
            <Link href={`/case/${draft.slug}`} className={buttonClasses("ghost")}>
              Open live case
            </Link>
          )}
        </div>
        <CaseActions caseId={draft.id} title={draft.title} status={draft.status} hasUnpublishedChanges={draft.hasUnpublishedChanges} canEdit={canEdit} canPublish={can(actor, "case:publish")} />
      </header>

      <ValidationReport title="Readiness" items={report} />
      <DuplicateList newCase={{ caseCode: draft.caseCode, title: draft.title }} duplicates={duplicates} />

      <Card className="grid gap-6">
        <Block title="Basic information">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-ink-muted">Category</dt>
            <dd>{[draft.category || "—", draft.subcategory].filter(Boolean).join(" › ")}</dd>
            <dt className="font-semibold text-ink-muted">Difficulty</dt>
            <dd>{DIFFICULTY_LABEL[draft.difficulty]}</dd>
            <dt className="font-semibold text-ink-muted">Lives</dt>
            <dd>
              {draft.maxLives} (usually {draft.lifeLossPerWrong} lost per wrong answer)
            </dd>
            <dt className="font-semibold text-ink-muted">Score settings</dt>
            <dd>
              {draft.startingScore === null ? "Not set" : `Starts at ${draft.startingScore}`}
              {draft.wrongAnswerPenalty !== null ? `, −${draft.wrongAnswerPenalty} per wrong answer` : ""} (saved; the game keeps its existing scoring)
            </dd>
            <dt className="font-semibold text-ink-muted">Last stage</dt>
            <dd>{TERMINAL_BEHAVIOR_LABEL[draft.terminalBehavior].title}</dd>
            <dt className="font-semibold text-ink-muted">Summary</dt>
            <dd>{draft.summary || "—"}</dd>
          </dl>
        </Block>

        <Block title={`Stages (${draft.stages.length})`}>
          {draft.stages.length === 0 ? (
            <Empty />
          ) : (
            <ol className="grid gap-2">
              {draft.stages.map((s, i) => (
                <li key={s.id} className="grid gap-1 rounded-xl bg-canvas p-3 text-sm">
                  <span className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                    Stage {i + 1} · {s.title}
                  </span>
                  <p className="whitespace-pre-line">{s.content}</p>
                  {s.investigations.length > 0 && (
                    <InvestigationTable investigations={s.investigations.map((inv) => ({ name: inv.name, value: inv.value, unit: inv.unit || undefined, referenceRange: inv.referenceRange || undefined, interpretation: inv.interpretation || undefined }))} />
                  )}
                  <p className="text-ink-muted">
                    <span className="font-semibold">{s.question}</span>{" "}
                    {s.options.map((o) => (o.isCorrect ? `✓ ${o.label}` : o.label)).join(" · ")}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Block>

        <Block title="Diagnosis">
          {dx.primary || dx.displayName ? (
            <div className="grid gap-1 text-sm">
              <p className="text-lg font-semibold">{dx.displayName || dx.primary}</p>
              <p className="text-ink-muted">Accepted answers: {dx.acceptedAnswers.join(", ") || "none"} · Aliases: {dx.aliases.join(", ") || "none"}</p>
              {dx.explanation ? <p className="whitespace-pre-line">{dx.explanation}</p> : <Empty />}
            </div>
          ) : (
            <Empty />
          )}
        </Block>

        <Block title={`Differential diagnoses (${draft.differentialDiagnoses.length})`}>
          {draft.differentialDiagnoses.length === 0 ? (
            <Empty />
          ) : (
            <ul className="grid gap-1 text-sm">
              {draft.differentialDiagnoses.map((d, i) => (
                <li key={i}>
                  <span className="font-semibold">{d.name}</span>
                  {d.whyRejected ? `: ${d.whyRejected}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title={`Wrong-answer explanations (${draft.wrongAnswerExplanations.length})`}>
          {draft.wrongAnswerExplanations.length === 0 ? (
            <Empty />
          ) : (
            <ul className="grid gap-1 text-sm">
              {draft.wrongAnswerExplanations.map((w, i) => (
                <li key={i}>
                  <span className="font-semibold">{w.condition}</span>: {w.explanation}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title={`Learning points (${draft.learningPoints.length})`}>
          {draft.learningPoints.length === 0 ? (
            <Empty />
          ) : (
            <ul className="grid list-disc gap-1 pl-5 text-sm">
              {draft.learningPoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </Block>

        <Block title={`References (${draft.references.length})`}>
          {draft.references.length === 0 ? (
            <Empty />
          ) : (
            <ul className="grid gap-1 text-sm">
              {draft.references.map((r) => (
                <li key={r.id}>
                  {r.title}
                  {r.year ? ` (${r.year})` : ""} {r.verified && !r.isPlaceholder ? <Badge tone="teal">Verified</Badge> : <Badge tone="amber">Not verified</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Block>
      </Card>
    </div>
  );
}
