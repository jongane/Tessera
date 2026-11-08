import {
  type BoardCard,
  formatMinutes,
  type RelatedCard,
} from '@tessera/shared'
import { useEffect, useId, useState } from 'react'
import { useMe } from '../api/auth'
import { ApiError } from '../api/client'
import { useMembers } from '../api/members'
import {
  useCardRelatives,
  useDeleteCard,
  useSubtasksForDelete,
} from '../api/cards'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { ParentPickerDialog } from './ParentPickerDialog'
import { entriesHeadingId } from './time-ids'

type Choice = 'delete' | 'standalone' | 'move'

// "Are you sure?" before deleting a card. A card with subtasks needs a
// choice for each direct subtask: delete it, make it a card of its own, or
// move it to another parent (docs/card-features.md, section 4).
export function DeleteCardDialog({
  card,
  projectCode,
  returnFocusTo,
  onCancel,
  onDeleted,
}: {
  card: BoardCard
  projectCode: string
  returnFocusTo?: HTMLElement | null
  onCancel: () => void
  onDeleted: () => void
}) {
  const hasSubtasks = card.subtaskProgress.total > 0
  const subtasks = useSubtasksForDelete(card.id, hasSubtasks)
  const remove = useDeleteCard(card.boardId, card.id)
  // Everything below the card goes with it, so none of it can be a new parent.
  const below = useCardRelatives(card.boardId, card.id)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  // The new parent of each subtask that is to move, once chosen.
  const [parents, setParents] = useState<Record<string, RelatedCard>>({})
  // The subtask the picker is open for.
  const [picking, setPicking] = useState<string | null>(null)
  // The button or radio that opened the picker.
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const me = useMe()
  const members = useMembers(card.projectId)
  const isAdmin =
    members.data?.find((member) => member.userId === me.data?.id)?.role ===
    'ADMIN'
  // Set when going to the time entries: focus is to land on their heading
  // once the dialog has closed.
  const [seeingEntries, setSeeingEntries] = useState<HTMLElement | null>(null)

  // Closes after the dialog has been told where to give focus back to.
  useEffect(() => {
    if (seeingEntries) onCancel()
  }, [seeingEntries, onCancel])

  function choiceFor(id: string): Choice {
    return choices[id] ?? 'standalone'
  }

  function choose(id: string, choice: Choice, button: HTMLElement) {
    setOpener(button)
    setChoices({ ...choices, [id]: choice })
    setPicking(choice === 'move' ? id : null)
  }

  const unplaced = subtasks.subtasks.some(
    ({ subtask }) => choiceFor(subtask.id) === 'move' && !parents[subtask.id],
  )
  const picked = subtasks.subtasks.find(({ subtask }) => subtask.id === picking)

  function onConfirm() {
    const body = hasSubtasks
      ? {
          subtasks: Object.fromEntries(
            subtasks.subtasks.map(({ subtask }) => [
              subtask.id,
              choiceBody(choiceFor(subtask.id), parents[subtask.id]),
            ]),
          ),
        }
      : undefined
    remove.mutateAsync(body).then(onDeleted, () => {})
  }

  return (
    <ConfirmDialog
      title={`Delete ${card.number}?`}
      confirmLabel="Delete card"
      onConfirm={onConfirm}
      onCancel={onCancel}
      returnFocusTo={seeingEntries ?? returnFocusTo}
      // Without the subtasks there is nothing to choose for them.
      pending={
        remove.isPending ||
        subtasks.pending ||
        subtasks.error !== null ||
        (hasSubtasks && below.isPending) ||
        unplaced
      }
      error={
        deleteError(remove.error) ??
        subtasks.error ??
        (hasSubtasks ? below.error : null)
      }
    >
      <div className="flex flex-col gap-3">
        <p>
          {`“${card.title}” will be deleted. Its chat is kept, without a card.`}
        </p>
        {isAdmin && loggedTimeRefusal(remove.error) !== null && (
          <a
            href={`#${entriesHeadingId(card.id)}`}
            className="self-start font-semibold text-accent hover:text-accent-strong hover:underline"
            onClick={(event) => {
              event.preventDefault()
              setSeeingEntries(
                document.getElementById(entriesHeadingId(card.id)),
              )
            }}
          >
            See the time entries
          </a>
        )}
        {hasSubtasks &&
          (subtasks.pending ? (
            <Loading />
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">
                What happens to its subtasks?
              </legend>
              {subtasks.subtasks.map(({ subtask, hasSubtasks: nested }) => (
                <SubtaskChoice
                  key={subtask.id}
                  name={`${projectCode}-${subtask.numberPath} ${subtask.title}`}
                  value={choiceFor(subtask.id)}
                  mayDelete={!nested}
                  parent={parents[subtask.id]}
                  onChange={(choice, button) =>
                    choose(subtask.id, choice, button)
                  }
                  onChoose={(button) => {
                    setOpener(button)
                    setPicking(subtask.id)
                  }}
                />
              ))}
            </fieldset>
          ))}
        {picked && below.data && (
          <ParentPickerDialog
            projectId={card.projectId}
            moving={picked.subtask}
            alsoLeaveOut={[
              card.id,
              ...below.data.subtasks.map((subtask) => subtask.id),
            ]}
            modal={false}
            returnFocusTo={opener}
            onPick={(parent) => {
              setParents({ ...parents, [picked.subtask.id]: parent })
              setPicking(null)
            }}
            onCancel={() => setPicking(null)}
          />
        )}
      </div>
    </ConfirmDialog>
  )
}

function choiceBody(choice: Choice, parent: RelatedCard | undefined) {
  return choice === 'move' && parent
    ? ({ action: 'move', parentId: parent.id } as const)
    : { action: choice === 'move' ? ('standalone' as const) : choice }
}

function SubtaskChoice({
  name,
  value,
  mayDelete,
  parent,
  onChange,
  onChoose,
}: {
  name: string
  value: Choice
  mayDelete: boolean
  // Where it moves to, once chosen.
  parent: RelatedCard | undefined
  onChange: (choice: Choice, button: HTMLElement) => void
  onChoose: (button: HTMLElement) => void
}) {
  const group = useId()
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-col gap-1">
      <span className="font-semibold">{name}</span>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-h-8 items-center gap-1.5">
          <input
            type="radio"
            name={group}
            checked={value === 'standalone'}
            onChange={(event) => onChange('standalone', event.currentTarget)}
          />
          Make its own card
        </label>
        <label
          className={`flex min-h-8 items-center gap-1.5 ${mayDelete ? '' : 'text-muted'}`}
        >
          <input
            type="radio"
            name={group}
            checked={value === 'delete'}
            disabled={!mayDelete}
            onChange={(event) => onChange('delete', event.currentTarget)}
          />
          Delete
        </label>
        <label className="flex min-h-8 items-center gap-1.5">
          <input
            type="radio"
            name={group}
            checked={value === 'move'}
            onChange={(event) => onChange('move', event.currentTarget)}
          />
          Move to another parent
        </label>
      </div>
      {value === 'move' && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {parent ? `Moves under ${parent.number}` : 'No parent yet'}
          </span>
          <Button
            variant="link"
            className="min-h-8"
            onClick={(event) => onChoose(event.currentTarget)}
          >
            {parent ? 'Change' : 'Choose a parent'}
          </Button>
        </div>
      )}
      {!mayDelete && (
        <span className="text-xs text-muted">
          It has subtasks of its own, so it can’t be deleted from here.
        </span>
      )}
    </div>
  )
}

// A card with logged time is refused; say how much, and what to do.
function loggedTimeRefusal(error: Error | null): number | null {
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    typeof error.details.loggedMinutes === 'number'
  ) {
    return error.details.loggedMinutes
  }
  return null
}

function deleteError(error: Error | null): Error | null {
  const logged = loggedTimeRefusal(error)
  if (logged !== null) {
    return new Error(
      `This card has ${formatMinutes(logged)} logged. ` +
        'A project admin can delete the time entries first.',
    )
  }
  return error
}
