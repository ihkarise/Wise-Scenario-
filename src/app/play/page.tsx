import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state-views";
import { CaseCard } from "@/features/cases/components/case-card";
import { getContainer } from "@/lib/server/container";

export const metadata: Metadata = { title: "Cases" };

const PAGE_SIZE = 24;

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  const { after } = await searchParams;
  const cursor = after && /^\d{1,9}$/.test(after) ? after : null;
  const { items, nextCursor } = await getContainer().cases.listPublished({ limit: PAGE_SIZE, cursor });

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-3xl font-bold">Cases</h1>
        <p className="text-ink-muted">Pick a case. Lives and clues vary from case to case.</p>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No cases yet" message="Published cases will appear here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <CaseCard key={s.id} summary={s} />
          ))}
        </div>
      )}
      {nextCursor && (
        <Link href={`/play?after=${nextCursor}`} className={buttonClasses("secondary", "md", "justify-self-center")}>
          More cases
        </Link>
      )}
    </div>
  );
}
