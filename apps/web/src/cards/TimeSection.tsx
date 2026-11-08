import { type BoardCard, formatMinutes, type Project } from '@tessera/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Fragment, type ReactNode, useId, useState } from 'react'
import { ApiError } from '../api/client'
import {
  cardQuery,
  useCardTotals,
  useStartTimer,
  useStopTimer,
  useTimer,
} from '../api/time'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { runningTime, useNow } from './clock'
import { TimeEntries } from './TimeEntries'

// `track` shows "Couldn't save" (or the server's reason) if the change fails.
type Track = (saving: Promise<unknown>) => void

// The card's estimate, time spent, timer and time entries
// (docs/card-features.md, section 6).
export function TimeSection({
  card,
  project,
  track,
}: {
  card: BoardCard
  project: Project
  track: Track
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="font-semibold">
        Time
      </h3>
      <Totals card={card} />
      <TimerControls card={card} track={track} />
      <TimeEntries card={card} project={project} track={track} />
    </section>
  )
}

// What is estimated, spent and left. A card with subtasks shows the sum of
// theirs, its own estimate as the "original estimate", and how much of the
// time was spent on the card itself.
function Totals({ card }: { card: BoardCard }) {
  const totals = useCardTotals(card.id)
  if (!totals.data) {
    return null
  }
  const { estimateMinutes, originalEstimateMinutes, timeSpentMinutes } =
    totals.data
  const hasSubtasks = card.subtaskProgress.total > 0
  const left =
    estimateMinutes === null ? null : estimateMinutes - timeSpentMinutes
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex flex-wrap gap-x-2">
        <Joined>
          {[
            estimateMinutes !== null && (
              <Item
                key="estimate"
                label="Estimate"
                value={formatMinutes(estimateMinutes)}
              />
            ),
            <Item
              key="spent"
              label="Time spent"
              value={formatMinutes(timeSpentMinutes)}
            />,
            left !== null &&
              (left >= 0 ? (
                <Item key="left" label="Left" value={formatMinutes(left)} />
              ) : (
                <span key="over" className="font-semibold text-danger">
                  {`Over by ${formatMinutes(-left)}`}
                </span>
              )),
          ]}
        </Joined>
      </p>
      {hasSubtasks && (
        <p className="flex flex-wrap gap-x-4 text-muted">
          {originalEstimateMinutes !== null && (
            <Item
              label="Original estimate"
              value={formatMinutes(originalEstimateMinutes)}
            />
          )}
          <span>{`of which ${formatMinutes(totals.data.ownTimeMinutes)} on this card`}</span>
        </p>
      )}
    </div>
  )
}

// The items with a "·" between them. The dots are only for the eye.
function Joined({ children }: { children: ReactNode[] }) {
  return children
    .filter((child) => child !== false)
    .map((child, index) => (
      <Fragment key={index}>
        {index > 0 && <span aria-hidden="true">·</span>}
        {child}
      </Fragment>
    ))
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted">{label}</span> <b>{value}</b>
    </span>
  )
}

// Start and Stop for this card's timer. Starting while the timer runs on
// another card asks first.
function TimerControls({ card, track }: { card: BoardCard; track: Track }) {
  const queryClient = useQueryClient()
  const timer = useTimer()
  const start = useStartTimer(card.id)
  const stop = useStopTimer()
  const [elsewhere, setElsewhere] = useState<string | null>(null)
  // True after stopping a timer that ran under half a minute.
  const [nothingSaved, setNothingSaved] = useState(false)
  const [startButton, setStartButton] = useState<HTMLElement | null>(null)
  const running = timer.data?.timer ?? null
  const here = running?.cardId === card.id
  const now = useNow(here)

  // The number of the card the timer runs on, for the question.
  async function numberOf(cardId: string) {
    try {
      return (await queryClient.fetchQuery(cardQuery(cardId))).number
    } catch {
      return 'another card'
    }
  }

  function onStart(button: HTMLElement) {
    setStartButton(button)
    setNothingSaved(false)
    track(
      start.mutateAsync(false).catch(async (error: unknown) => {
        const runningCardId =
          error instanceof ApiError && error.status === 409
            ? error.details.runningCardId
            : undefined
        if (typeof runningCardId !== 'string') {
          throw error
        }
        setElsewhere(await numberOf(runningCardId))
      }),
    )
  }

  function onStop() {
    track(
      stop
        .mutateAsync()
        .then((result) => setNothingSaved(result.entry === null)),
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {here ? (
        <>
          <span className="font-mono text-lg">
            {runningTime(running!.startedAt, now)}
          </span>
          <Button
            variant="secondary"
            disabled={stop.isPending}
            onClick={onStop}
          >
            Stop timer
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          disabled={start.isPending || timer.isPending}
          onClick={(event) => onStart(event.currentTarget)}
        >
          Start timer
        </Button>
      )}
      {nothingSaved && !here && (
        <p role="status" className="text-muted">
          Under half a minute, nothing saved
        </p>
      )}
      {elsewhere !== null && (
        <ConfirmDialog
          title="Stop the running timer?"
          confirmLabel="Stop it and start here"
          returnFocusTo={startButton}
          onCancel={() => setElsewhere(null)}
          onConfirm={() => {
            setElsewhere(null)
            track(start.mutateAsync(true))
          }}
        >
          {`Your timer is running on ${elsewhere}. Stop it (its time is saved) and start here?`}
        </ConfirmDialog>
      )}
    </div>
  )
}
