import type { CaseDefinition, Difficulty, Differential, PublicationStatus, TerminalBehavior } from "@/lib/engine/types";
import { parseCaseDefinition } from "@/lib/schemas/case";

/**
 * Compact authoring helper for DEMO content only. Real cases come from the database (Milestone 2).
 * In `options`, a leading "*" marks the correct answer. IDs are derived from the slug so they stay stable.
 */
export type DemoStageInput = {
  title: string;
  content: string;
  question: string;
  options: string[];
  hint?: string;
  lifeCost?: number;
  showPreviousClues?: boolean;
};

export type DemoCaseInput = {
  slug: string;
  caseNumber: number;
  title: string;
  summary: string;
  domain: string;
  category: string;
  difficulty: Difficulty;
  maxLives: number;
  terminalBehavior?: TerminalBehavior;
  revealCorrectOptionOnWrong?: boolean;
  publicationStatus?: PublicationStatus;
  stages: DemoStageInput[];
  answerLabel: string;
  finalExplanation: string;
  keyClues: string[];
  learningPoints: string[];
  differentials: Differential[];
  placeholderReferences: string[];
};

export function buildDemoCase(input: DemoCaseInput): CaseDefinition {
  return parseCaseDefinition({
    id: `demo-${input.caseNumber}`,
    slug: input.slug,
    caseNumber: input.caseNumber,
    version: 1,
    title: input.title,
    summary: input.summary,
    domain: input.domain,
    category: input.category,
    difficulty: input.difficulty,
    publicationStatus: input.publicationStatus ?? "PUBLISHED",
    maxLives: input.maxLives,
    terminalBehavior: input.terminalBehavior ?? "REVEAL_ANSWER",
    completionMode: "FIRST_CORRECT",
    revealCorrectOptionOnWrong: input.revealCorrectOptionOnWrong ?? false,
    stages: input.stages.map((s, i) => ({
      id: `demo-${input.caseNumber}-s${i + 1}`,
      order: i + 1,
      title: s.title,
      content: s.content,
      question: s.question,
      hint: s.hint,
      media: [],
      lifeCost: s.lifeCost ?? 1,
      showPreviousClues: s.showPreviousClues ?? true,
      interaction: {
        type: "SINGLE_CHOICE",
        options: s.options.map((label, j) => ({
          id: `demo-${input.caseNumber}-s${i + 1}-o${j + 1}`,
          label: label.replace(/^\*/, ""),
          isCorrect: label.startsWith("*"),
        })),
      },
    })),
    teaching: {
      answerLabel: input.answerLabel,
      finalExplanation: input.finalExplanation,
      keyClues: input.keyClues,
      learningPoints: input.learningPoints,
      differentials: input.differentials,
    },
    references: input.placeholderReferences.map((title, i) => ({
      id: `demo-${input.caseNumber}-r${i + 1}`,
      title,
      isPlaceholder: true,
    })),
    isDemo: true,
  });
}
