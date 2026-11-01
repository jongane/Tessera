import { type BoardCard, formatMinutes } from '@tessera/shared'
import { useId, useState } from 'react'
import { ApiError } from '../api/client'
import { useDeleteCard, useSubtasksForDelete } from '../api/cards'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Loading } from '../ui/Loading'

type Choice = 'delete' | 'standalone'

// "Are you sure?" before deleting a card. A card with subtasks needs a
// choice for each direct subtask: delete it, or make it a card of its own
// (docs/card-features.md, section 4). Moving one to another parent comes
// with subtasks in the card panel (agreed 2026-11-01).
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

  function choiceFor(id: string): Choice {
    return choices[id] ?? 'standalone'
  }

  function onConfirm() {
    const body = hasSubtasks
      ? {
          subtasks: Object.fromEntries(
            subtasks.subtasks.map(({ subtask }) => [
              subtask.id,
              { action: choiceFor(subtask.id) },
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
      pending={remove.isPending || subtasks.pending}
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
                  onChange={(choice) =>
                    setChoices({ ...choices, [subtask.id]: choice })
                  }
                />
              ))}
            </fieldset>
          ))}
      </div>
    </ConfirmDialog>
  )
}

function SubtaskChoice({
  name,
  value,
  mayDelete,
  onChange,
}: {
  name: string
  value: Choice
  mayDelete: boolean
  onChange: (choice: Choice) => void
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
      </div>
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
