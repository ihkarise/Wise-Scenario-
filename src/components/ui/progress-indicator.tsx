import { cn } from "@/lib/utils/cn";

/** Clue progress as dots plus text. `current` is 1-based. */
export function ProgressIndicator({ current, total, completed = false }: { current: number; total: number; completed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span role="img" aria-label={`Clue ${current} of ${total}`} className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const done = n < current || (completed && n === current);
          return (
            <span
              key={n}
              className={cn(
                "size-2.5 rounded-full border-2",
                done && "border-ink-subtle bg-ink-subtle",
                n === current && !completed && "border-wise-blue bg-wise-blue ring-2 ring-blue-soft",
                n > current && "border-line-strong",
              )}
            />
          );
        })}
      </span>
      <span className="text-sm font-medium text-ink-muted tabular-nums" aria-hidden="true">
        Clue {current} of {total}
      </span>
    </div>
  );
}
