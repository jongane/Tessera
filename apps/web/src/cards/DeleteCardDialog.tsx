import {
  type BoardCard,
  formatMinutes,
  type RelatedCard,
} from '@tessera/shared'
import { useEffect, useId, useState } from 'react'
import { useMe } from '../api/auth'
import { useCardFiles } from '../api/files'
import { useCardSearch } from '../api/subtasks'
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
import { TextField } from '../ui/TextField'
import { ParentPickerDialog } from './ParentPickerDialog'
import { useDebounced } from './use-debounced'
import { entriesHeadingId } from './time-ids'

type Choice = 'delete' | 'standalone' | 'move'
// What happens to the files of the cards being deleted.
type FileChoice = 'delete' | 'move'

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
  const ownFiles = useCardFiles(card.id)
  const [fileChoice, setFileChoice] = useState<FileChoice | null>(null)
  // The card the files move to, once chosen.
  const [fileTarget, setFileTarget] = useState<RelatedCard | null>(null)
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

  // The cards that go with this one: it, and the subtasks chosen for deletion.
  const deleted = subtasks.subtasks.filter(
    ({ subtask }) => choiceFor(subtask.id) === 'delete',
  )
  const deletedIds = [card.id, ...deleted.map(({ subtask }) => subtask.id)]
  const fileCount =
    (ownFiles.data?.files.length ?? 0) +
    deleted.reduce((sum, { fileCount: n }) => sum + n, 0)
  const target =
    fileTarget && !deletedIds.includes(fileTarget.id) ? fileTarget : null
  // With files, a choice is needed: nothing is picked for the person.
  const filesUndecided =
    fileCount > 0 &&
    (fileChoice === null || (fileChoice === 'move' && target === null))

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
    const moveFilesTo =
      fileCount > 0 && fileChoice === 'move' ? target?.id : undefined
    remove.mutateAsync({ body, moveFilesTo }).then(onDeleted, () => {})
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
        ownFiles.isPending ||
        ownFiles.isError ||
        filesUndecided ||
        unplaced
      }
      error={
        deleteError(remove.error) ??
        ownFiles.error ??
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
        {fileCount > 0 && (
          <FilesChoice
            count={fileCount}
            withSubtasks={fileCount > (ownFiles.data?.files.length ?? 0)}
            projectId={card.projectId}
            choice={fileChoice}
            target={target}
            leaveOut={deletedIds}
            onChoice={setFileChoice}
            onTarget={setFileTarget}
          />
        )}
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

const plural = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`

// The card's files, and what to do with them: delete them with the card or
// move them to another card of the project (docs/card-features.md, section 8).
function FilesChoice({
  count,
  withSubtasks,
  projectId,
  choice,
  target,
  leaveOut,
  onChoice,
  onTarget,
}: {
  count: number
  // True when subtasks chosen for deletion have files too.
  withSubtasks: boolean
  projectId: string
  choice: FileChoice | null
  target: RelatedCard | null
  leaveOut: string[]
  onChoice: (choice: FileChoice) => void
  onTarget: (card: RelatedCard | null) => void
}) {
  const group = useId()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">
        {`${withSubtasks ? 'This card and its subtasks being deleted have' : 'This card has'} ${plural(count)}. What happens to them?`}
      </legend>
      <label className="flex min-h-8 items-center gap-1.5">
        <input
          type="radio"
          name={group}
          checked={choice === 'delete'}
          onChange={() => onChoice('delete')}
        />
        Delete the files too
      </label>
      <label className="flex min-h-8 items-center gap-1.5">
        <input
          type="radio"
          name={group}
          checked={choice === 'move'}
          onChange={() => onChoice('move')}
        />
        Move them to another card
      </label>
      {choice === 'move' &&
        (target ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{`The files move to ${target.number} ${target.title}`}</span>
            <Button
              variant="link"
              className="min-h-8"
              onClick={() => onTarget(null)}
            >
              Change
            </Button>
          </div>
        ) : (
          <CardFinder
            projectId={projectId}
            leaveOut={leaveOut}
            onPick={onTarget}
          />
        ))}
    </fieldset>
  )
}

// Finds a card of the project by number or title. The cards being deleted
// are left out.
function CardFinder({
  projectId,
  leaveOut,
  onPick,
}: {
  projectId: string
  leaveOut: string[]
  onPick: (card: RelatedCard) => void
}) {
  const [typed, setTyped] = useState('')
  const search = useDebounced(typed.trim())
  const found = useCardSearch(projectId, search)
  const cards = (found.data?.cards ?? []).filter(
    (card) => !leaveOut.includes(card.id),
  )
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Find a card"
        hint="Type a card number or words from its title."
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      {found.error && <p className="text-danger">{found.error.message}</p>}
      {search !== '' && found.isPending && (
        <p role="status" className="text-muted">
          Searching…
        </p>
      )}
      {search !== '' && found.data && cards.length === 0 && (
        <p role="status" className="text-muted">
          No cards found
        </p>
      )}
      <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
        {cards.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              onClick={() => onPick(card)}
              className="flex min-h-11 w-full flex-col items-start justify-center rounded-md px-2 text-left hover:bg-subtle"
            >
              <span>
                {card.number} {card.title}
              </span>
              <span className="text-xs text-muted">{card.boardName}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
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
