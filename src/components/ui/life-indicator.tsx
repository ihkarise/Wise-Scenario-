import { cn } from "@/lib/utils/cn";

const HEART =
  "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.1 1.8-1.9 3.3-3.1 5.4-3.1 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z";

/** Hearts plus a text count, so lives are never conveyed by colour or shape alone. */
export function LifeIndicator({ lives, maxLives, size = "md", showText = true }: { lives: number; maxLives: number; size?: "sm" | "md"; showText?: boolean }) {
  const px = size === "sm" ? "size-4" : "size-6";
  return (
    <div className="flex items-center gap-2">
      <span role="img" aria-label={`${lives} of ${maxLives} lives left`} className="flex items-center gap-1">
        {Array.from({ length: maxLives }, (_, i) => {
          const full = i < lives;
          return (
            <svg key={i} viewBox="0 0 24 24" aria-hidden="true" className={px}>
              <path d={HEART} strokeWidth={1.8} className={cn(full ? "fill-wise-red stroke-wise-red" : "fill-transparent stroke-line-strong")} />
            </svg>
          );
        })}
      </span>
      {showText && (
        <span className="text-sm font-medium text-ink-muted tabular-nums" aria-hidden="true">
          {lives}/{maxLives}
        </span>
      )}
    </div>
  );
}
