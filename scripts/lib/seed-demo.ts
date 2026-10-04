import { randomUUID } from "node:crypto";
import type { Sql } from "../../src/lib/db/client";
import type { CaseDefinition } from "../../src/lib/engine/types";
import { parseCaseDefinition } from "../../src/lib/schemas/case";
import { slugify } from "../../src/features/admin/draft";
import { DEMO_CASES } from "../../src/features/cases/demo/demo-cases";

const DOMAIN_TYPE: Record<string, string> = {
  "Medical Diagnosis": "medical",
  "Materia Medica": "materia_medica",
  Repertory: "repertory",
};

export type SeedResult = { created: string[]; skipped: string[] };

/**
 * Loads the demo cases into the database as ordinary records: an editable working copy plus, for
 * published demos, a frozen version-1 snapshot that learners play. Idempotent: existing slugs are skipped.
 * After this, the database is the only source of case content for the app.
 */
export async function seedDemoCases(sql: Sql, cases: readonly CaseDefinition[] = DEMO_CASES): Promise<SeedResult> {
  const result: SeedResult = { created: [], skipped: [] };
  for (const demo of cases) {
    const [existing] = await sql`select id from public.cases where slug = ${demo.slug}`;
    if (existing) {
      result.skipped.push(demo.slug);
      continue;
    }
    await sql.begin(async (tx) => {
      const [domain] = await tx<{ id: string }[]>`
        insert into public.domains (name, slug, domain_type)
        values (${demo.domain}, ${slugify(demo.domain)}, ${DOMAIN_TYPE[demo.domain] ?? "general"})
        on conflict (slug) do update set name = public.domains.name
        returning id`;
      const [category] = await tx<{ id: string }[]>`
        insert into public.categories (domain_id, name, slug) values (${domain!.id}, ${demo.category}, ${slugify(demo.category)})
        on conflict (domain_id, slug) do update set name = public.categories.name
        returning id`;
      const [numberTaken] = await tx`select 1 from public.cases where case_number = ${demo.caseNumber}`;

      const caseId = randomUUID();
      const stages = [...demo.stages]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ ...s, id: randomUUID(), interaction: { ...s.interaction, options: s.interaction.options.map((o) => ({ ...o, id: randomUUID() })) } }));
      const references = demo.references.map((r) => ({ ...r, id: randomUUID() }));

      const [row] = await tx<{ case_number: number }[]>`
        insert into public.cases (id, slug, ${numberTaken ? tx`` : tx`case_number,`} title, summary, domain_id, category_id,
          difficulty, max_lives, terminal_behavior, reveal_correct_option_on_wrong, status, answer_label,
          final_explanation, key_clues, learning_points, differentials, is_demo)
        values (${caseId}, ${demo.slug}, ${numberTaken ? tx`` : tx`${demo.caseNumber},`} ${demo.title}, ${demo.summary},
          ${domain!.id}, ${category!.id}, ${demo.difficulty}, ${demo.maxLives}, ${demo.terminalBehavior},
          ${demo.revealCorrectOptionOnWrong}, 'DRAFT', ${demo.teaching.answerLabel}, ${demo.teaching.finalExplanation},
          ${tx.json(demo.teaching.keyClues)}, ${tx.json(demo.teaching.learningPoints)}, ${tx.json(demo.teaching.differentials)}, true)
        returning case_number`;

      await tx`insert into public.case_stages ${tx(
        stages.map((s, i) => ({
          id: s.id,
          case_id: caseId,
          position: i + 1,
          title: s.title,
          content: s.content,
          question: s.question,
          hint: s.hint ?? null,
          explanation: s.explanation ?? null,
          life_cost: s.lifeCost,
          show_previous_clues: s.showPreviousClues,
        })),
      )}`;
      await tx`insert into public.stage_options ${tx(
        stages.flatMap((s) => s.interaction.options.map((o, j) => ({ id: o.id, stage_id: s.id, position: j + 1, label: o.label, is_correct: o.isCorrect }))),
      )}`;
      if (references.length > 0) {
        await tx`insert into public.case_references ${tx(
          references.map((r, i) => ({ id: r.id, case_id: caseId, position: i + 1, title: r.title, is_placeholder: r.isPlaceholder, verified: false })),
        )}`;
      }

      if (demo.publicationStatus === "PUBLISHED") {
        const snapshot = parseCaseDefinition({
          ...demo,
          id: caseId,
          caseNumber: row!.case_number,
          version: 1,
          publicationStatus: "PUBLISHED",
          stages: stages.map((s, i) => ({ ...s, order: i + 1 })),
          references,
        });
        await tx`
          insert into public.case_versions (case_id, version, snapshot, case_number, slug, title, summary, domain, category,
            difficulty, max_lives, stage_count, is_demo)
          values (${caseId}, 1, ${tx.json(snapshot as unknown as Parameters<typeof tx.json>[0])}, ${snapshot.caseNumber}, ${snapshot.slug},
            ${snapshot.title}, ${snapshot.summary}, ${snapshot.domain}, ${snapshot.category}, ${snapshot.difficulty},
            ${snapshot.maxLives}, ${snapshot.stages.length}, true)`;
        await tx`update public.cases set status = 'PUBLISHED', published_version = 1, published_at = now() where id = ${caseId}`;
      }
    });
    result.created.push(demo.slug);
  }
  // Keep automatic case numbers ahead of the explicit demo numbers.
  await sql`select setval(pg_get_serial_sequence('public.cases', 'case_number'), greatest((select coalesce(max(case_number), 0) from public.cases), 1))`;
  return result;
}
