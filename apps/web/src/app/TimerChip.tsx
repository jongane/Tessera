import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { runningTime, useNow } from '../cards/clock'
import { useStopTimer, useTimer, useTimerCard } from '../api/time'
import { Button } from '../ui/Button'

// Your running timer, in the top bar of every signed-in screen: the card it
// runs on, the running time, and Stop (docs/web-app.md, section 3).
export function TimerChip() {
  const timer = useTimer()
  const stop = useStopTimer()
  const running = timer.data?.timer ?? null
  const card = useTimerCard(running?.cardId)
  const now = useNow(running !== null)
  // Said for a few seconds after stopping a timer that saved nothing.
  const [nothingSaved, setNothingSaved] = useState(false)

  useEffect(() => {
    if (!nothingSaved) {
      return
    }
    const timeout = setTimeout(() => setNothingSaved(false), 6000)
    return () => clearTimeout(timeout)
  }, [nothingSaved])

  function onStop() {
    stop.mutate(undefined, {
      onSuccess: (result) => setNothingSaved(result.entry === null),
    })
  }

  return (
    <>
      {nothingSaved && (
        <p role="status" className="text-muted">
          Under half a minute, nothing saved
        </p>
      )}
      {running && !card.isPending && (
        <div
          role="group"
          aria-label="Running timer"
          className="flex items-center gap-2 rounded-lg bg-accent-soft py-1 pr-1 pl-3"
        >
          {card.data ? (
            <Link
              to={`/${card.data.number}`}
              className="font-semibold text-accent hover:underline"
            >
              {card.data.number}
            </Link>
          ) : (
            <span className="font-semibold">Timer</span>
          )}
          <span className="font-mono">
            {runningTime(running.startedAt, now)}
          </span>
          <Button
            variant="secondary"
            className="min-h-8 text-sm"
            disabled={stop.isPending}
            onClick={onStop}
          >
            Stop timer
          </Button>
          {stop.isError && (
            <span role="alert" className="text-danger">
              Couldn’t stop, try again
            </span>
          )}
        </div>
      )}
    </>
  )
}
