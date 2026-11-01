import {
  type BoardCard,
  type LabelColourName,
  newLabelSchema,
} from '@tessera/shared'
import { useState } from 'react'
import {
  useAddLabelToCard,
  useAssign,
  useCreateLabelForCard,
  useMakeOwner,
  useRemoveLabelFromCard,
  useUnassign,
} from '../api/cards'
import { useLabels } from '../api/labels'
import { useMembers } from '../api/members'
import { initial, LABEL_STYLES } from '../boards/card-text'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ColourPicker } from '../ui/ColourPicker'
import { checkForm } from '../ui/form-errors'
import { Picker } from './Picker'

// `track` shows "Couldn't save" if the change fails.
type Track = (saving: Promise<unknown>) => void

const iconButton =
  'flex size-8 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink'

// Who is assigned, owner first (docs/card-features.md, section 3).
export function AssigneesField({
  card,
  projectId,
  track,
}: {
  card: BoardCard
  projectId: string
  track: Track
}) {
  const members = useMembers(projectId)
  const assign = useAssign(card.boardId, card.id)
  const unassign = useUnassign(card.boardId, card.id)
  const makeOwner = useMakeOwner(card.boardId, card.id)
  const assigned = new Set(card.assignees.map((person) => person.id))
  const options = (members.data ?? [])
    .filter((member) => !assigned.has(member.userId))
    .map((member) => ({ id: member.userId, name: member.displayName }))

  return (
    <section aria-labelledby={`${card.id}-assignees`} className="flex flex-col gap-1.5">
      <h3 id={`${card.id}-assignees`} className="font-semibold">
        Assignees
      </h3>
      {card.assignees.length === 0 ? (
        <p className="text-muted">No one is assigned.</p>
      ) : (
        <ul aria-label="Assignees" className="flex flex-col gap-1">
          {card.assignees.map((person) => (
            <li key={person.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-7 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-strong"
              >
                {initial(person.displayName)}
              </span>
              <span>{person.displayName}</span>
              {person.isOwner && (
                <span className="rounded bg-subtle px-1.5 py-0.5 text-xs font-semibold text-muted">
                  Owner
                </span>
              )}
              <span className="ml-auto flex gap-1">
                {!person.isOwner && (
                  <button
                    type="button"
                    aria-label={`Make ${person.displayName} the owner`}
                    title="Make owner"
                    onClick={() => track(makeOwner.mutateAsync(person.id))}
                    className={iconButton}
                  >
                    <span aria-hidden="true">★</span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Unassign ${person.displayName}`}
                  title="Unassign"
                  onClick={() => track(unassign.mutateAsync(person.id))}
                  className={iconButton}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Picker
        buttonLabel="Assign"
        searchLabel="Find a member"
        options={options}
        emptyText="No one else to assign."
        onPick={(userId) => {
          const name =
            options.find((option) => option.id === userId)?.name ?? ''
          track(assign.mutateAsync({ id: userId, displayName: name }))
        }}
      />
    </section>
  )
}

// The card's labels. Any member can add one, or make a new project label
// from here (docs/card-features.md, section 8).
export function LabelsField({
  card,
  projectId,
  track,
}: {
  card: BoardCard
  projectId: string
  track: Track
}) {
  const labels = useLabels(projectId)
  const add = useAddLabelToCard(card.boardId, card.id)
  const remove = useRemoveLabelFromCard(card.boardId, card.id)
  const [creating, setCreating] = useState<string | null>(null)
  const onCard = new Set(card.labels.map((label) => label.id))
  const all = labels.data ?? []
  const options = all
    .filter((label) => !onCard.has(label.id))
    .map((label) => ({
      id: label.id,
      name: label.name,
      look: <LabelChip name={label.name} colour={label.colour} />,
    }))

  return (
    <section aria-labelledby={`${card.id}-labels`} className="flex flex-col gap-1.5">
      <h3 id={`${card.id}-labels`} className="font-semibold">
        Labels
      </h3>
      {card.labels.length === 0 ? (
        <p className="text-muted">No labels.</p>
      ) : (
        <ul aria-label="Labels" className="flex flex-wrap gap-1.5">
          {card.labels.map((label) => (
            <li
              key={label.id}
              className={`flex items-center gap-1 rounded py-0.5 pr-0.5 pl-2 text-xs font-semibold ${LABEL_STYLES[label.colour]}`}
            >
              {label.name}
              <button
                type="button"
                aria-label={`Remove label ${label.name}`}
                onClick={() => track(remove.mutateAsync(label.id))}
                className="flex size-6 items-center justify-center rounded hover:bg-surface/60"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Picker
        buttonLabel="Add label"
        searchLabel="Find a label"
        options={options}
        emptyText="No labels to add."
        onPick={(labelId) => {
          const label = all.find((l) => l.id === labelId)
          if (label) {
            track(add.mutateAsync(label))
          }
        }}
        extra={(query, close) => {
          const taken = all.some(
            (label) => label.name.toLowerCase() === query.toLowerCase(),
          )
          if (query === '' || taken) {
            return null
          }
          return (
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(query)
                close()
              }}
            >
              {`Create label “${query}”`}
            </Button>
          )
        }}
      />
      {creating !== null && (
        <NewLabelForm
          name={creating}
          projectId={projectId}
          card={card}
          onDone={() => setCreating(null)}
        />
      )}
    </section>
  )
}

function LabelChip({ name, colour }: { name: string; colour: LabelColourName }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold ${LABEL_STYLES[colour]}`}
    >
      {name}
    </span>
  )
}

// Picks the new label's colour, then makes it and puts it on the card.
function NewLabelForm({
  name,
  projectId,
  card,
  onDone,
}: {
  name: string
  projectId: string
  card: BoardCard
  onDone: () => void
}) {
  const [colour, setColour] = useState<LabelColourName>('GREY')
  const create = useCreateLabelForCard(projectId, card.boardId, card.id)
  const checked = checkForm(newLabelSchema, { name, colour })

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <p className="font-semibold">{`New label “${name}”`}</p>
      {!checked.ok && <Alert>{checked.errors.name}</Alert>}
      {create.error && <Alert>{create.error.message}</Alert>}
      <ColourPicker value={colour} onChange={setColour} />
      <div className="flex gap-2">
        <Button
          disabled={!checked.ok || create.isPending}
          onClick={() =>
            create.mutateAsync({ name, colour }).then(onDone, () => {})
          }
        >
          Create
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
