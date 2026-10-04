import { describe, expect, it } from "vitest";
import { parseCaseDefinition } from "@/lib/schemas/case";
import { fixtureCase, play, startedAttempt } from "../../../tests/support/fixtures";
import { toPlayerView } from "./view";

const wire = (value: unknown) => JSON.stringify(value);

/** Fixture with Case Manager fields: investigations, stage explanations, reasoning and wrong-answer feedback. */
function richCase() {
  const base = fixtureCase({ stages: 4 });
  const wrongLabel = base.stages[0]!.interaction.options.find((o) => !o.isCorrect)!.label;
  return parseCaseDefinition({
    ...base,
    stages: base.stages.map((s, i) => ({
      ...s,
      explanation: `STAGE-EXPLANATION-${i + 1}`,
      crossReference: `XREF-${i + 1}`,
      investigations: [{ name: `TEST-${i + 1}`, value: `VALUE-${i + 1}`, unit: "u/L" }],
    })),
    teaching: {
      ...base.teaching,
      reasoning: { clinicalInsight: "SECRET-INSIGHT", diagnosticReasoning: "SECRET-REASONING" },
      differentialDetails: [{ name: "Other", aliases: [], whyRejected: "SECRET-WHY-REJECTED", crossReferences: [] }],
      wrongAnswerExplanations: [
        { condition: wrongLabel.toUpperCase(), aliases: [], explanation: "SECRET-WRONG-FEEDBACK", missedClues: ["clue x"], betterDirection: "SECRET-DIRECTION" },
      ],
    },
  });
}

describe("Case Manager fields in the learner view", () => {
  it("shows a stage's investigations only once that stage is reached", () => {
    const c = richCase();
    const atStage2 = toPlayerView(c, play(c, startedAttempt(c), ["wrong"]));
    expect(atStage2.current?.investigations?.[0]?.name).toBe("TEST-2");
    expect(atStage2.clues[0]?.investigations?.[0]?.name).toBe("TEST-1");
    const json = wire(atStage2);
    expect(json).not.toContain("TEST-3");
    expect(json).not.toContain("VALUE-4");
  });

  it("never sends explanations, reasoning or wrong-answer feedback during play", () => {
    const c = richCase();
    const json = wire(toPlayerView(c, play(c, startedAttempt(c), ["wrong", "wrong"])));
    for (const secret of ["STAGE-EXPLANATION", "XREF-", "SECRET-INSIGHT", "SECRET-REASONING", "SECRET-WHY-REJECTED", "SECRET-WRONG-FEEDBACK", "SECRET-DIRECTION"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("after the answer is revealed, shows reasoning and the specific feedback for the learner's wrong choice", () => {
    const c = richCase();
    const view = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "correct"]));
    const r = view.result?.reasoning;
    expect(r?.clinicalInsight).toBe("SECRET-INSIGHT");
    expect(r?.stageReview.map((s) => s.explanation)).toEqual([
      "STAGE-EXPLANATION-1",
      "STAGE-EXPLANATION-2",
      "STAGE-EXPLANATION-3",
      "STAGE-EXPLANATION-4",
    ]);
    // Matched case-insensitively by the condition name.
    expect(r?.yourWrongAnswers).toEqual([
      expect.objectContaining({ explanation: "SECRET-WRONG-FEEDBACK", missedClues: ["clue x"], betterDirection: "SECRET-DIRECTION" }),
    ]);
  });

  it("keeps everything hidden when the case ends without revealing the answer", () => {
    const c = parseCaseDefinition({ ...richCase(), terminalBehavior: "END_CASE" });
    const view = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "wrong", "wrong", "wrong"]));
    expect(view.result?.answerRevealed).toBe(false);
    expect(view.result?.reasoning).toBeNull();
    const json = wire(view);
    for (const secret of ["STAGE-EXPLANATION", "XREF-", "SECRET-INSIGHT", "SECRET-WRONG-FEEDBACK", "SECRET-ANSWER"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("existing cases without these fields produce no reasoning block and no investigation keys", () => {
    const c = fixtureCase({ stages: 3 });
    const done = toPlayerView(c, play(c, startedAttempt(c), ["wrong", "correct"]));
    expect(done.result?.reasoning).toBeNull();
    expect(wire(done)).not.toContain("investigations");
  });
});
