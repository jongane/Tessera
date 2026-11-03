import {
  type BoardCard,
  type ChecklistWithItems,
  checklistChangesSchema,
  newChecklistSchema,
} from '@tessera/shared'
import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from 'react'
import {
  useAddChecklist,
  useChangeChecklist,
  useChecklists,
  useDeleteChecklist,
} from '../api/checklists'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'
import { ChecklistItems } from './ChecklistItems'
import { ActionsMenu } from './ActionsMenu'

// `track` shows "Couldn't save" if the change fails.
type Track = (saving: Promise<unknown>) => void

// The card's named checklists, each with its own "2 of 4" progress
// (docs/card-features.md, section 2). Only shown on this card; the board
// shows the total.
export function Checklists({
  card,
  track,
  onCreateCard,
}: {
  card: BoardCard
  track: Track
  // Opens the board's Add card form in this column.
  onCreateCard: (columnId: string) => void
}) {
  const headingId = useId()
  const lists = useChecklists(card.boardId, card.id)
  const [suggestNewCard, setSuggestNewCard] = useState(false)
  const all = lists.data ?? []

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="font-semibold">
        Checklists
      </h3>
      {lists.error && <Alert>{lists.error.message}</Alert>}
      {all.map((list, index) => (
        <ChecklistView
          key={list.id}
          card={card}
          list={list}
          index={index}
          count={all.length}
          track={track}
        />
      ))}
      <AddChecklist card={card} onAdded={setSuggestNewCard} />
      {suggestNewCard && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle px-3 py-2"
        >
          <span>
            This card has a lot of checklists. Would a new card be clearer?
          </span>
          <Button
            variant="secondary"
            className="min-h-8"
            onClick={() => onCreateCard(card.columnId)}
          >
            Create a card
          </Button>
        </div>
      )}
    </section>
  )
}

// "Add checklist" asks for a name, then adds it after the others.
function AddChecklist({
  card,
  onAdded,
}: {
  card: BoardCard
  // Whether the card now has so many that a new card might be clearer.
  onAdded: (suggestNewCard: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const add = useAddChecklist(card.boardId, card.id)

  function close() {
    setOpen(false)
    setName('')
    setError(undefined)
    add.reset()
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        Add checklist
      </Button>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newChecklistSchema, { name })
    if (!checked.ok) {
      setError(checked.errors.name)
      return
    }
    setError(undefined)
    add.mutate(checked.data.name, {
      onSuccess: (created) => {
        onAdded(created.suggestNewCard)
        close()
      },
    })
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        close()
      }}
      className="flex flex-col gap-2"
    >
      {add.error && <Alert>{add.error.message}</Alert>}
      <TextField
        label="Checklist name"
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={error}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ChecklistView({
  card,
  list,
  index,
  count,
  track,
}: {
  card: BoardCard
  list: ChecklistWithItems
  index: number
  count: number
  track: Track
}) {
  const headingId = useId()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const change = useChangeChecklist(card.boardId, card.id)
  const move = (position: number) =>
    track(change.mutateAsync({ checklistId: list.id, position }))

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
    >
      <div className="flex items-center gap-2">
        {renaming ? (
          <RenameBox
            name={list.name}
            onDone={(name) => {
              setRenaming(false)
              if (name !== null && name !== list.name) {
                track(change.mutateAsync({ checklistId: list.id, name }))
              }
            }}
          />
        ) : (
          <h4 id={headingId} className="min-w-0 font-semibold break-words">
            {list.name}
          </h4>
        )}
        <span className="text-sm text-muted">
          {`${list.progress.done} of ${list.progress.total}`}
        </span>
        <ActionsMenu
          label={`Options for checklist ${list.name}`}
          actions={[
            { name: 'Rename', onSelect: () => setRenaming(true) },
            {
              name: 'Move up',
              disabled: index === 0,
              onSelect: () => move(index - 1),
            },
            {
              name: 'Move down',
              disabled: index === count - 1,
              onSelect: () => move(index + 1),
            },
            { name: 'Delete', onSelect: () => setDeleting(true) },
          ]}
        />
      </div>
      <ChecklistItems card={card} list={list} track={track} />
      {deleting && (
        <DeleteChecklistDialog
          card={card}
          list={list}
          onDone={() => setDeleting(false)}
        />
      )}
    </section>
  )
}

// Enter or leaving the box saves; Escape puts the name back. Gives the new
// name, or null when nothing changed.
function RenameBox({
  name,
  onDone,
}: {
  name: string
  onDone: (name: string | null) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string>()
  // Leaving the box after Enter or Escape must not save again.
  const done = useRef(false)

  function finish(result: string | null) {
    if (!done.current) {
      done.current = true
      onDone(result)
    }
  }

  function commit() {
    const checked = checkForm(checklistChangesSchema, { name: draft })
    if (!checked.ok) {
      setError(checked.errors.name)
      return
    }
    finish(checked.data.name ?? null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      finish(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        Checklist name
      </label>
      <input
        id={id}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-9 min-w-0 rounded-md border border-line-strong px-2 font-semibold aria-invalid:border-danger"
      />
      {error && (
        <p id={`${id}-error`} className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function DeleteChecklistDialog({
  card,
  list,
  onDone,
}: {
  card: BoardCard
  list: ChecklistWithItems
  onDone: () => void
}) {
  const remove = useDeleteChecklist(card.boardId, card.id)
  const items = list.items.length
  const what =
    items === 0
      ? `‘${list.name}’`
      : `‘${list.name}’ and its ${items} ${items === 1 ? 'item' : 'items'}`
  return (
    <ConfirmDialog
      title={`Delete ${what}?`}
      confirmLabel="Delete"
      onConfirm={() => remove.mutate(list.id, { onSuccess: onDone })}
      onCancel={onDone}
      pending={remove.isPending}
      error={remove.error}
    >
      {null}
    </ConfirmDialog>
  )
}
