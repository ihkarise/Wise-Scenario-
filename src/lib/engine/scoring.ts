import type { Difficulty } from "./types";

/**
 * Central scoring rules. This is the only place scores are calculated.
 * Milestone 8 moves these numbers into the `scoring_rules` table so an Admin can change them.
 *
 *   score = base × difficultyMultiplier × clueEfficiency × lifeMultiplier   (rounded)
 *   clueEfficiency = 1 − clueWeight × (stageIndexSolved / stageCount)
 *   lifeMultiplier = (1 − lifeWeight) + lifeWeight × (livesRemaining / maxLives)
 *
 * Solving at the first stage with every life left scores the full base × difficulty.
 * A failed case scores 0. Time is recorded but deliberately not scored yet, so results stay
 * deterministic and fair on slow connections.
 */
export type ScoringRules = {
  base: number;
  difficultyMultiplier: Record<Difficulty, number>;
  clueWeight: number;
  lifeWeight: number;
};

export const DEFAULT_SCORING_RULES: ScoringRules = {
  base: 1000,
  difficultyMultiplier: { EASY: 1, INTERMEDIATE: 1.25, HARD: 1.5 },
  clueWeight: 0.5,
  lifeWeight: 0.5,
};

export type ScoreInput = {
  difficulty: Difficulty;
  /** 0-based index of the stage the case was solved at. */
  stageIndexSolved: number;
  stageCount: number;
  livesRemaining: number;
  maxLives: number;
};

export function calculateScore(input: ScoreInput, rules: ScoringRules = DEFAULT_SCORING_RULES): number {
  const { difficulty, stageIndexSolved, stageCount, livesRemaining, maxLives } = input;
  if (stageCount < 1 || maxLives < 1) throw new RangeError("stageCount and maxLives must be at least 1");
  if (stageIndexSolved < 0 || stageIndexSolved >= stageCount) throw new RangeError("stageIndexSolved out of range");
  if (livesRemaining < 0 || livesRemaining > maxLives) throw new RangeError("livesRemaining out of range");

  const clueEfficiency = 1 - rules.clueWeight * (stageIndexSolved / stageCount);
  const lifeMultiplier = 1 - rules.lifeWeight + rules.lifeWeight * (livesRemaining / maxLives);
  return Math.round(rules.base * rules.difficultyMultiplier[difficulty] * clueEfficiency * lifeMultiplier);
}

/** Highest possible score for a case: solved at stage 1 with every life left. */
export function maxScore(difficulty: Difficulty, rules: ScoringRules = DEFAULT_SCORING_RULES): number {
  return Math.round(rules.base * rules.difficultyMultiplier[difficulty]);
}
