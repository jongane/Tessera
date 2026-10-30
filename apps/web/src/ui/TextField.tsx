import { type InputHTMLAttributes, type ReactNode, useId } from 'react'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  // Shown after the input, e.g. a "Show password" button.
  after?: ReactNode
}

// A labelled text box. Its error and hint are read out with it by screen
// readers.
export function TextField({
  label,
  error,
  hint,
  after,
  className = '',
  ...input
}: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <div className="flex gap-1.5">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 aria-invalid:border-danger"
          {...input}
        />
        {after}
      </div>
      {hint && (
        <p id={hintId} className="text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
