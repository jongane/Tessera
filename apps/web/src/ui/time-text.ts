// How a moment is written: "3 hours ago", and the exact time for hover and
// screen readers.

// Made on each use: it reads the viewer's zone as it is then.
export function exactTime(at: Date) {
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
export function ago(createdAt: string, now: number) {
  const seconds = Math.max(0, (now - Date.parse(createdAt)) / 1000)
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      return format.format(-Math.floor(seconds / size), unit)
    }
  }
  return 'just now'
}
