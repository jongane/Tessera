import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { http as mswHttp, HttpResponse, passthrough } from 'msw'
import { Server } from 'socket.io'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { board, boardPath } from '../test/card-panel'
import { fakeBoard } from '../test/fake-board'
import { renderApp } from '../test/render'
import { ana, apiError, server as msw } from '../test/server'
import { setLiveConnectionFactory } from './live-connection'

// Live updates PR, final fixes (criterion 55; the first test is the
// antagonist's proof, kept as a regression test). Contract: the session check
// (GET /api/auth/me) runs again on every refused handshake whose last check
// was not a 200 (a 503, a network error), on the retry schedule of criterion
// 44. After a 200 no check is made for the rest of that outage; a 401 shows
// the sign-in page.

let http: HttpServer | undefined
let io: Server | undefined

afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const closing = new Promise<void>((resolve) => {
    if (!io) return resolve()
    void io.close(() => resolve())
  })
  http?.closeAllConnections()
  await closing
  io = undefined
  http = undefined
  vi.unstubAllGlobals()
})

let handshakes = 0

// A server that lets the first handshake in, closes that connection, and
// refuses every later handshake; the app starts on a board with it.
async function startOutage() {
  handshakes = 0
  http = createServer()
  io = new Server(http, { path: '/socket.io', cors: { origin: true } })
  io.use((_socket, next) => {
    handshakes += 1
    next(handshakes === 1 ? undefined : new Error('Please sign in'))
  })
  io.on('connection', (socket) => {
    setTimeout(() => socket.disconnect(true), 300)
  })
  await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  vi.stubGlobal('location', new URL(`http://127.0.0.1:${port}/`))
  msw.use(mswHttp.all(/127\.0\.0\.1/, () => passthrough()))
  setLiveConnectionFactory(null)
  fakeBoard(board())
  renderApp(boardPath)
  await screen.findByRole('button', { name: 'WEB-12 Login page' })
}

describe('Final round: the session check after a refused handshake (criterion 55)', () => {
  // 55
  it('shows the sign-in page when the first session check failed for a moment and the session has ended', async () => {
    await startOutage()
    // The session has ended. The first check meets a brief server problem;
    // every later one gets the 401.
    let checks = 0
    msw.use(
      mswHttp.get('/api/auth/me', () => {
        checks += 1
        return checks === 1
          ? apiError(503, 'Service unavailable')
          : apiError(401, 'Not signed in')
      }),
    )

    const end = Date.now() + 9000
    while (
      Date.now() < end &&
      !screen.queryByRole('heading', { name: 'Sign in to Tessera' })
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
    }
    expect({
      signInShown:
        screen.queryByRole('heading', { name: 'Sign in to Tessera' }) !== null,
      sessionChecks: checks,
      handshakesTried: handshakes,
    }).toMatchObject({ signInShown: true })
  }, 15_000)

  // 55
  it('checks again after a network error, and stops at the 401', async () => {
    await startOutage()
    let checks = 0
    msw.use(
      mswHttp.get('/api/auth/me', () => {
        checks += 1
        return checks <= 2 ? HttpResponse.error() : apiError(401, 'Not signed in')
      }),
    )

    expect(
      await screen.findByRole(
        'heading',
        { name: 'Sign in to Tessera' },
        { timeout: 12_000 },
      ),
    ).toBeInTheDocument()
    expect(checks).toBe(3)
  }, 20_000)

  // 55
  it('makes no further check in the outage once one answered 200', async () => {
    await startOutage()
    let checks = 0
    msw.use(
      mswHttp.get('/api/auth/me', () => {
        checks += 1
        return HttpResponse.json(ana)
      }),
    )

    // Refused handshakes at about 1.3 s, 3.3 s and 7.3 s after the start.
    await waitFor(() => expect(handshakes).toBeGreaterThanOrEqual(4), {
      timeout: 12_000,
    })

    expect(checks).toBe(1)
    expect(
      screen.queryByRole('heading', { name: 'Sign in to Tessera' }),
    ).toBeNull()
  }, 20_000)
})
