import type { ApiErrorBody, Me } from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// A fake API for component tests. Each test says what the API answers with
// server.use(...). A request nobody answered fails the test, except the
// few below that every open card makes, which answer "nothing yet".
export const server = setupServer(
  http.get('/api/cards/:cardId/checklists', () => HttpResponse.json([])),
  // Nobody has a timer running, and no card has time logged, unless a test
  // says so (every signed-in screen asks for the timer, for the top-bar chip).
  http.get('/api/timer', () => HttpResponse.json({ timer: null })),
  http.get('/api/cards/:cardId/time-entries', () => HttpResponse.json([])),
  // No card has any history yet (the Activity tab asks when it is opened).
  http.get('/api/cards/:cardId/activity', () =>
    HttpResponse.json({ items: [], nextBefore: null }),
  ),
  // A card with subtasks asks for its rolled-up totals.
  http.get('/api/cards/:cardId/time-totals', () =>
    HttpResponse.json({
      estimateMinutes: null,
      originalEstimateMinutes: null,
      timeSpentMinutes: 0,
      ownTimeMinutes: 0,
    }),
  ),
)

export const ana: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@example.com',
  displayName: 'Ana',
  isServerAdmin: false,
}

export function apiError(statusCode: number, message: string) {
  const body: ApiErrorBody = { statusCode, message }
  return HttpResponse.json(body, { status: statusCode })
}

// Signed in as `me`, or signed out when `me` is null.
export function signedInAs(me: Me | null) {
  return http.get('/api/auth/me', () =>
    me ? HttpResponse.json(me) : apiError(401, 'Not signed in'),
  )
}

export function signUpOpen(open: boolean) {
  return http.get('/api/server/settings', () =>
    HttpResponse.json({ signUpOpen: open }),
  )
}
