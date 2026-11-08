import type {
  ActivityDetails,
  ActivityKind,
  ActivityLine,
  Me,
} from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { ana, apiError } from './server'

// The fake API's card history, for the Activity tab's tests. The shapes
// follow what the real API answers (docs/api.md, "Activity"): newest first,
// `{ items, nextBefore }`, and `before` takes the previous page's
// `nextBefore`. Lines are listed newest first, as the API sends them. The
// cursor is a line's sequence number as a string (the oldest line is 1), as
// the real API sends it.

let nextId = 1

// A history line. The actor is Ana unless a test says otherwise; null is a
// deleted account. The time is a moment before the tests' fixed clock.
export function activityLine<K extends ActivityKind>(
  kind: K,
  details: ActivityDetails[K],
  fields: {
    actor?: Pick<Me, 'id' | 'displayName'> | null
    createdAt?: string
  } = {},
): ActivityLine {
  const actor =
    fields.actor === undefined
      ? { id: ana.id, displayName: ana.displayName }
      : fields.actor === null
        ? null
        : { id: fields.actor.id, displayName: fields.actor.displayName }
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(nextId++).padStart(12, '0')}`,
    kind,
    details,
    actor,
    createdAt: fields.createdAt ?? '2026-11-07T07:00:00.000Z',
  } as ActivityLine
}

// Answers the card's activity from `lines` (newest first; a test may add to
// the front of the list later, as a change on the server would). `requests`
// lists the address of every request, to see what was asked for.
export function fakeActivity(lines: ActivityLine[]) {
  const requests: URL[] = []
  const handler = http.get('/api/cards/:cardId/activity', ({ request }) => {
    const url = new URL(request.url)
    requests.push(url)
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const before = url.searchParams.get('before')
    if (before !== null && !/^[0-9]{1,19}$/.test(before))
      return apiError(400, 'Unknown page cursor')
    // A line's sequence number is how many lines are at or below it.
    const start = before === null ? 0 : lines.length - Number(before) + 1
    const items = lines.slice(start, start + limit)
    const more = start + limit < lines.length
    const last = start + items.length - 1
    return HttpResponse.json({
      items,
      nextBefore: more ? String(lines.length - last) : null,
    })
  })
  return { lines, requests, handler }
}
