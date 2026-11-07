import type { RelatedCard } from '@tessera/shared'
import { useEffect, useState } from 'react'
import { useCardRelatives } from '../api/cards'
import { useCardSearch } from '../api/subtasks'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'
import { TextField } from '../ui/TextField'

export const PICKER_TITLE = 'Move to another parent'

// How long to wait after the last key before searching.
const SEARCH_DELAY_MS = 250

function useDebounced(value: string): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value])
  return settled
}

// Finds the card to become another card's parent, by number or title, on
// any board of the project (docs/card-features.md, section 4). The card
// itself and all its subtasks are left out, since a card can't go under
// one of its own subtasks. `alsoLeaveOut` names more cards to leave out.
export function ParentPickerDialog({
  projectId,
  moving,
  alsoLeaveOut = [],
  onPick,
  onCancel,
  error,
  pending = false,
  modal = true,
}: {
  projectId: string
  moving: { id: string; boardId: string }
  alsoLeaveOut?: string[]
  onPick: (parent: RelatedCard) => void
  onCancel: () => void
  // Why the last pick was refused.
  error?: Error | null
  pending?: boolean
  // False when opened over another dialog, which then stays readable.
  modal?: boolean
}) {
  const [typed, setTyped] = useState('')
  const search = useDebounced(typed.trim())
  const found = useCardSearch(projectId, search)
  const relatives = useCardRelatives(moving.boardId, moving.id)
  const leftOut = new Set([
    moving.id,
    ...alsoLeaveOut,
    ...(relatives.data?.subtasks.map((subtask) => subtask.id) ?? []),
  ])
  const shown = relatives.data
    ? (found.data?.cards ?? []).filter((card) => !leftOut.has(card.id))
    : []
  const failure = error ?? found.error ?? relatives.error

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={PICKER_TITLE}
      modal={modal}
    >
      {failure && <Alert>{failure.message}</Alert>}
      <TextField
        label="Find a card"
        hint="Type a card number or words from its title."
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <Results
        searching={search !== '' && found.isPending}
        searched={search !== '' && found.data !== undefined}
        cards={shown}
        disabled={pending}
        onPick={onPick}
      />
      <div className="flex justify-end">
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
      </div>
    </Dialog>
  )
}

function Results({
  searching,
  searched,
  cards,
  disabled,
  onPick,
}: {
  searching: boolean
  searched: boolean
  cards: RelatedCard[]
  disabled: boolean
  onPick: (card: RelatedCard) => void
}) {
  if (searching) {
    return (
      <p role="status" className="text-muted">
        Searching…
      </p>
    )
  }
  if (searched && cards.length === 0) {
    return (
      <p role="status" className="text-muted">
        No cards found
      </p>
    )
  }
  return (
    <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
      {cards.map((card) => (
        <li key={card.id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(card)}
            className="flex min-h-11 w-full flex-col items-start justify-center rounded-md px-2 text-left hover:bg-subtle disabled:opacity-60"
          >
            <span>
              {card.number} {card.title}
            </span>
            <span className="text-xs text-muted">{card.boardName}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
