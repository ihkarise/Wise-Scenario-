import { describe, expect, it } from "vitest";
import { diceSimilarity, editDistance, matchesAnswerKey, matchesAny, normalizeText, wordSetSimilarity } from "./text";

describe("diagnosis accepted-answer matching", () => {
  const key = {
    primary: "Autoimmune hepatitis",
    displayName: "Autoimmune hepatitis (type 1)",
    acceptedAnswers: ["Autoimmune hepatitis", "Autoimmune hepatitis type 1"],
    aliases: ["AIH"],
  };

  it("matches exactly", () => expect(matchesAnswerKey("Autoimmune hepatitis", key)).toBe(true));
  it("ignores case", () => expect(matchesAnswerKey("AUTOIMMUNE HEPATITIS", key)).toBe(true));
  it("normalises spacing", () => expect(matchesAnswerKey("  autoimmune    hepatitis ", key)).toBe(true));
  it("accepts configured aliases", () => expect(matchesAnswerKey("aih", key)).toBe(true));
  it("treats hyphens, apostrophes and accents consistently", () => {
    expect(normalizeText("Budd–Chiari syndrome")).toBe("budd chiari syndrome");
    expect(matchesAny("Wilsons disease", ["Wilson's disease"])).toBe(true);
    expect(matchesAny("Ménétrier disease", ["Menetrier disease"])).toBe(true);
  });
  it("never accepts a merely similar answer (no fuzzy marking)", () => {
    expect(matchesAnswerKey("Autoimmune hepatitiss", key)).toBe(false);
    expect(matchesAnswerKey("Alcoholic hepatitis", key)).toBe(false);
    expect(matchesAnswerKey("hepatitis", key)).toBe(false);
    expect(matchesAnswerKey("", key)).toBe(false);
  });
});

describe("similarity scores (used only for warnings and suggestions)", () => {
  it("scores identical titles 1 and unrelated titles low", () => {
    expect(diceSimilarity("The Hidden Liver Disease", "the hidden liver disease")).toBe(1);
    expect(diceSimilarity("The Hidden Liver Disease", "Tension pneumothorax")).toBeLessThan(0.3);
  });
  it("scores overlapping clue text by shared words", () => {
    expect(wordSetSimilarity("a b c d", "a b c e")).toBeCloseTo(0.6, 5);
  });
  it("counts transpositions as one typo", () => {
    expect(editDistance("hepatitis", "hepatitsi")).toBe(1);
    expect(editDistance("cirrhosis", "cirhosis")).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
});
