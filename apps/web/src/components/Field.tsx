'use client';

import { useId, type InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function Field({ label, hint, error, id, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-xl border bg-app-bg/60 px-3.5 py-2.5 text-sm text-app-text placeholder:text-app-muted/70 focus:border-brand-400 focus:outline-none ${
          error ? 'border-live-500' : 'border-app-border'
        } ${props.className ?? ''}`}
      />
      {hint && (
        <p id={hintId} className="text-xs text-app-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-live-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
