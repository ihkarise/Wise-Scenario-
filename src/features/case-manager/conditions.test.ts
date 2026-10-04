import { describe, expect, it } from "vitest";
import raw from "../../../data/conditions.json";
import { ConditionIndex, mergeConditions, parseConditionSeeds, type Condition } from "./conditions";

const inventory = parseConditionSeeds(raw);
const index = new ConditionIndex(inventory);
const names = (q: string, limit = 10) => index.search(q, limit).map((c) => c.name);

describe("condition inventory search (author autocomplete)", () => {
  it("the starter list is well-formed with unique names", () => {
    expect(inventory.length).toBeGreaterThan(50);
    expect(new Set(inventory.map((c) => c.name.toLowerCase())).size).toBe(inventory.length);
  });

  it("matches an abbreviation first: AIH → Autoimmune hepatitis", () => {
    expect(names("AIH")[0]).toBe("Autoimmune hepatitis");
    expect(names("aih")[0]).toBe("Autoimmune hepatitis");
  });

  it("partial words find relevant conditions", () => {
    expect(names("autoimmune")[0]).toBe("Autoimmune hepatitis");
    expect(names("autoimmune")).toEqual(expect.arrayContaining(["Primary biliary cholangitis", "Hashimoto thyroiditis"]));
    const hepatitis = names("hepatitis");
    expect(hepatitis.slice(0, 5)).toEqual(expect.arrayContaining(["Hepatitis A", "Hepatitis B", "Autoimmune hepatitis"]));
    expect(names("hep").slice(0, 6).every((n) => /\bhepat/i.test(n))).toBe(true);
  });

  it("tolerates small typos", () => {
    expect(names("hepatits")).toContain("Autoimmune hepatitis");
    expect(names("pnemothorax")[0]).toMatch(/pneumothorax/i);
  });

  it("searches specialty and category, and needs every word to match", () => {
    expect(names("cardiology stemi")).toEqual(expect.arrayContaining(["ST-elevation myocardial infarction"]));
    expect(names("zzzz")).toEqual([]);
    expect(names("")).toEqual([]);
  });

  it("merges conditions written in cases without duplicating inventory entries", () => {
    const fromCases: Condition[] = [
      { name: "autoimmune hepatitis", aliases: ["Lupoid hepatitis"], keywords: [], specialty: "", category: "", source: "cases" },
      { name: "Brand new condition", aliases: [], keywords: [], specialty: "", category: "", source: "cases" },
    ];
    const merged = mergeConditions(inventory, fromCases);
    expect(merged.length).toBe(inventory.length + 1);
    const aih = merged.find((c) => c.name === "Autoimmune hepatitis")!;
    expect(aih.aliases).toEqual(expect.arrayContaining(["AIH", "Lupoid hepatitis"]));
    expect(aih.source).toBe("inventory");
  });
});
