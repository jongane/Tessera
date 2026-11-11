// The time of something that happened, as the Activity tab and the chat
// messages show it.
import { ago, exactTime } from './time-text'

// The time as "3 hours ago", with the exact time in the viewer's own zone on
// hover and for screen readers.
export function When({ createdAt, now }: { createdAt: string; now: number }) {
  const exact = exactTime(new Date(createdAt))
  return (
    <time dateTime={createdAt} title={exact} className="text-muted">
      {ago(createdAt, now)}
      <span className="sr-only">{`, ${exact}`}</span>
    </time>
  )
}
