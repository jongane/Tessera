import type { ActivityLine, Project } from '@tessera/shared'
import { useState } from 'react'
import { useActivity } from '../api/activity'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { useEveryMinute } from './clock'
import { activitySentence } from './activity-sentence'

const LOAD_FAILED = 'Couldn’t load the activity'

// What was done to the card, newest first. Nothing here can be changed.
export function ActivityTab({
  cardId,
  project,
}: {
  cardId: string
  project: Project
}) {
  const activity = useActivity(cardId)
  const now = useEveryMinute()
  const lines = activity.data?.pages.flatMap((page) => page.items)

  if (lines === undefined) {
    return activity.isError ? (
      <div className="flex flex-col items-start gap-2 p-4">
        <Alert>{LOAD_FAILED}</Alert>
        <Button variant="secondary" onClick={() => void activity.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <Loading />
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {activity.isError && <Alert>{LOAD_FAILED}</Alert>}
      {lines.length === 0 ? (
        <p className="text-muted">No activity yet</p>
      ) : (
        <ol aria-label="Activity" className="flex flex-col gap-3">
          {lines.map((line) => (
            <ActivityItem
              key={line.id}
              line={line}
              project={project}
              now={now}
            />
          ))}
        </ol>
      )}
      {activity.hasNextPage && (
        <Button
          variant="secondary"
          className="self-start"
          disabled={activity.isFetching}
          onClick={() => void activity.fetchNextPage()}
        >
          Show older
        </Button>
      )}
    </div>
  )
}

function ActivityItem({
  line,
  project,
  now,
}: {
  line: ActivityLine
  project: Project
  now: number
}) {
  const [open, setOpen] = useState(false)
  const sentence = activitySentence(line, {
    projectCode: project.code,
    timeZone: project.timeZone,
    now: new Date(now),
  })
  return (
    <li className="flex flex-col gap-1 border-b border-line pb-3">
      <p>
        {sentence} <When createdAt={line.createdAt} now={now} />
      </p>
      {line.kind === 'DESCRIPTION_CHANGED' && (
        <>
          <Button
            variant="link"
            className="min-h-8 self-start"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Show changes
          </Button>
          {open && (
            <div className="grid gap-3 sm:grid-cols-2">
              <SavedText label="Before" text={line.details.from} />
              <SavedText label="After" text={line.details.to} />
            </div>
          )}
        </>
      )}
    </li>
  )
}

// The old or new description, as it was saved (not as formatting).
function SavedText({ label, text }: { label: string; text: string | null }) {
  const empty = text === null || text === ''
  return (
    <div role="group" aria-label={label} className="rounded-lg bg-subtle p-2">
      <p className="text-xs font-semibold text-muted" aria-hidden="true">
        {label}
      </p>
      <p
        className={`whitespace-pre-wrap break-words ${empty ? 'text-muted' : ''}`}
      >
        {empty ? '(empty)' : text}
      </p>
    </div>
  )
}

// Made on each use: it reads the viewer's zone as it is then.
function exactTime(at: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

// "3 hours ago".
function ago(createdAt: string, now: number) {
  const seconds = Math.max(0, (now - Date.parse(createdAt)) / 1000)
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      return format.format(-Math.floor(seconds / size), unit)
    }
  }
  return 'just now'
}

// The time as "3 hours ago", with the exact time in the viewer's own zone on
// hover and for screen readers.
function When({ createdAt, now }: { createdAt: string; now: number }) {
  const exact = exactTime(new Date(createdAt))
  return (
    <time dateTime={createdAt} title={exact} className="text-muted">
      {ago(createdAt, now)}
      <span className="sr-only">{`, ${exact}`}</span>
    </time>
  )
}
