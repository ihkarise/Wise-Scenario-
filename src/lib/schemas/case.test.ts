import { describe, expect, it } from "vitest";
import { DEMO_CASES } from "@/features/cases/demo/demo-cases";
import { fixtureCase } from "../../../tests/support/fixtures";
import { caseDefinitionSchema } from "./case";

const messages = (input: unknown) => {
  const r = caseDefinitionSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("case content validation", () => {
  it("accepts every demo case and marks it as demo content", () => {
    for (const c of DEMO_CASES) {
      expect(caseDefinitionSchema.safeParse(c).success).toBe(true);
      expect(c.isDemo).toBe(true);
      expect(c.summary).toContain("DEMO CONTENT");
      expect(c.references.every((r) => r.isPlaceholder)).toBe(true);
    }
  });

  it("demo set covers the required structures", () => {
    const shape = DEMO_CASES.filter((c) => c.publicationStatus === "PUBLISHED").map((c) => [c.stages.length, c.maxLives]);
    expect(shape).toEqual(expect.arrayContaining([[2, 3], [5, 5], [7, 5]]));
    expect(DEMO_CASES.map((c) => c.domain)).toEqual(expect.arrayContaining(["Materia Medica", "Repertory"]));
  });

  it("explains a stage with no correct answer in plain words", () => {
    const c = fixtureCase();
    const broken = structuredClone(c);
    broken.stages[2]!.interaction.options.forEach((o) => (o.isCorrect = false));
    expect(messages(broken)).toContain("Stage 3 has no correct answer.");
  });

  it("rejects a single-choice stage with two correct answers", () => {
    const broken = structuredClone(fixtureCase());
    broken.stages[0]!.interaction.options.forEach((o) => (o.isCorrect = true));
    expect(messages(broken)).toContain("Stage 1 has more than one correct answer.");
  });

  it("rejects gaps in stage order, reused IDs and impossible lives", () => {
    const c = fixtureCase();
    const gap = structuredClone(c);
    gap.stages[1]!.order = 5;
    expect(messages(gap)).toContain("Stage order must run 1, 2, 3 … without gaps or repeats.");

    const dupOption = structuredClone(c);
    dupOption.stages[1]!.interaction.options[0]!.id = c.stages[0]!.interaction.options[0]!.id;
    expect(messages(dupOption)).toContain("Stage 2 reuses an answer option ID.");

    expect(messages({ ...c, maxLives: 0 })).toContain("needs at least 1 life");
    expect(messages({ ...c, stages: [] })).toContain("needs at least 1 stage");
  });

  it("rejects a stage with fewer than two options", () => {
    const broken = structuredClone(fixtureCase());
    broken.stages[0]!.interaction.options = broken.stages[0]!.interaction.options.filter((o) => o.isCorrect);
    expect(messages(broken)).toContain("needs at least 2 answer options");
  });
});
