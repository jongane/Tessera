import type { BoardCard, BoardView } from '@tessera/shared'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'
import { TextField } from '../ui/TextField'

// Picks a card on the board for a thread. A card has at most one thread, so
// only cards without one are offered. Found by number or title.
export function LinkCardDialog({
  view,
  linking,
  onPick,
  onOpenChange,
}: {
  view: BoardView
  linking: boolean
  onPick: (card: BoardCard) => void
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const free = view.columns
    .flatMap((column) => column.cards)
    .filter((card) => card.threadId === null)
  const shown = free.filter((card) => matches(card, search))

  return (
    <Dialog open onOpenChange={onOpenChange} title="Link to a card">
      <TextField
        label="Find a card"
        hint="A number such as WEB-12, or words from the title"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {shown.length > 0 ? (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {shown.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                disabled={linking}
                onClick={() => onPick(card)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-subtle disabled:opacity-60"
              >
                <span className="font-semibold">{card.number}</span>{' '}
                {card.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">
          {free.length === 0
            ? 'Every card on this board has a chat.'
            : 'No cards without a chat match.'}
        </p>
      )}
      <div className="flex justify-end">
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
      </div>
    </Dialog>
  )
}

function matches(card: BoardCard, search: string): boolean {
  const words = search.trim().toLowerCase()
  return (
    card.number.toLowerCase().startsWith(words) ||
    card.title.toLowerCase().includes(words)
  )
}
