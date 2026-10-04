import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

const control =
  "w-full min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-subtle focus:border-wise-blue focus:outline-none focus:ring-3 focus:ring-blue-soft aria-invalid:border-wise-red";

type FieldProps = { id: string; label: string; hint?: string; error?: string };

function FieldShell({ id, label, hint, error, children }: FieldProps & { children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-muted">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-wise-red">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = ({ id, hint, error }: FieldProps) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

export function Input({ id, label, hint, error, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy({ id, label, hint, error })} className={cn(control, className)} {...rest} />
    </FieldShell>
  );
}

export function Select({
  id,
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy({ id, label, hint, error })} className={cn(control, className)} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}
