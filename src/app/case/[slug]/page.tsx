import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { toCaseSummary } from "@/features/cases/case-repository";
import { CasePlayer } from "@/features/player/components/case-player";
import { slugSchema } from "@/lib/schemas/ids";
import { getContainer } from "@/lib/server/container";
import { getRequestActor } from "@/lib/server/request-actor";

type Params = { params: Promise<{ slug: string }> };

async function loadPublished(rawSlug: string) {
  const slug = slugSchema.safeParse(rawSlug);
  if (!slug.success) return null;
  const caseDef = await getContainer().cases.findBySlug(slug.data);
  return caseDef && caseDef.publicationStatus === "PUBLISHED" ? caseDef : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const caseDef = await loadPublished((await params).slug);
  return caseDef ? { title: caseDef.title, description: caseDef.summary } : { title: "Case not available" };
}

/**
 * The full case is loaded on the server only. The client receives a content-free summary and,
 * if the learner already has an attempt in progress, the server-built PlayerView for it.
 */
export default async function CasePage({ params }: Params) {
  const caseDef = await loadPublished((await params).slug);
  if (!caseDef) notFound();

  const actor = await getRequestActor();
  const initialView = await getContainer().attemptService.getActiveView(actor, caseDef.slug);

  return (
    <div className="mx-auto max-w-2xl">
      <CasePlayer summary={toCaseSummary(caseDef)} initialView={initialView} />
    </div>
  );
}
