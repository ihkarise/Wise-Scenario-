import { describe, expect, it } from "vitest";
import template from "../../../data/case-template.json";
import { checkReadiness, cleanDraft, draftToCaseDefinitionInput, type CaseDraftContent } from "@/features/admin/draft";
import { parseCaseDefinition } from "@/lib/schemas/case";
import { documentToDraftContent, draftToDocument, parseJsonText, validateCaseDocument, type CheckItem } from "./case-document";

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const DOMAIN = "11111111-1111-4111-8111-111111111111";

/** A small, valid case with neutral test text (no medical content). */
function validDoc(stageCount = 3): Record<string, unknown> {
  return {
    id: "CASE-900",
    title: "Test case title",
    category: "Test category",
    difficulty: "Hard",
    status: "draft",
    startingLives: 5,
    startingScore: 1000,
    stages: Array.from({ length: stageCount }, (_, i) => ({ stageNumber: i + 1, title: `Stage title ${i + 1}`, clue: `Clue text ${i + 1}` })),
    diagnosis: { primary: "Answer A", acceptedAnswers: ["Answer A"], aliases: ["AA"], explanation: "Explanation." },
    differentialDiagnoses: [{ name: "Answer B", whyRejected: "Reason B." }, { name: "Answer C" }],
    learningPoints: ["Point"],
  };
}
const errors = (items: CheckItem[]) => items.filter((i) => i.level === "error").map((i) => i.message);

describe("JSON template", () => {
  it("is a valid case with no errors, demonstrating every supported field", () => {
    const result = validateCaseDocument(template);
    expect(errors(result.items)).toEqual([]);
    expect(result.ok).toBe(true);
    const doc = result.document!;
    expect(doc.stages.length).toBeGreaterThan(1);
    expect(doc.stages.some((s) => s.decisionPoint?.options.length)).toBe(true);
    expect(doc.stages.some((s) => s.investigations.length > 0)).toBe(true);
    expect(doc.stages.some((s) => s.explanation)).toBe(true);
    expect(doc.diagnosis.acceptedAnswers.length).toBeGreaterThan(0);
    expect(doc.diagnosis.aliases.length).toBeGreaterThan(0);
    expect(doc.differentialDiagnoses.length).toBeGreaterThan(0);
    expect(doc.wrongAnswerExplanations.length).toBeGreaterThan(0);
    for (const key of ["clinicalInsight", "diagnosticReasoning", "clinicalSummary", "investigationSummary", "whereReasoningCanGoWrong"] as const) {
      expect(doc[key]).not.toBe("");
    }
    expect(doc.learningPoints.length).toBeGreaterThan(0);
    expect(doc.references.length).toBeGreaterThan(0);
  });

  it("warns that template text has not been replaced", () => {
    const result = validateCaseDocument(template);
    expect(result.items.some((i) => i.level === "warning" && i.message.includes("template text"))).toBe(true);
  });
});

describe("JSON validation", () => {
  it("accepts a valid case and reports what it checked", () => {
    const result = validateCaseDocument(validDoc(5));
    expect(result.ok).toBe(true);
    const ok = result.items.filter((i) => i.level === "ok").map((i) => i.message);
    expect(ok).toEqual(expect.arrayContaining(["Case ID CASE-900", "Title", "5 stages", "Diagnosis: Answer A", "Accepted answers (1) and aliases (1)", "Learning points (1)"]));
  });

  it("reports invalid JSON text in plain language", () => {
    const parsed = parseJsonText("{ not json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/not valid JSON/);
  });

  it("rejects missing required fields with specific messages", () => {
    const result = validateCaseDocument({ stages: [] });
    expect(result.ok).toBe(false);
    expect(errors(result.items)).toEqual(
      expect.arrayContaining([
        "Case ID is missing.",
        "Title is missing.",
        "Category is missing.",
        expect.stringMatching(/^Difficulty is missing/),
        expect.stringMatching(/^Status is missing/),
        "Starting lives is missing.",
        "Starting score is missing.",
        "A case needs at least one stage.",
        "Diagnosis is missing.",
      ]),
    );
  });

  it("names the exact stage that is missing a clue, and a diagnosis with no accepted answers", () => {
    const doc = validDoc(5);
    (doc.stages as Record<string, unknown>[])[2]!.clue = "";
    (doc.diagnosis as Record<string, unknown>).acceptedAnswers = [];
    const result = validateCaseDocument(doc);
    expect(result.ok).toBe(false);
    expect(errors(result.items)).toEqual(expect.arrayContaining(["Stage 3 is missing a clue.", "Diagnosis has no accepted answers."]));
  });

  it("checks stage numbering, difficulty, lives, IDs and option rules", () => {
    const doc = validDoc(3);
    const stages = doc.stages as Record<string, unknown>[];
    stages[2]!.stageNumber = 5;
    stages[0]!.decisionPoint = { question: "Q?", options: [{ label: "Answer A", correct: true }, { label: "Answer A", correct: true }] };
    doc.difficulty = "medium";
    doc.startingLives = 0;
    doc.id = "CASE 900!";
    const msgs = errors(validateCaseDocument(doc).items);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Stage numbers must run 1, 2, 3/),
        expect.stringMatching(/Difficulty “medium” is not recognised/),
        "Starting lives must be between 1 and 10.",
        expect.stringMatching(/^Case ID “CASE 900!” may only use/),
        "Stage 1 has more than one correct option.",
        "Stage 1 has two answer options with the same text.",
      ]),
    );
  });

  it("refuses a stage without options when there are no differentials to build them from", () => {
    const doc = validDoc(2);
    doc.differentialDiagnoses = [];
    expect(errors(validateCaseDocument(doc).items)).toEqual([expect.stringMatching(/no differential diagnoses to build them from/)]);
  });

  it("warns about unknown fields instead of silently ignoring them", () => {
    const doc = { ...validDoc(), diagnosys: {} };
    const result = validateCaseDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.items).toContainEqual({ level: "warning", message: expect.stringContaining("unknown field “diagnosys”") });
  });

  it("never invents content: optional teaching that was not supplied stays empty", () => {
    const doc = validateCaseDocument(validDoc()).document!;
    expect(doc.clinicalInsight).toBe("");
    expect(doc.references).toEqual([]);
    expect(doc.wrongAnswerExplanations).toEqual([]);
    expect(doc.diagnosis.detailedExplanation).toBe("");
    const draft = documentToDraftContent(doc, { domainId: DOMAIN, slug: "test-case-title", newId });
    expect(draft.stages.every((s) => s.investigations.length === 0 && s.explanation === "")).toBe(true);
  });
});

describe("document → draft → playable case (dynamic stages)", () => {
  for (const count of [3, 5, 7, 10]) {
    it(`a ${count}-stage case imports, is playable, and keeps every stage in order`, () => {
      const doc = validateCaseDocument(validDoc(count)).document!;
      const draft = documentToDraftContent(doc, { domainId: DOMAIN, slug: "test-case-title", newId });
      expect(draft.stages.map((s) => s.content)).toEqual(Array.from({ length: count }, (_, i) => `Clue text ${i + 1}`));
      // Options were built from the author's own names only.
      for (const s of draft.stages) {
        expect(s.options.map((o) => o.label).sort()).toEqual(["Answer A", "Answer B", "Answer C"]);
        expect(s.options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["Answer A"]);
      }
      expect(checkReadiness(draft).canPublish).toBe(true);
      const def = parseCaseDefinition(
        draftToCaseDefinitionInput(draft, { caseId: "c1", caseNumber: 1, version: 1, domainName: "D", categoryName: "C", isDemo: false, mode: "publish" }),
      );
      expect(def.stages).toHaveLength(count);
    });
  }

  it("export → validate → import round-trips the content", () => {
    const original = documentToDraftContent(validateCaseDocument(template).document!, { domainId: DOMAIN, slug: "x", newId });
    const exported = draftToDocument(original, { domain: "Medical Diagnosis" });
    const again = validateCaseDocument(JSON.parse(JSON.stringify(exported)));
    expect(errors(again.items)).toEqual([]);
    const reimported = documentToDraftContent(again.document!, { domainId: DOMAIN, slug: "x", newId });
    const strip = (d: CaseDraftContent) =>
      JSON.parse(JSON.stringify(cleanDraft(d), (k, v) => (k === "id" ? undefined : v))) as unknown;
    expect(strip(reimported)).toEqual(strip(original));
  });
});
