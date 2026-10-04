import type { LastAnswerView } from "@/lib/engine/view";

/** Feedback after a wrong answer. Uses an icon and words, never colour alone. */
export function FeedbackBanner({ lastAnswer, stageOrder }: { lastAnswer: LastAnswerView; stageOrder: number }) {
  if (lastAnswer.wasCorrect) return null;
  const lives =
    lastAnswer.livesLost === 0 ? "No life lost: that clue was a free guess." : `${lastAnswer.livesLost === 1 ? "One life" : `${lastAnswer.livesLost} lives`} lost.`;
  const next =
    lastAnswer.progression === "RETRY_FINAL_STAGE"
      ? "That was the last clue. Your choice is crossed out. Try again."
      : `Clue ${stageOrder} is now showing, with new answer options.`;
  return (
    <div role="status" className="flex gap-3 rounded-xl bg-red-soft px-4 py-3">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 size-5 shrink-0 stroke-wise-red" fill="none" strokeWidth={2.5} strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
      <div className="text-sm text-ink">
        <p className="font-semibold">
          Not quite: “{lastAnswer.optionLabel}” is not the answer. {lives}
        </p>
        <p className="text-ink-muted">{next}</p>
        {lastAnswer.correctOptionLabel && <p className="mt-1 text-ink-muted">The answer at that clue was “{lastAnswer.correctOptionLabel}”.</p>}
      </div>
    </div>
  );
}
