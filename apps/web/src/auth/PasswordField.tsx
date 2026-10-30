import { useState } from 'react'
import { TextField } from '../ui/TextField'

export function PasswordField({
  value,
  onChange,
  error,
  hint,
  autoComplete,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  autoComplete: 'current-password' | 'new-password'
}) {
  const [shown, setShown] = useState(false)
  return (
    <TextField
      label="Password"
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
      hint={hint}
      after={
        <button
          type="button"
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
          className="min-h-11 rounded-lg border border-line bg-surface px-3 hover:bg-subtle"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      }
    />
  )
}
