import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { CaseCard } from "@/features/cases/components/case-card";
import { getContainer } from "@/lib/server/container";

/** Case content comes from the database at request time. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { items } = await getContainer().cases.listPublished({ limit: 3 });
  return (
    <div className="grid gap-10">
      <section className="grid gap-4 py-4 sm:py-8">
        <p className="text-sm font-semibold tracking-wider text-wise-blue uppercase">Think. Diagnose. Learn.</p>
        <h1 className="max-w-3xl text-4xl font-bold text-balance sm:text-5xl">
          Every clue brings you <span className="text-wise-red">closer</span>.
        </h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          Read a case and choose an answer. Each wrong answer costs a life and reveals the next clue, until you solve it or
          run out of lives. Every ending explains the reasoning.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/play" className={buttonClasses("primary", "lg")}>
            Browse cases
          </Link>
        </div>
      </section>
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Try a demo case</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <CaseCard key={s.id} summary={s} />
          ))}
        </div>
      </section>
    </div>
  );
}
