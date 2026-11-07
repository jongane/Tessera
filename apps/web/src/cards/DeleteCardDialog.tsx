import {
  type BoardCard,
  formatMinutes,
  type RelatedCard,
} from '@tessera/shared'
import { useId, useState } from 'react'
import { ApiError } from '../api/client'
import { useDeleteCard, useSubtasksForDelete } from '../api/cards'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { ParentPickerDialog } from './ParentPickerDialog'

type Choice = 'delete' | 'standalone' | 'move'

// "Are you sure?" before deleting a card. A card with subtasks needs a
// choice for each direct subtask: delete it, make it a card of its own, or
// move it to another parent (docs/card-features.md, section 4).
export function DeleteCardDialog({
  card,
  projectCode,
  onCancel,
  onDeleted,
}: {
  card: BoardCard
  projectCode: string
  onCancel: () => void
  onDeleted: () => void
}) {
  const hasSubtasks = card.subtaskProgress.total > 0
  const subtasks = useSubtasksForDelete(card.id, hasSubtasks)
  const remove = useDeleteCard(card.boardId, card.id)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  // The new parent of each subtask that is to move, once chosen.
  const [parents, setParents] = useState<Record<string, RelatedCard>>({})
  // The subtask the picker is open for.
  const [picking, setPicking] = useState<string | null>(null)

  function choiceFor(id: string): Choice {
    return choices[id] ?? 'standalone'
  }

  function choose(id: string, choice: Choice) {
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
      // Without the subtasks there is nothing to choose for them.
      pending={
        remove.isPending ||
        subtasks.pending ||
        subtasks.error !== null ||
        unplaced
      }
      error={deleteError(remove.error) ?? subtasks.error}
    >
      <div className="flex flex-col gap-3">
        <p>
          {`“${card.title}” will be deleted. Its chat is kept, without a card.`}
        </p>
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
                  onChange={(choice) => choose(subtask.id, choice)}
                  onChoose={() => setPicking(subtask.id)}
                />
              ))}
            </fieldset>
          ))}
        {picked && (
          <ParentPickerDialog
            projectId={card.projectId}
            moving={picked.subtask}
            alsoLeaveOut={[card.id]}
            modal={false}
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
  onChange: (choice: Choice) => void
  onChoose: () => void
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
            onChange={() => onChange('standalone')}
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
            onChange={() => onChange('delete')}
          />
          Delete
        </label>
        <label className="flex min-h-8 items-center gap-1.5">
          <input
            type="radio"
            name={group}
            checked={value === 'move'}
            onChange={() => onChange('move')}
          />
          Move to another parent
        </label>
      </div>
      {value === 'move' && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {parent ? `Moves under ${parent.number}` : 'No parent yet'}
          </span>
          <Button variant="link" className="min-h-8" onClick={onChoose}>
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
function deleteError(error: Error | null): Error | null {
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    typeof error.details.loggedMinutes === 'number'
  ) {
    return new Error(
      `This card has ${formatMinutes(error.details.loggedMinutes)} logged. ` +
        'A project admin can delete the time entries first.',
    )
  }
  return error
}
