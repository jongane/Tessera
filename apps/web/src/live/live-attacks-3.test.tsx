import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http as mswHttp, passthrough } from 'msw'
import { Server } from 'socket.io'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  board,
  boardPath,
  cardPanel,
  login,
  openCard,
  typeInto,
} from '../test/card-panel'
import { fakeBoard } from '../test/fake-board'
import { live } from '../test/fake-live'
import { sprint } from '../test/fixtures'
import { renderApp } from '../test/render'
import { recordRequests } from '../test/requests'
import { ana, server as msw, signedInAs } from '../test/server'
import { setLiveConnectionFactory } from './live-connection'

// Live updates PR, review and attack fixes round 3 (criteria 51 to 53; 54 is
// in the API tests). The first test is the antagonist's proof, kept as a
// regression test.
//
// Contracts. 51: after a refused handshake or a server close the app asks
// GET /api/auth/me once; a 401 stops the retries and shows the sign-in page,
// any other answer leaves the retries as they are. 52: “Reconnecting…” and
// the conflict note never share a status region that is read as a whole
// (aria-atomic not "false"). 53: a join retry timer never fires after the tab
// left that board.

const NOTE = 'Someone changed this while you were editing.'

let http: HttpServer | undefined
let io: Server | undefined

afterEach(async () => {
  io?.close()
  await new Promise((resolve) => setTimeout(resolve, 50))
  vi.unstubAllGlobals()
})

describe('Round 3: a session that really ended (criterion 51)', () => {
  // 51
  it('stops trying and shows the sign-in page when the server closed the connection because the session ended', async () => {
    let handshakes = 0
    http = createServer()
    io = new Server(http, { path: '/socket.io', cors: { origin: true } })
    io.use((_socket, next) => {
      handshakes += 1
      // The first handshake is let in; the session then ends (the server's
      // expired-session sweep), so every later one is refused.
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
    // From now on the API says the session has ended.
    msw.use(signedInAs(null))

    await waitFor(() => expect(handshakes).toBeGreaterThan(1), {
      timeout: 3000,
    })
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
      stillShowsReconnecting: screen.queryByText('Reconnecting…') !== null,
      handshakesTried: handshakes,
    }).toMatchObject({ signInShown: true, stillShowsReconnecting: false })
  }, 15_000)

  // 51
  it('keeps trying, with “Reconnecting…” shown, when the API says the person is still signed in', async () => {
    let handshakes = 0
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
    msw.use(signedInAs(ana))
    const requests = recordRequests()

    // Tries after 0.3 s (the close), then 1 s, 2 s and 4 s later.
    await waitFor(() => expect(handshakes).toBeGreaterThanOrEqual(3), {
      timeout: 9000,
    })

    expect(requests.reads('/api/auth/me'), 'asked who is signed in').toBe(1)
    expect(
      screen.queryByRole('heading', { name: 'Sign in to Tessera' }),
    ).toBeNull()
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument()
  }, 15_000)
})

// A region read as a whole whenever its content changes holds either text,
// never both.
function expectNoSharedRegion() {
  for (const region of screen.getAllByRole('status')) {
    const text = region.textContent ?? ''
    if (text.includes('Reconnecting…') && text.includes(NOTE)) {
      expect(region.getAttribute('aria-atomic'), region.outerHTML).toBe('false')
    }
  }
}

async function openConflict() {
  const { user, api } = openCard()
  const panel = await cardPanel()
  await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
  const title = within(panel).getByLabelText('Title')
  await user.clear(title)
  await typeInto(user, title, 'My title')
  const response = await fetch(
    new URL(`/api/cards/${login.id}`, window.location.origin),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Their title' }),
    },
  )
  expect(response.ok).toBe(true)
  api.requests.length = 0
  return { panel }
}

describe('Round 3: the page status region (criterion 52)', () => {
  // 52
  it('does not read the conflict note again when “Reconnecting…” shows', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { panel } = await openConflict()
      await live.cardChanged(login.id)
      await within(panel).findByText(NOTE)

      await live.disconnect()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500)
      })

      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
      expectNoSharedRegion()
    } finally {
      vi.useRealTimers()
    }
  })

  // 52
  it('does not read “Reconnecting…” again when the conflict panel opens', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { panel } = await openConflict()
      await live.disconnect()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500)
      })
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
      // A signal that was already on its way when the connection dropped.
      live.rooms.push(sprint.id)
      await live.cardChanged(login.id)
      await within(panel).findByText(NOTE)

      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
      expectNoSharedRegion()
    } finally {
      vi.useRealTimers()
    }
  })

  // 52
  it('does not read the conflict note again when “Reconnecting…” goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { panel } = await openConflict()
      await live.cardChanged(login.id)
      await within(panel).findByText(NOTE)
      await live.disconnect()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500)
      })

      await live.reconnect()

      await waitFor(() =>
        expect(screen.queryByText('Reconnecting…')).toBeNull(),
      )
      expectNoSharedRegion()
    } finally {
      vi.useRealTimers()
    }
  })
})

// 53
describe('Round 3: a join retry after leaving the board (criterion 53)', () => {
  // 53
  it('sends no join for the old board once the person has left it, after two failed joins that were in flight together', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      live.refuseJoins()
      live.holdJoins()
      const { router } = openCard()
      await cardPanel()
      await waitFor(() => expect(live.joined).toHaveLength(1))
      // A second join while the first is unanswered: the connection came
      // back (a reconnect is announced again).
      await live.reconnect()
      await waitFor(() => expect(live.joined).toHaveLength(2))
      // Both are refused, so each schedules a retry.
      await live.answerJoins()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })

      await act(async () => {
        await router.navigate('/projects')
      })
      const joinsBefore = live.joined.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000)
      })

      expect(live.joined.slice(joinsBefore)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
