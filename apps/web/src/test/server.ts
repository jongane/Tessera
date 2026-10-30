import type { ApiErrorBody, Me } from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// A fake API for component tests. Each test says what the API answers with
// server.use(...). A request nobody answered fails the test.
export const server = setupServer()

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
