import type { BoardCard, CardTotals, Me } from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { website } from './fixtures'
import { apiError } from './server'

// The fake API's time entries and timer, for the card panel's tests. The
// shapes follow what the real API answers (docs/api.md, "Time"); dates are
// ISO text, and a work date is midnight UTC of its day. These types will
// move to packages/shared when the web app needs them.

export interface FakeTimeEntry {
  id: string
  projectId: string
  cardId: string
  userId: string
  // "2026-11-02T00:00:00.000Z" for the day 2 November.
  workDate: string
  minutes: number
  note: string | null
  startedAt: string | null
  endedAt: string | null
  needsReview: boolean
  createdAt: string
  user: { id: string; displayName: string }
}

export interface FakeTimer {
  userId: string
  projectId: string
  cardId: string
  startedAt: string
  workDate: string
}

let nextId = 1
function id(): string {
  return `dddddddd-dddd-4ddd-8ddd-${String(nextId++).padStart(12, '0')}`
}

// An entry by `user` for `minutes` on the day `workDate` (YYYY-MM-DD). The
// card is filled in when the fake API takes it. Entries made by the timer
// have `startedAt`.
export function entry(
  user: Me,
  minutes: number,
  workDate: string,
  fields: Partial<
    Pick<FakeTimeEntry, 'note' | 'startedAt' | 'needsReview' | 'createdAt'>
  > = {},
): FakeTimeEntry {
  return {
    id: id(),
    projectId: website.id,
    cardId: '',
    userId: user.id,
    workDate: `${workDate}T00:00:00.000Z`,
    minutes,
    note: null,
    startedAt: null,
    endedAt: null,
    needsReview: false,
    createdAt: '2026-10-30T09:00:00.000Z',
    ...fields,
    user: { id: user.id, displayName: user.displayName },
  }
}

export interface FakeTimeOptions {
  // By card id; a card not listed has no time logged.
  entries?: Record<string, FakeTimeEntry[]>
  // The signed-in person's running timer, if any.
  timer?: { cardId: string; startedAt: string }
}

function day(iso: string) {
  return iso.slice(0, 10)
}

// Handlers that remember changes, so the panel reloads with what was saved.
// The clock is Date.now(), so a test can fix it with fake timers.
export function timeHandlers({
  me,
  start,
  record,
  cardOf,
}: {
  me: Me
  start: FakeTimeOptions
  record: (request: Request) => Promise<void>
  cardOf: (cardId: string) => BoardCard | undefined
}) {
  let entries: FakeTimeEntry[] = Object.entries(start.entries ?? {}).flatMap(
    ([cardId, list]) => list.map((e) => ({ ...structuredClone(e), cardId })),
  )
  let timer: FakeTimer | null = start.timer
    ? {
        userId: me.id,
        projectId: website.id,
        cardId: start.timer.cardId,
        startedAt: start.timer.startedAt,
        workDate: `${day(start.timer.startedAt)}T00:00:00.000Z`,
      }
    : null

  function entriesOf(cardId: string) {
    return entries
      .filter((e) => e.cardId === cardId)
      .sort(
        (a, b) =>
          b.workDate.localeCompare(a.workDate) ||
          b.createdAt.localeCompare(a.createdAt),
      )
  }

  // Saves the running timer as an entry; nothing when it ran under half a
  // minute, as the real API does.
  function saveTimer(): FakeTimeEntry | null {
    const running = timer!
    timer = null
    const ms = Date.now() - new Date(running.startedAt).getTime()
    if (ms < 30_000) return null
    const saved = entry(me, Math.round(ms / 60_000), day(running.workDate), {
      startedAt: running.startedAt,
      createdAt: new Date().toISOString(),
    })
    const full = {
      ...saved,
      cardId: running.cardId,
      endedAt: new Date().toISOString(),
    }
    entries = [...entries, full]
    return full
  }

  return [
    http.get('/api/cards/:cardId', ({ params }) => {
      const found = cardOf(String(params.cardId))
      return found
        ? HttpResponse.json({ ...found, chat: null })
        : apiError(404, 'Card not found')
    }),
    http.get('/api/cards/:cardId/time-entries', ({ params }) =>
      HttpResponse.json(entriesOf(String(params.cardId))),
    ),
    http.post(
      '/api/cards/:cardId/time-entries',
      async ({ request, params }) => {
        await record(request.clone())
        const body = (await request.json()) as {
          minutes: number
          workDate: string
          note?: string
        }
        const created = {
          ...entry(me, body.minutes, body.workDate, {
            note: body.note ?? null,
            createdAt: new Date().toISOString(),
          }),
          cardId: String(params.cardId),
        }
        entries = [...entries, created]
        return HttpResponse.json(created, { status: 201 })
      },
    ),
    http.patch('/api/time-entries/:entryId', async ({ request, params }) => {
      await record(request.clone())
      const body = (await request.json()) as {
        minutes?: number
        workDate?: string
        note?: string | null
      }
      const found = entries.find((e) => e.id === params.entryId)
      if (!found) return apiError(404, 'Time entry not found')
      if (body.minutes !== undefined) found.minutes = body.minutes
      if (body.workDate !== undefined)
        found.workDate = `${body.workDate}T00:00:00.000Z`
      if (body.note !== undefined) found.note = body.note
      found.needsReview = false
      return HttpResponse.json(found)
    }),
    http.delete('/api/time-entries/:entryId', async ({ request, params }) => {
      await record(request)
      entries = entries.filter((e) => e.id !== params.entryId)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/cards/:cardId/time-totals', ({ params }) => {
      const cardId = String(params.cardId)
      // A card with subtasks: this fake does not roll up, so a test's own
      // handler (or the default one) answers.
      if ((cardOf(cardId)?.subtaskProgress.total ?? 0) > 0) return undefined
      const spent = entriesOf(cardId).reduce((sum, e) => sum + e.minutes, 0)
      const totals: CardTotals = {
        estimateMinutes: cardOf(cardId)?.estimateMinutes ?? null,
        originalEstimateMinutes: null,
        timeSpentMinutes: spent,
        ownTimeMinutes: spent,
      }
      return HttpResponse.json(totals)
    }),
    http.get('/api/timer', () => HttpResponse.json({ timer })),
    http.post('/api/cards/:cardId/timer', async ({ request, params }) => {
      await record(request.clone())
      const { stopRunning } = (await request.json()) as {
        stopRunning?: boolean
      }
      const cardId = String(params.cardId)
      if (timer && timer.cardId !== cardId && !stopRunning) {
        return HttpResponse.json(
          {
            statusCode: 409,
            message:
              'A timer is already running on another card. Starting this one stops it.',
            runningCardId: timer.cardId,
          },
          { status: 409 },
        )
      }
      const savedEntry = timer && timer.cardId !== cardId ? saveTimer() : null
      timer ??= {
        userId: me.id,
        projectId: website.id,
        cardId,
        startedAt: new Date().toISOString(),
        workDate: `${day(new Date().toISOString())}T00:00:00.000Z`,
      }
      return HttpResponse.json({ timer, savedEntry }, { status: 201 })
    }),
    http.delete('/api/timer', async ({ request }) => {
      await record(request)
      if (!timer) return apiError(404, 'No timer is running')
      return HttpResponse.json({ entry: saveTimer() })
    }),
  ]
}
