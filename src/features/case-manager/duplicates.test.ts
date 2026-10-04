import { describe, expect, it } from "vitest";
import { findDuplicates, type ExistingCase } from "./duplicates";

const existing: ExistingCase[] = [
  {
    id: "a",
    caseNumber: 5,
    caseCode: "CASE-005",
    title: "The Hidden Liver Disease",
    status: "PUBLISHED",
    diagnosisNames: ["Disease X", "DX"],
    clueText: "A patient presents with tiredness and yellow eyes. Blood tests show raised enzymes.",
  },
  { id: "b", caseNumber: 6, caseCode: "CASE-006", title: "Crushing chest pain", status: "DRAFT", diagnosisNames: ["Disease Y"], clueText: "Chest pain radiating to the arm." },
];

describe("duplicate detection", () => {
  it("flags the exact same Case ID as 100%, even with a different title", () => {
    const [m] = findDuplicates({ caseCode: "case-005", title: "Something else", diagnosisNames: ["Z"], clueText: "" }, existing);
    expect(m).toMatchObject({ caseId: "a", sameCaseId: true, similarity: 100 });
  });

  it("warns about the same title under a new Case ID", () => {
    const [m] = findDuplicates({ caseCode: "CASE-007", title: "The hidden liver disease", diagnosisNames: ["Q"], clueText: "" }, existing);
    expect(m?.caseId).toBe("a");
    expect(m?.reasons).toContain("Same title");
    expect(m?.sameCaseId).toBe(false);
  });

  it("scores same title + same diagnosis (via alias) + similar clues highly", () => {
    const [m] = findDuplicates(
      {
        caseCode: "CASE-007",
        title: "The Hidden Liver Disease",
        diagnosisNames: ["dx"],
        clueText: "A patient presents with tiredness and yellow eyes. Blood tests show raised liver enzymes.",
      },
      existing,
    );
    expect(m?.similarity).toBeGreaterThanOrEqual(85);
    expect(m?.reasons).toEqual(expect.arrayContaining(["Same title", "Same diagnosis"]));
  });

  it("does not flag unrelated cases", () => {
    expect(findDuplicates({ caseCode: "CASE-100", title: "Ankle swelling", diagnosisNames: ["Disease W"], clueText: "Swollen ankle." }, existing)).toEqual([]);
  });
});
