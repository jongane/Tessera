import { useState } from 'react'

// Someone else changed the field you have open (docs/web-app.md, section 6).
// `current` is the field's value as the page now has it, and `open` is
// whether you are editing it. `base` is the value your edit started from;
// when `current` moves away from it, `theirs` is their new value. Your text
// stays in the box either way.
export function useTheirChange(current: string, open: boolean) {
  const [base, setBase] = useState<string | null>(null)
  // Set while drawing, as it follows from `open` and `current` alone.
  if (open && base === null) {
    setBase(current)
  } else if (!open && base !== null) {
    setBase(null)
  }
  const theirs = open && base !== null && current !== base ? current : null
  return {
    theirs,
    // What your edit is measured against.
    base: base ?? current,
    // Their version has been seen (Use theirs, Keep mine): it stops asking,
    // until they change it again.
    seen: () => setBase(current),
  }
}
