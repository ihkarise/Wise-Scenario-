import { z } from "zod";
import {
  COMPLETION_MODES,
  DIFFICULTIES,
  MEDIA_KINDS,
  PUBLICATION_STATUSES,
  TERMINAL_BEHAVIORS,
  type CaseDefinition,
} from "@/lib/engine/types";
import { contentIdSchema, slugSchema } from "./ids";

/**
 * Runtime validation for case CONTENT. Every case is parsed with this before the engine sees it,
 * whether it comes from demo data, the database, or (later) a JSON import.
 * Messages are written for authors, because the Case Builder will show them.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

const answerOptionSchema = z.object({
  id: contentIdSchema,
  label: text(300),
  isCorrect: z.boolean(),
});

const singleChoiceSchema = z.object({
  type: z.literal("SINGLE_CHOICE"),
  options: z.array(answerOptionSchema).min(2, "needs at least 2 answer options").max(12),
});

const mediaSchema = z.object({
  id: contentIdSchema,
  kind: z.enum(MEDIA_KINDS),
  url: z.url(),
  altText: text(300),
  caption: z.string().max(500).optional(),
  credit: z.string().max(300).optional(),
  license: z.string().max(200).optional(),
});

const stageSchema = z.object({
  id: contentIdSchema,
  order: z.int().min(1),
  title: text(120),
  content: text(4000),
  question: text(500),
  interaction: z.discriminatedUnion("type", [singleChoiceSchema]),
  explanation: z.string().max(4000).optional(),
  hint: z.string().max(500).optional(),
  media: z.array(mediaSchema).max(10),
  lifeCost: z.int().min(0).max(20),
  showPreviousClues: z.boolean(),
});

const referenceSchema = z.object({
  id: contentIdSchema,
  title: text(500),
  authors: z.string().max(500).optional(),
  source: z.string().max(300).optional(),
  year: z.int().min(1500).max(2100).optional(),
  url: z.url().optional(),
  doi: z.string().max(200).optional(),
  pages: z.string().max(50).optional(),
  isPlaceholder: z.boolean(),
});

const caseObjectSchema = z.object({
  id: contentIdSchema,
  slug: slugSchema,
  caseNumber: z.int().min(1),
  version: z.int().min(1),
  title: text(200),
  summary: z.string().max(500),
  domain: text(80),
  category: text(80),
  difficulty: z.enum(DIFFICULTIES),
  publicationStatus: z.enum(PUBLICATION_STATUSES),
  maxLives: z.int().min(1, "needs at least 1 life").max(20),
  terminalBehavior: z.enum(TERMINAL_BEHAVIORS),
  completionMode: z.enum(COMPLETION_MODES),
  revealCorrectOptionOnWrong: z.boolean(),
  stages: z.array(stageSchema).min(1, "needs at least 1 stage").max(50),
  teaching: z.object({
    answerLabel: text(300),
    finalExplanation: text(8000),
    keyClues: z.array(text(500)).max(20),
    learningPoints: z.array(text(500)).max(20),
    differentials: z.array(z.object({ label: text(200), reason: text(1000) })).max(20),
  }),
  references: z.array(referenceSchema).max(30),
  isDemo: z.boolean(),
});

export const caseDefinitionSchema: z.ZodType<CaseDefinition> = caseObjectSchema.superRefine((c, ctx) => {
  const orders = c.stages.map((s) => s.order).sort((a, b) => a - b);
  orders.forEach((order, i) => {
    if (order !== i + 1) {
      ctx.addIssue({ code: "custom", path: ["stages"], message: "Stage order must run 1, 2, 3 … without gaps or repeats." });
    }
  });

  const stageIds = new Set<string>();
  const optionIds = new Set<string>();
  for (const stage of c.stages) {
    const label = `Stage ${stage.order}`;
    if (stageIds.has(stage.id)) ctx.addIssue({ code: "custom", path: ["stages"], message: `${label} reuses a stage ID.` });
    stageIds.add(stage.id);

    const correct = stage.interaction.options.filter((o) => o.isCorrect).length;
    if (correct === 0) ctx.addIssue({ code: "custom", path: ["stages"], message: `${label} has no correct answer.` });
    if (correct > 1) ctx.addIssue({ code: "custom", path: ["stages"], message: `${label} has more than one correct answer.` });

    for (const option of stage.interaction.options) {
      if (optionIds.has(option.id)) {
        ctx.addIssue({ code: "custom", path: ["stages"], message: `${label} reuses an answer option ID.` });
      }
      optionIds.add(option.id);
    }
    if (stage.lifeCost > c.maxLives) {
      ctx.addIssue({ code: "custom", path: ["stages"], message: `${label} costs more lives than the case has.` });
    }
  }
});

export function parseCaseDefinition(input: unknown): CaseDefinition {
  return caseDefinitionSchema.parse(input);
}
