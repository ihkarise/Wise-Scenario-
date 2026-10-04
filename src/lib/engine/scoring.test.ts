import { describe, expect, it } from "vitest";
import { calculateScore, DEFAULT_SCORING_RULES, maxScore } from "./scoring";

describe("score engine", () => {
  const base = { difficulty: "INTERMEDIATE" as const, stageCount: 4, maxLives: 5 };

  it("awards the maximum for a first-stage solve with every life left", () => {
    expect(calculateScore({ ...base, stageIndexSolved: 0, livesRemaining: 5 })).toBe(1250);
    expect(maxScore("INTERMEDIATE")).toBe(1250);
  });

  it("applies the difficulty multiplier", () => {
    const at = (difficulty: "EASY" | "INTERMEDIATE" | "HARD") =>
      calculateScore({ ...base, difficulty, stageIndexSolved: 0, livesRemaining: 5 });
    expect([at("EASY"), at("INTERMEDIATE"), at("HARD")]).toEqual([1000, 1250, 1500]);
  });

  it("decreases with each extra clue used", () => {
    const scores = [0, 1, 2, 3].map((i) => calculateScore({ ...base, stageIndexSolved: i, livesRemaining: 5 }));
    expect(scores).toEqual([1250, 1094, 938, 781]);
  });

  it("decreases with each life lost", () => {
    const scores = [5, 3, 1].map((lives) => calculateScore({ ...base, stageIndexSolved: 0, livesRemaining: lives }));
    expect(scores).toEqual([1250, 1000, 750]);
  });

  it("matches the documented worked example (stage 3 of 4, 3 of 5 lives)", () => {
    expect(calculateScore({ ...base, stageIndexSolved: 2, livesRemaining: 3 })).toBe(750);
  });

  it("is deterministic and accepts custom rules", () => {
    const input = { ...base, stageIndexSolved: 1, livesRemaining: 2 };
    expect(calculateScore(input)).toBe(calculateScore(input));
    expect(calculateScore(input, { ...DEFAULT_SCORING_RULES, base: 100 })).toBe(Math.round(calculateScore(input) / 10));
  });

  it("rejects impossible inputs", () => {
    expect(() => calculateScore({ ...base, stageIndexSolved: 4, livesRemaining: 1 })).toThrow(RangeError);
    expect(() => calculateScore({ ...base, stageIndexSolved: 0, livesRemaining: 6 })).toThrow(RangeError);
    expect(() => calculateScore({ ...base, stageCount: 0, stageIndexSolved: 0, livesRemaining: 1 })).toThrow(RangeError);
  });
});
