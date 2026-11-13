import {
  type BoardCard,
  type ChecklistItem,
  type ChecklistWithItems,
  checklistItemChangesSchema,
  CHECKLIST_FULL_MESSAGE,
  MAX_CHECKLIST_ITEMS,
  newChecklistItemSchema,
} from '@tessera/shared'
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  type FormEvent,
  type KeyboardEvent,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from 'react'
import {
  useAddItem,
  useChangeItem,
  useDeleteItem,
  useTurnItemIntoSubtask,
} from '../api/checklists'
import { Alert } from '../ui/Alert'
import { TheirVersion } from '../live/their-change'
import { useTheirChange } from '../live/use-their-change'
import { Button } from '../ui/Button'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'
import { ActionsMenu } from './ActionsMenu'
import { DEEPEST_PARENT, TOO_DEEP } from './depth'

// `track` shows "Couldn't save" if the change fails.
type Track = (saving: Promise<unknown>) => void

// One checklist's items, as tick boxes, in order. They can be dragged into
// another order with a pointer or the keyboard (Space, arrows, Space), or
// moved with their menu.
export function ChecklistItems({
  card,
  list,
  track,
}: {
  card: BoardCard
  list: ChecklistWithItems
  track: Track
}) {
  const change = useChangeItem(card.boardId, card.id)
  const remove = useDeleteItem(card.boardId, card.id)
  const turn = useTurnItemIntoSubtask(card.boardId, card.id)
  const sensors = useSensors(
    // A small movement first, so a click still ticks or edits.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )
  const items = list.items
  const ids = items.map((item) => item.id)
  const textOf = (id: UniqueIdentifier) =>
    items.find((item) => item.id === id)?.text ?? 'The item'
  const placeOf = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1

  function moveItem(item: ChecklistItem, position: number) {
    track(
      change.mutateAsync({ checklistId: list.id, itemId: item.id, position }),
    )
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const item = items.find((i) => i.id === active.id)
    if (!item || !over || over.id === active.id) {
      return
    }
    moveItem(item, ids.indexOf(String(over.id)))
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${textOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${textOf(active.id)} is in place ${placeOf(over.id)} of ${ids.length}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${textOf(active.id)} was dropped in place ${placeOf(over.id)}.`
        : `${textOf(active.id)} was put back.`,
    onDragCancel: ({ active }) =>
      `Moving was cancelled. ${textOf(active.id)} was put back.`,
  }

  return (
    <>
      {turn.error && <Alert>{turn.error.message}</Alert>}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To pick up the item, press Space. Use the arrow keys to move it, then press Space again to drop it, or Escape to cancel.',
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1">
            {items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                onTick={(isDone) =>
                  track(
                    change.mutateAsync({
                      checklistId: list.id,
                      itemId: item.id,
                      isDone,
                    }),
                  )
                }
                onEdit={(text) =>
                  track(
                    change.mutateAsync({
                      checklistId: list.id,
                      itemId: item.id,
                      text,
                    }),
                  )
                }
                actions={[
                  {
                    name: 'Move up',
                    disabled: index === 0,
                    onSelect: () => moveItem(item, index - 1),
                  },
                  {
                    name: 'Move down',
                    disabled: index === items.length - 1,
                    onSelect: () => moveItem(item, index + 1),
                  },
                  {
                    name: 'Turn into subtask',
                    disabled: card.depth >= DEEPEST_PARENT,
                    reason: TOO_DEEP,
                    onSelect: () =>
                      turn.mutate({ checklistId: list.id, itemId: item.id }),
                  },
                  {
                    name: 'Delete',
                    onSelect: () =>
                      track(
                        remove.mutateAsync({
                          checklistId: list.id,
                          itemId: item.id,
                        }),
                      ),
                  },
                ]}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AddItem card={card} list={list} />
    </>
  )
}

function ItemRow({
  item,
  onTick,
  onEdit,
  actions,
}: {
  item: ChecklistItem
  onTick: (isDone: boolean) => void
  onEdit: (text: string) => void
  actions: Parameters<typeof ActionsMenu>[0]['actions']
}) {
  const [editing, setEditing] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  // Escape drops the item back; it must not close the panel too.
  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && isDragging) {
      event.preventDefault()
    }
    listeners?.onKeyDown?.(event)
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 rounded-md bg-surface ${isDragging ? 'relative z-10 shadow-md' : ''}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onKeyDown={onHandleKeyDown}
        aria-label={`Drag ${item.text}`}
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <input
        type="checkbox"
        aria-label={item.text}
        checked={item.isDone}
        onChange={(event) => onTick(event.target.checked)}
        className="mt-2 size-4 shrink-0 accent-accent"
      />
      {editing ? (
        <ItemTextBox
          text={item.text}
          onDone={(text) => {
            setEditing(false)
            if (text !== null && text !== item.text) {
              onEdit(text)
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`min-h-8 min-w-0 flex-1 rounded-md px-1 text-left break-words hover:bg-subtle ${item.isDone ? 'text-muted line-through' : ''}`}
        >
          {item.text}
        </button>
      )}
      <ActionsMenu label={`Options for ${item.text}`} actions={actions} />
    </li>
  )
}

// Enter or leaving the box saves; Escape puts the text back. Gives the new
// text, or null when nothing changed. If someone else changed the item's text
// meanwhile, their version is shown under the box, and leaving the box no
// longer saves (docs/web-app.md, section 6).
function ItemTextBox({
  text,
  onDone,
}: {
  text: string
  onDone: (text: string | null) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string>()
  const change = useTheirChange(text, true)
  // Leaving the box after Enter or Escape must not save again.
  const done = useRef(false)

  function finish(result: string | null) {
    if (!done.current) {
      done.current = true
      onDone(result)
    }
  }

  function commit() {
    const checked = checkForm(checklistItemChangesSchema, { text: draft })
    if (!checked.ok) {
      setError(checked.errors.text)
      return
    }
    finish(checked.data.text ?? null)
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
        Item text
      </label>
      <input
        id={id}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (change.theirs === null) {
            commit()
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-8 min-w-0 rounded-md border border-line-strong px-2 aria-invalid:border-danger"
      />
      {error && (
        <p id={`${id}-error`} className="text-danger">
          {error}
        </p>
      )}
      {change.theirs !== null && (
        <TheirVersion
          onUseTheirs={() => {
            setDraft(change.theirs ?? '')
            change.seen()
          }}
          onKeepMine={change.seen}
        >
          <p>{change.theirs}</p>
        </TheirVersion>
      )}
    </div>
  )
}

// "Add item" opens a box at the bottom. Enter adds the item and keeps the
// box open for the next one. Turned off at 100 items, with the reason.
function AddItem({
  card,
  list,
}: {
  card: BoardCard
  list: ChecklistWithItems
}) {
  const reasonId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const add = useAddItem(card.boardId, card.id)
  const reasonRef = useRef<HTMLParagraphElement>(null)
  // True while the New item box holds the focus. Only read after a commit.
  const focusInside = useRef(false)
  const full = list.items.length >= MAX_CHECKLIST_ITEMS

  // When the box closes because the list is full, focus moves to the reason,
  // but only if it was inside the box (not elsewhere on the page).
  useLayoutEffect(() => {
    if (full && focusInside.current) reasonRef.current?.focus()
    focusInside.current = false
  }, [full])

  function close() {
    focusInside.current = false
    setOpen(false)
    setText('')
    setError(undefined)
    add.reset()
  }

  // Reaching 100 items closes the box; it stays closed if an item is deleted.
  if (full && open) {
    setOpen(false)
    setText('')
    setError(undefined)
  }

  if (!open || full) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          variant="link"
          className="min-h-8 self-start text-sm"
          disabled={full}
          aria-describedby={full ? reasonId : undefined}
          onClick={() => {
            focusInside.current = false
            setOpen(true)
          }}
        >
          Add item
        </Button>
        {full && (
          <p
            id={reasonId}
            ref={reasonRef}
            tabIndex={-1}
            className="text-sm text-muted"
          >
            {CHECKLIST_FULL_MESSAGE}
          </p>
        )}
      </div>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newChecklistItemSchema, { text })
    if (!checked.ok) {
      setError(checked.errors.text)
      return
    }
    setError(undefined)
    // Cleared straight away, so the next item can be typed while this one
    // is saved. If it can't be saved, its text comes back.
    setText('')
    add.mutate(
      { checklistId: list.id, text: checked.data.text },
      { onError: () => setText((now) => (now === '' ? text : now)) },
    )
  }

  return (
    <form
      noValidate
      onFocus={() => {
        focusInside.current = true
      }}
      // When the window loses focus the box stays the active element, so
      // that counts as still holding the focus.
      onBlur={(event) => {
        focusInside.current =
          event.currentTarget.contains(event.relatedTarget) ||
          event.currentTarget.contains(document.activeElement)
      }}
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
        label="New item"
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        error={error}
      />
      <div className="flex gap-2">
        <Button type="submit" className="min-h-9">
          Add
        </Button>
        <Button variant="secondary" className="min-h-9" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
