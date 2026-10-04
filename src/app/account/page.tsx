import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/state-views";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const STATUS: Record<string, { label: string; tone: "teal" | "red" | "blue" | "neutral" }> = {
  COMPLETED_SUCCESS: { label: "Solved", tone: "teal" },
  COMPLETED_FAILED: { label: "Not solved", tone: "red" },
  IN_PROGRESS: { label: "In progress", tone: "blue" },
  NOT_STARTED: { label: "Not started", tone: "neutral" },
};

export default async function AccountPage() {
  const actor = await getRequestActor();
  if (!actor || actor.kind !== "user") redirect("/sign-in?next=/account");
  const history = await getContainer().attemptService.history(actor, 20);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Card className="grid gap-3">
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="text-ink-muted">{actor.email}</p>
        <div className="flex flex-wrap gap-2">
          {actor.roles.map((r) => (
            <Badge key={r} tone={r === "LEARNER" ? "neutral" : "navy"}>
              {r.replace("_", " ")}
            </Badge>
          ))}
        </div>
      </Card>
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Recent cases</h2>
        {history.length === 0 ? (
          <EmptyState
            title="No cases yet"
            message="Cases you play while signed in appear here."
            action={
              <Link href="/play" className={buttonClasses("primary")}>
                Browse cases
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-2">
            {history.map((h) => (
              <li key={h.attemptId} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                <Link href={`/case/${h.caseSlug}`} className="min-w-0 flex-1 font-semibold text-wise-blue underline-offset-2 hover:underline">
                  {h.caseTitle}
                </Link>
                <Badge tone={STATUS[h.status]?.tone ?? "neutral"}>{STATUS[h.status]?.label ?? h.status}</Badge>
                {h.status !== "IN_PROGRESS" && <span className="text-sm text-ink-muted tabular-nums">Score {h.score ?? 0}</span>}
                <span className="text-xs text-ink-subtle">{h.startedAt ? new Date(h.startedAt).toLocaleDateString("en-GB") : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
