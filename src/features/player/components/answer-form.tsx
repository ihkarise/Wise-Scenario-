"use client";

import type { FormEvent } from "react";
import { AnswerOption } from "@/components/ui/answer-option";
import { Button } from "@/components/ui/button";
import type { CurrentStageView } from "@/lib/engine/view";

type AnswerFormProps = {
  stage: CurrentStageView;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
  onSubmit: () => void;
  submitting: boolean;
};

export function AnswerForm({ stage, selectedOptionId, onSelect, onSubmit, submitting }: AnswerFormProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const questionId = `question-${stage.stageId}`;
  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <fieldset className="grid gap-3" aria-describedby={stage.hint ? `hint-${stage.stageId}` : undefined}>
        <legend id={questionId} className="mb-1 text-lg font-semibold text-balance">
          {stage.question}
        </legend>
        {stage.hint && (
          <p id={`hint-${stage.stageId}`} className="-mt-1 text-sm text-ink-muted">
            Hint: {stage.hint}
          </p>
        )}
        {stage.options.map((option, i) => (
          <AnswerOption
            key={option.id}
            name={`answer-${stage.stageId}`}
            value={option.id}
            letter={String.fromCharCode(65 + i)}
            label={option.label}
            tried={option.tried}
            disabled={submitting}
            checked={selectedOptionId === option.id}
            onSelect={onSelect}
          />
        ))}
      </fieldset>
      <Button type="submit" size="lg" disabled={!selectedOptionId} loading={submitting}>
        {submitting ? "Checking…" : "Submit answer"}
      </Button>
    </form>
  );
}
