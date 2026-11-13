import { type ReactNode, useId } from 'react'
import { Button } from '../ui/Button'

// The panel under the field: their version, and the two ways forward. Saving
// at any time saves your text over theirs, and Cancel closes the field.
export function TheirVersion({
  children,
  onUseTheirs,
  onKeepMine,
}: {
  // Their version, shown as the field is read.
  children: ReactNode
  onUseTheirs: () => void
  onKeepMine: () => void
}) {
  const noteId = useId()
  return (
    <div
      role="group"
      aria-labelledby={noteId}
      className="flex flex-col gap-2 rounded-lg border border-line-strong bg-subtle p-3"
    >
      <p id={noteId} role="status" className="font-semibold">
        Someone changed this while you were editing.
      </p>
      <div className="break-words">{children}</div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onUseTheirs}>
          Use theirs
        </Button>
        <Button variant="secondary" onClick={onKeepMine}>
          Keep mine
        </Button>
      </div>
    </div>
  )
}
