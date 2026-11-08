import {
  type BoardCard,
  dueParts,
  formatMinutes,
  joinMinutes,
  type NewTimeEntryBody,
  newTimeEntrySchema,
  type Project,
  splitMinutes,
  type TimeEntryChangesBody,
  type TimeEntryWithPerson,
} from '@tessera/shared'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useMe } from '../api/auth'
import { useMembers } from '../api/members'
import {
  useChangeEntry,
  useDeleteEntry,
  useLogTime,
  useTimeEntries,
} from '../api/time'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { checkForm } from '../ui/form-errors'
import { Loading } from '../ui/Loading'
import { TextField } from '../ui/TextField'
import { entriesHeadingId } from './time-ids'

// `track` shows "Couldn't save" (or the server's reason) if the change fails.
type Track = (saving: Promise<unknown>) => void

const OWN_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000
const NOT_YOURS = 'Only a project admin can change someone else’s time'
const TOO_OLD =
  'You can change your own time for 24 hours. After that, ask a project admin'

const inputClass =
  'min-h-11 min-w-0 rounded-lg border border-line-strong bg-surface px-3 aria-invalid:border-danger'

// Today in the project's time zone, as "2026-11-07".
function today(timeZone: string) {
  return dueParts(new Date().toISOString(), true, timeZone).date
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// "2 Nov", with the year when it is not this one. A work date is a day
// saved as midnight UTC, so it is read in UTC whatever zone the browser is in.
function dayText(workDate: string) {
  const day = new Date(workDate)
  const text = `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`
  const year = day.getUTCFullYear()
  return year === new Date().getUTCFullYear() ? text : `${text} ${year}`
}

// The entries of a card, newest day first, with "Log time" and the buttons
// to change each one.
export function TimeEntries({
  card,
  project,
  track,
}: {
  card: BoardCard
  project: Project
  track: Track
}) {
  const me = useMe()
  const members = useMembers(project.id)
  const entries = useTimeEntries(card.id)
  const [logging, setLogging] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{
    entry: TimeEntryWithPerson
    button: HTMLElement
  } | null>(null)
  // The button to give focus to, once it is on the screen again.
  const focusId = useRef<string | null>(null)
  const log = useLogTime(card.id)
  const change = useChangeEntry()
  const remove = useDeleteEntry()
  const logButtonId = `${card.id}-log-time`

  useEffect(() => {
    if (focusId.current) {
      document.getElementById(focusId.current)?.focus()
      focusId.current = null
    }
  })

  const isAdmin =
    members.data?.find((member) => member.userId === me.data?.id)?.role ===
    'ADMIN'
  const ready = me.data && members.data && entries.data
  const loadError = entries.error ?? members.error

  function closeLog() {
    focusId.current = logButtonId
    setLogging(false)
  }

  function closeEdit(entryId: string) {
    focusId.current = `${entryId}-edit`
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <h4
        id={entriesHeadingId(card.id)}
        tabIndex={-1}
        className="font-semibold outline-none"
      >
        Entries
      </h4>
      {loadError && <Alert>{loadError.message}</Alert>}
      {logging ? (
        <EntryForm
          timeZone={project.timeZone}
          onCancel={closeLog}
          onSave={(body) => log.mutateAsync(body).then(closeLog)}
          saving={log.isPending}
          track={track}
        />
      ) : (
        <Button
          id={logButtonId}
          variant="secondary"
          className="self-start"
          onClick={() => {
            setEditing(null)
            setLogging(true)
          }}
        >
          Log time
        </Button>
      )}
      {!ready ? (
        !loadError && <Loading />
      ) : entries.data.length === 0 ? (
        <p className="text-muted">No time logged yet</p>
      ) : (
        <ul aria-label="Entries" className="flex flex-col gap-3">
          {entries.data.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id}>
                <EntryForm
                  entry={entry}
                  timeZone={project.timeZone}
                  track={track}
                  saving={change.isPending}
                  onCancel={() => closeEdit(entry.id)}
                  onSave={(values) => {
                    const changes = changesOf(entry, values)
                    return Object.keys(changes).length === 0
                      ? Promise.resolve(closeEdit(entry.id))
                      : change
                          .mutateAsync({ entryId: entry.id, ...changes })
                          .then(() => closeEdit(entry.id))
                  }}
                />
              </li>
            ) : (
              <EntryRow
                key={entry.id}
                entry={entry}
                reason={reasonFor(entry, isAdmin, me.data?.id)}
                confirming={change.isPending}
                onEdit={() => {
                  setLogging(false)
                  setEditing(entry.id)
                }}
                onDelete={(button) => {
                  remove.reset()
                  setDeleting({ entry, button })
                }}
                onConfirm={() =>
                  track(change.mutateAsync({ entryId: entry.id }))
                }
              />
            ),
          )}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this time entry?"
          confirmLabel="Delete"
          returnFocusTo={deleting.button}
          pending={remove.isPending}
          error={remove.error}
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            remove.mutateAsync(deleting.entry.id).then(
              () => {
                // The deleted row's button is gone, so focus goes to the heading.
                focusId.current = entriesHeadingId(card.id)
                setDeleting(null)
              },
              () => {},
            )
          }
        >
          <p>Are you sure?</p>
          <p className="text-muted">
            {`${formatMinutes(deleting.entry.minutes)} on ${dayText(deleting.entry.workDate)} will be deleted.`}
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}

// Why this person may not change the entry, or null when they may. A project
// admin may change any entry; anyone else only their own, for 24 hours.
function reasonFor(
  entry: TimeEntryWithPerson,
  isAdmin: boolean,
  meId: string | undefined,
): string | null {
  if (isAdmin) {
    return null
  }
  if (entry.userId !== meId) {
    return NOT_YOURS
  }
  return Date.now() - Date.parse(entry.createdAt) <= OWN_EDIT_WINDOW_MS
    ? null
    : TOO_OLD
}

function EntryRow({
  entry,
  reason,
  confirming,
  onEdit,
  onDelete,
  onConfirm,
}: {
  entry: TimeEntryWithPerson
  reason: string | null
  confirming: boolean
  onEdit: () => void
  onDelete: (button: HTMLElement) => void
  onConfirm: () => void
}) {
  const reasonId = `${entry.id}-reason`
  const off = reason !== null
  const describedBy = off ? reasonId : undefined
  return (
    <li className="flex flex-col gap-1 border-b border-line pb-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{entry.user.displayName}</span>
        <span>{dayText(entry.workDate)}</span>
        <span>{formatMinutes(entry.minutes)}</span>
        {entry.startedAt !== null && (
          <span className="rounded bg-subtle px-1.5 text-xs">Timer</span>
        )}
        {entry.needsReview && (
          <span className="rounded bg-danger-soft px-1.5 text-xs text-danger">
            Needs review
          </span>
        )}
      </div>
      {entry.note && <p className="break-words">{entry.note}</p>}
      <div className="flex flex-wrap gap-2">
        {entry.needsReview && (
          <Button
            variant="secondary"
            className="min-h-8"
            disabled={off || confirming}
            aria-describedby={describedBy}
            onClick={onConfirm}
          >
            Confirm
          </Button>
        )}
        <Button
          id={`${entry.id}-edit`}
          variant="secondary"
          className="min-h-8"
          disabled={off}
          aria-describedby={describedBy}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          className="min-h-8 text-danger"
          disabled={off}
          aria-describedby={describedBy}
          onClick={(event) => onDelete(event.currentTarget)}
        >
          Delete
        </Button>
      </div>
      {off && (
        <p id={reasonId} className="text-muted">
          {reason}
        </p>
      )}
    </li>
  )
}

// The minutes typed as hours and minutes, or what is wrong with them. Nothing
// typed is 0, which the shared rule refuses in its own words.
function minutesFrom(hours: string, minutes: string): number | string {
  const wholeNumber = /^\d*$/
  if (!wholeNumber.test(hours.trim()) || !wholeNumber.test(minutes.trim())) {
    return 'Use whole numbers'
  }
  const m = Number(minutes)
  if (m > 59) {
    return 'Minutes go up to 59'
  }
  return joinMinutes(Number(hours), m)
}

// Hours, minutes, day and note: to log time, or (with `entry`) to change an
// entry. Checked with the shared rule; an edit sends only what changed.
function EntryForm({
  entry,
  timeZone,
  onSave,
  onCancel,
  track,
  saving,
}: {
  entry?: TimeEntryWithPerson
  timeZone: string
  onSave: (values: NewTimeEntryBody) => Promise<unknown>
  onCancel: () => void
  track: Track
  saving: boolean
}) {
  const id = useId()
  const split = splitMinutes(entry?.minutes ?? 0)
  const savedDay = entry?.workDate.slice(0, 10)
  const [hours, setHours] = useState(entry ? String(split.hours) : '')
  const [minutes, setMinutes] = useState(entry ? String(split.minutes) : '')
  const [date, setDate] = useState(savedDay ?? today(timeZone))
  const [note, setNote] = useState(entry?.note ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const first = useRef<HTMLInputElement>(null)
  const last = today(timeZone)

  useEffect(() => first.current?.focus(), [])

  function submit(event: FormEvent) {
    event.preventDefault()
    const total = minutesFrom(hours, minutes)
    if (typeof total === 'string') {
      setErrors({ minutes: total })
      return
    }
    if (date === '') {
      setErrors({ workDate: 'Choose a day' })
      return
    }
    const checked = checkForm(newTimeEntrySchema, {
      minutes: total,
      workDate: date,
      // No note is left out, not sent empty.
      note: note.trim() === '' ? undefined : note,
    })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    track(onSave(checked.data))
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
      className="flex flex-col gap-3 rounded-lg border border-line p-3"
    >
      <fieldset
        aria-describedby={errors.minutes ? `${id}-minutes-error` : undefined}
        className="flex flex-col gap-1.5"
      >
        <legend className="sr-only">Time spent</legend>
        <div className="flex items-center gap-2">
          <input
            ref={first}
            id={`${id}-hours`}
            inputMode="numeric"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            aria-invalid={errors.minutes ? true : undefined}
            className={`${inputClass} w-16`}
          />
          <label htmlFor={`${id}-hours`}>Hours</label>
          <input
            id={`${id}-minutes`}
            inputMode="numeric"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            aria-invalid={errors.minutes ? true : undefined}
            className={`${inputClass} w-16`}
          />
          <label htmlFor={`${id}-minutes`}>Minutes</label>
        </div>
        {errors.minutes && (
          <p id={`${id}-minutes-error`} className="text-danger">
            {errors.minutes}
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-date`} className="font-semibold">
          Date
        </label>
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          max={last}
          onChange={(event) => setDate(event.target.value)}
          aria-invalid={errors.workDate ? true : undefined}
          aria-describedby={`${id}-zone${errors.workDate ? ` ${id}-date-error` : ''}`}
          className={`${inputClass} self-start`}
        />
        <p id={`${id}-zone`} className="text-xs text-muted">
          Days are in {timeZone}
        </p>
        {errors.workDate && (
          <p id={`${id}-date-error`} className="text-danger">
            {errors.workDate}
          </p>
        )}
      </div>
      <TextField
        label="Note"
        value={note}
        error={errors.note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// What an edit changes: only the values that differ from the entry. A note
// that was cleared is null.
function changesOf(
  entry: TimeEntryWithPerson,
  values: NewTimeEntryBody,
): TimeEntryChangesBody {
  const changes: TimeEntryChangesBody = {}
  if (values.minutes !== entry.minutes) {
    changes.minutes = values.minutes
  }
  if (values.workDate !== entry.workDate.slice(0, 10)) {
    changes.workDate = values.workDate
  }
  if ((values.note ?? '') !== (entry.note ?? '')) {
    changes.note = values.note ?? null
  }
  return changes
}
