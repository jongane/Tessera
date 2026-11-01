import {
  type BoardCard,
  type CardChangesBody,
  type CardPriority,
  cardChangesSchema,
  dueFromParts,
  dueParts,
  formatMinutes,
  splitMinutes,
} from '@tessera/shared'
import { type FocusEvent, type KeyboardEvent, useId, useState } from 'react'
import { useCardTotals } from '../api/cards'
import { PRIORITY_NAMES } from '../boards/card-text'
import { checkForm } from '../ui/form-errors'
import { estimateFrom } from './estimate'

// The card's small fields. Each saves as soon as it changes (docs/web-app.md,
// section 5); `save` sends the change and shows it straight away.
type Save = (body: CardChangesBody) => void

const inputClass =
  'min-h-11 min-w-0 rounded-lg border border-line-strong bg-surface px-3 aria-invalid:border-danger'
const smallButton =
  'min-h-8 self-start text-sm font-semibold text-accent hover:text-accent-strong hover:underline'

// The title box looks like a heading. Enter or leaving the box saves it;
// Escape puts it back. A reload while typing does not overwrite it.
export function TitleField({ card, save }: { card: BoardCard; save: Save }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function commit() {
    if (draft === null) {
      return
    }
    const checked = checkForm(cardChangesSchema, { title: draft })
    if (!checked.ok) {
      setError(checked.errors.title ?? 'Check the title')
      return
    }
    setError(null)
    setDraft(null)
    if (checked.data.title !== card.title) {
      save({ title: checked.data.title })
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      // Escape here puts the title back; it does not close the panel.
      event.stopPropagation()
      setDraft(null)
      setError(null)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        Title
      </label>
      <input
        id={id}
        value={draft ?? card.title}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="-mx-2 rounded-md border border-transparent px-2 py-1 text-xl font-bold hover:border-line focus:border-line-strong aria-invalid:border-danger"
      />
      {error && (
        <p id={`${id}-error`} className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

const PRIORITIES: CardPriority[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']

export function PriorityField({ card, save }: { card: BoardCard; save: Save }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        Priority
      </label>
      <select
        id={id}
        value={card.priority}
        onChange={(event) =>
          save({ priority: event.target.value as CardPriority })
        }
        className={inputClass}
      >
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {priority === 'NONE' ? 'None' : PRIORITY_NAMES[priority]}
          </option>
        ))}
      </select>
    </div>
  )
}

// A day, and an optional time typed in the project's time zone
// (agreed 2026-11-01; due days are compared in that zone too).
export function DueField({
  card,
  timeZone,
  save,
}: {
  card: BoardCard
  timeZone: string
  save: Save
}) {
  const id = useId()
  const saved = dueParts(card.dueAt, card.dueHasTime, timeZone)
  const [timeDraft, setTimeDraft] = useState<string | null>(null)
  const time = timeDraft ?? saved.time

  function onDate(date: string) {
    if (date !== '' && date !== saved.date) {
      save({ due: dueFromParts(date, time, timeZone) })
      setTimeDraft(null)
    }
  }

  function commitTime() {
    if (timeDraft === null) {
      return
    }
    setTimeDraft(null)
    if (saved.date !== '' && timeDraft !== saved.time) {
      save({ due: dueFromParts(saved.date, timeDraft, timeZone) })
    }
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-semibold">Due</legend>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-date`} className="sr-only">
          Due date
        </label>
        <input
          id={`${id}-date`}
          type="date"
          value={saved.date}
          onChange={(event) => onDate(event.target.value)}
          className={inputClass}
        />
        <label htmlFor={`${id}-time`} className="sr-only">
          Due time
        </label>
        <input
          id={`${id}-time`}
          type="time"
          value={time}
          disabled={saved.date === ''}
          onChange={(event) => setTimeDraft(event.target.value)}
          onBlur={commitTime}
          aria-describedby={`${id}-zone`}
          className={`${inputClass} disabled:opacity-60`}
        />
      </div>
      <p id={`${id}-zone`} className="text-xs text-muted">
        Times are in {timeZone}
      </p>
      {card.dueAt && (
        <button
          type="button"
          onClick={() => save({ due: null })}
          className={smallButton}
        >
          Clear due date
        </button>
      )}
    </fieldset>
  )
}

// Hours and minutes (docs/card-features.md, section 6). Saved when focus
// leaves both boxes. A card with subtasks shows the sum of theirs, and its
// own estimate greyed out as the "original estimate".
export function EstimateField({ card, save }: { card: BoardCard; save: Save }) {
  const id = useId()
  const hasSubtasks = card.subtaskProgress.total > 0
  const totals = useCardTotals(card.id, hasSubtasks)
  const saved =
    card.estimateMinutes === null ? null : splitMinutes(card.estimateMinutes)
  const [draft, setDraft] = useState<{ hours: string; minutes: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? {
    hours: saved ? String(saved.hours) : '',
    minutes: saved ? String(saved.minutes) : '',
  }

  function onBlur(event: FocusEvent<HTMLFieldSetElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    if (draft === null) {
      return
    }
    const minutes = estimateFrom(draft)
    if (typeof minutes === 'string') {
      setError(minutes)
      return
    }
    setError(null)
    setDraft(null)
    if (minutes !== card.estimateMinutes) {
      save({ estimateMinutes: minutes })
    }
  }

  const rolledUp = totals.data?.estimateMinutes
  return (
    <div className="flex flex-col gap-1.5">
      {hasSubtasks && (
        <>
          <h3 className="font-semibold">Estimate</h3>
          {totals.data && (
            <p>
              {rolledUp === null || rolledUp === undefined
                ? 'No estimates on its subtasks yet'
                : `${formatMinutes(rolledUp)} from its subtasks`}
            </p>
          )}
        </>
      )}
      <fieldset
        onBlur={onBlur}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`flex flex-col gap-1.5 ${hasSubtasks ? 'text-muted' : ''}`}
      >
        <legend className="mb-1.5 font-semibold">
          {hasSubtasks ? 'Original estimate' : 'Estimate'}
        </legend>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-hours`}
            inputMode="numeric"
            value={shown.hours}
            onChange={(event) =>
              setDraft({ ...shown, hours: event.target.value })
            }
            aria-invalid={error ? true : undefined}
            className={`${inputClass} w-16`}
          />
          <label htmlFor={`${id}-hours`}>Hours</label>
          <input
            id={`${id}-minutes`}
            inputMode="numeric"
            value={shown.minutes}
            onChange={(event) =>
              setDraft({ ...shown, minutes: event.target.value })
            }
            aria-invalid={error ? true : undefined}
            className={`${inputClass} w-16`}
          />
          <label htmlFor={`${id}-minutes`}>Minutes</label>
        </div>
        {error && (
          <p id={`${id}-error`} className="text-danger">
            {error}
          </p>
        )}
      </fieldset>
      {card.estimateMinutes !== null && (
        <button
          type="button"
          onClick={() => {
            setDraft(null)
            setError(null)
            save({ estimateMinutes: null })
          }}
          className={smallButton}
        >
          Clear estimate
        </button>
      )}
    </div>
  )
}
