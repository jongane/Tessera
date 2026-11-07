import {
  type BoardCard,
  newSubtaskSchema,
  type SubtaskListItem,
} from '@tessera/shared'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  useAddSubtask,
  useMoveSubtask,
  useProjectColumns,
  useSetParent,
  useSubtasks,
  useTickSubtask,
} from '../api/subtasks'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'
import { ActionsMenu } from './ActionsMenu'
import { CompleteAnywayDialog } from '../boards/CompleteAnywayDialog'
import { DEEPEST_PARENT, TOO_DEEP } from './depth'
import { openSubtasksOf } from './open-subtasks'
import { MoveToParent } from './MoveToParent'

// `track` shows "Couldn't save" if the change fails.
type Track = (saving: Promise<unknown>) => void

// The card's direct subtasks, each with its own tick box and progress,
// and a way to add more (docs/card-features.md, section 4). A subtask can
// be on another board of the project.
export function Subtasks({ card, track }: { card: BoardCard; track: Track }) {
  const headingId = useId()
  const list = useSubtasks(card.boardId, card.id)
  if (list.isPending) {
    return <p className="text-muted">Loading subtasks…</p>
  }
  const subtasks = list.data?.subtasks ?? []
  const complete = subtasks.filter((subtask) => subtask.isComplete).length

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} tabIndex={-1} className="font-semibold">
          Subtasks
        </h3>
        {subtasks.length > 0 && (
          <span className="text-sm text-muted">
            {`${complete} of ${subtasks.length} complete`}
          </span>
        )}
      </div>
      {list.error && <Alert>{list.error.message}</Alert>}
      {subtasks.length === 0 ? (
        !list.error && <p className="text-muted">No subtasks yet</p>
      ) : (
        <SubtaskRows
          card={card}
          subtasks={subtasks}
          track={track}
          headingId={headingId}
        />
      )}
      <AddSubtask card={card} />
    </section>
  )
}

function SubtaskRows({
  card,
  subtasks,
  track,
  headingId,
}: {
  card: BoardCard
  subtasks: SubtaskListItem[]
  track: Track
  headingId: string
}) {
  const tick = useTickSubtask(card)
  return (
    <ul className="flex flex-col rounded-lg border border-line">
      {subtasks.map((subtask) => (
        <SubtaskRow
          key={subtask.id}
          card={card}
          subtask={subtask}
          tick={tick.mutateAsync}
          track={track}
          headingId={headingId}
        />
      ))}
    </ul>
  )
}

type Tick = ReturnType<typeof useTickSubtask>['mutateAsync']

function SubtaskRow({
  card,
  subtask,
  tick,
  track,
  headingId,
}: {
  card: BoardCard
  subtask: SubtaskListItem
  tick: Tick
  track: Track
  headingId: string
}) {
  // How many subtasks of this subtask are open, while asking.
  const [asking, setAsking] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  // The done column of the subtask's own board, once it is ticked.
  const [offer, setOffer] = useState<string | null>(null)
  const setParent = useSetParent()
  // A subtask moved away takes its row, and the button that had focus, with
  // it: focus goes to the list's heading.
  const gone = useRef({ opener, headingId })
  useEffect(() => {
    gone.current = { opener, headingId }
  })
  useEffect(
    () => () => {
      const { opener: button, headingId: id } = gone.current
      if (button && !button.isConnected) {
        document.getElementById(id)?.focus()
      }
    },
    [],
  )
  const open = subtask.subtaskProgress.total - subtask.subtaskProgress.complete

  function change(done: boolean, confirmOpenSubtasks = false) {
    setOffer(null)
    const saving = tick({ subtask, done, confirmOpenSubtasks })
    // The API may know of open subtasks the list did not show.
    track(
      saving.catch((error: unknown) => {
        const count = openSubtasksOf(error)
        if (count === null) throw error
        setAsking(count)
      }),
    )
    saving.then(
      (result) => setOffer(result?.doneColumnId ?? null),
      () => {},
    )
  }

  function onTick(done: boolean) {
    if (done && open > 0) {
      setAsking(open)
    } else {
      change(done)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line px-2.5 py-2 first:border-t-0">
      <input
        type="checkbox"
        aria-label={`Complete ${subtask.number}`}
        checked={subtask.isComplete}
        onChange={(event) => onTick(event.target.checked)}
        className="size-4 shrink-0 accent-accent"
      />
      <div className="min-w-0 flex-1">
        <SubtaskLink card={card} subtask={subtask} />
        <span className="block text-xs text-muted">
          {whereIs(card, subtask)}
        </span>
      </div>
      {subtask.subtaskProgress.total > 0 && (
        <span className="text-xs whitespace-nowrap text-muted">
          {`${subtask.subtaskProgress.complete} of ${subtask.subtaskProgress.total}`}
        </span>
      )}
      <ActionsMenu
        label={`Options for ${subtask.number}`}
        actions={[
          {
            name: 'Move to another parent',
            onSelect: (button) => {
              setOpener(button)
              setMoving(true)
            },
          },
          {
            name: 'Make its own card',
            onSelect: () =>
              track(
                setParent.mutateAsync({ cardId: subtask.id, parentId: null }),
              ),
          },
        ]}
      />
      {offer && (
        <DoneOffer
          subtask={subtask}
          columnId={offer}
          onDone={() => setOffer(null)}
          track={track}
        />
      )}
      {asking !== null && (
        <CompleteAnywayDialog
          openSubtasks={asking}
          byMoving={false}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            change(true, true)
          }}
        />
      )}
      {moving && (
        <MoveToParent
          card={subtask}
          onDone={() => setMoving(false)}
          returnFocusTo={opener}
        />
      )}
    </li>
  )
}

// Opens the subtask in the panel, or its board when it is on another one.
function SubtaskLink({
  card,
  subtask,
}: {
  card: BoardCard
  subtask: SubtaskListItem
}) {
  return (
    <Link
      to={
        subtask.boardId === card.boardId
          ? { search: `?card=${subtask.id}` }
          : `/${subtask.number}`
      }
      className="underline decoration-line underline-offset-3 hover:text-accent"
    >
      <span className="text-muted">{subtask.number}</span>{' '}
      <span className={subtask.isComplete ? 'text-muted line-through' : ''}>
        {subtask.title}
      </span>
    </Link>
  )
}

function whereIs(card: BoardCard, subtask: SubtaskListItem) {
  return subtask.boardId === card.boardId
    ? subtask.columnName
    : `${subtask.columnName} · ${subtask.boardName}`
}

// After ticking a subtask that is not in its board's done column.
function DoneOffer({
  subtask,
  columnId,
  onDone,
  track,
}: {
  subtask: SubtaskListItem
  columnId: string
  onDone: () => void
  track: Track
}) {
  const move = useMoveSubtask()
  return (
    <div
      role="status"
      className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-success-soft px-3 py-1.5 text-success"
    >
      <span>Completed. Move it to Done?</span>
      <Button
        variant="secondary"
        className="min-h-8"
        onClick={() => {
          onDone()
          track(move.mutateAsync({ cardId: subtask.id, columnId }))
        }}
      >
        Move
      </Button>
      <Button variant="link" className="min-h-8" onClick={onDone}>
        Keep here
      </Button>
    </div>
  )
}

// "Add subtask" asks for a title and a column, then adds it. The column
// starts on the card's own; the other boards' columns load when the form
// opens.
function AddSubtask({ card }: { card: BoardCard }) {
  const [open, setOpen] = useState(false)
  const tooDeep = card.depth >= DEEPEST_PARENT
  const reasonId = useId()

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          variant="secondary"
          className="self-start"
          disabled={tooDeep}
          aria-describedby={tooDeep ? reasonId : undefined}
          onClick={() => setOpen(true)}
        >
          Add subtask
        </Button>
        {tooDeep && (
          <p id={reasonId} className="text-muted">
            {TOO_DEEP}
          </p>
        )}
      </div>
    )
  }
  return <AddSubtaskForm card={card} onClose={() => setOpen(false)} />
}

function AddSubtaskForm({
  card,
  onClose,
}: {
  card: BoardCard
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [columnId, setColumnId] = useState(card.columnId)
  const [error, setError] = useState<string>()
  const add = useAddSubtask(card.id)

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newSubtaskSchema, { title, columnId })
    if (!checked.ok) {
      setError(checked.errors.title)
      return
    }
    setError(undefined)
    add.mutate(checked.data, { onSuccess: onClose })
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong p-3"
    >
      {add.error && <Alert>{add.error.message}</Alert>}
      <TextField
        label="Subtask title"
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={error}
      />
      <ColumnChoice
        projectId={card.projectId}
        value={columnId}
        onChange={setColumnId}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// Every board's columns, grouped by board.
function ColumnChoice({
  projectId,
  value,
  onChange,
}: {
  projectId: string
  value: string
  onChange: (columnId: string) => void
}) {
  const id = useId()
  const { groups, error } = useProjectColumns(projectId, true)
  if (error) {
    return <Alert>{error.message}</Alert>
  }
  if (!groups) {
    return <p className="text-muted">Loading columns…</p>
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        Column
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-lg border border-line-strong bg-surface px-3"
      >
        {groups.map(({ board, columns }) => (
          <optgroup key={board.id} label={board.name}>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
