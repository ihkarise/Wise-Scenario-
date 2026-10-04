import { cn } from "@/lib/utils/cn";

type AnswerOptionProps = {
  name: string;
  value: string;
  letter: string;
  label: string;
  checked: boolean;
  /** Already tried and wrong (final-stage retry). Shown struck through with text, not colour alone. */
  tried?: boolean;
  disabled?: boolean;
  onSelect: (value: string) => void;
};

/** A large, tappable radio option. Native radio inputs give keyboard arrow-key navigation for free. */
export function AnswerOption({ name, value, letter, label, checked, tried = false, disabled = false, onSelect }: AnswerOptionProps) {
  const isDisabled = disabled || tried;
  return (
    <label
      className={cn(
        "relative flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 bg-surface px-4 py-3 text-base font-medium transition-colors",
        "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-wise-blue",
        checked ? "border-wise-blue bg-blue-soft" : "border-line hover:border-line-strong",
        tried && "cursor-not-allowed border-dashed bg-canvas text-ink-subtle",
        disabled && !tried && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={isDisabled}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold",
          checked ? "bg-wise-blue text-white" : "bg-canvas text-ink-muted",
        )}
      >
        {letter}
      </span>
      <span className={cn("min-w-0 flex-1", tried && "line-through")}>{label}</span>
      {tried && <span className="text-xs font-semibold text-wise-red no-underline">Tried</span>}
    </label>
  );
}
