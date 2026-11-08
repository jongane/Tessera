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
// `nextBefore`. Lines are listed newest first, as the API sends them.

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
    const start = before ? lines.findIndex((l) => l.id === before) + 1 : 0
    if (before && start === 0) return apiError(400, 'before: not a valid value')
    const items = lines.slice(start, start + limit)
    const more = start + limit < lines.length
    return HttpResponse.json({
      items,
      nextBefore: more ? items[items.length - 1]!.id : null,
    })
  })
  return { lines, requests, handler }
}
