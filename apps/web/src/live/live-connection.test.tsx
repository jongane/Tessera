import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import {
  board,
  boardPath,
  cardPanel,
  login,
  openCard,
} from '../test/card-panel'
import { general, openChat, typeInto } from '../test/chat-panel'
import { fakeBoard } from '../test/fake-board'
import { live } from '../test/fake-live'
import { fakeMessages, message } from '../test/fake-messages'
import { backlog, sprint } from '../test/fixtures'
import { renderApp } from '../test/render'
import { recordRequests } from '../test/requests'
import { ana, server, signedInAs } from '../test/server'

// Live updates PR (plan "live updates"): the web app's live connection
// (acceptance criteria 13, 14, 15, 22, 23, 30 and 31). The fake connection
// is in src/test/fake-live.ts.

const BOARD_URL = `/api/boards/${sprint.id}`
const CHATS_URL = `/api/boards/${sprint.id}/chats`

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('The live connection', () => {
  // 13
  it('opens one connection and joins the room of the open board', async () => {
    openCard()
    await cardPanel()

    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    expect(live.opened).toBe(1)
  })

  // 13
  it('leaves the room of the old board and joins the new one when you change board', async () => {
    const { router } = openCard()
    await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    server.use(
      http.get(`/api/boards/${backlog.id}/chats`, () => HttpResponse.json([])),
    )

    await act(async () => {
      await router.navigate(`/WEB/boards/${backlog.id}`)
    })

    await waitFor(() => expect(live.rooms).toEqual([backlog.id]))
    expect(live.opened).toBe(1)
  })

  // 13
  it('closes the connection when you sign out', async () => {
    fakeBoard(board())
    server.use(
      http.post('/api/auth/sign-out', () => {
        server.use(signedInAs(null))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderApp(boardPath)
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    expect(live.closed).toBe(false)

    await user.click(
      await screen.findByRole('button', { name: 'Account menu for Ana' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(live.closed).toBe(true))
  })
})

describe('Telling the server which tab saved (criterion 14)', () => {
  // 14
  it('sends this tab’s connection id with every save of a card', async () => {
    const requests = recordRequests()
    const { user } = openCard()
    const panel = await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))

    const title = within(panel).getByLabelText('Title')
    await user.clear(title)
    await typeInto(user, title, 'Sign-in page{Enter}')
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'High')

    await waitFor(() => expect(requests.saves()).toHaveLength(2))
    for (const save of requests.saves()) {
      expect(save.headers.get('X-Live-Connection')).toBe(live.id)
    }
  })

  // 14
  it('sends this tab’s connection id with a sent message', async () => {
    const requests = recordRequests()
    const { user } = openChat({ messages: [message('Hello')] })
    await screen.findByText('Hello')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))

    const box = await screen.findByRole('textbox', { name: 'Message' })
    await typeInto(user, box, 'Hi there{Enter}')

    await waitFor(() => expect(requests.saves()).toHaveLength(1))
    expect(requests.saves()[0]!.path).toBe(`/api/chats/${general.id}/messages`)
    expect(requests.saves()[0]!.headers.get('X-Live-Connection')).toBe(live.id)
  })

  // 14
  it('ignores a signal made by this tab, and reloads for one made by someone else', async () => {
    openCard()
    await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const requests = recordRequests()

    await live.signal({ type: 'board', by: live.id })
    await advance(1000)
    expect(requests.reads(BOARD_URL)).toBe(0)

    await live.signal({ type: 'board', by: 'someone-else' })
    await waitFor(() => expect(requests.reads(BOARD_URL)).toBe(1))
  })
})

describe('No reload on a timer (criterion 15)', () => {
  // 15
  it('sends no request on its own while a board, a card and a chat are open', async () => {
    fakeBoard(board(), { chats: [general] })
    const messages = fakeMessages({ [general.id]: [message('Hello')] })
    server.use(...messages.handlers)
    renderApp(`${boardPath}?card=${login.id}&chat=${general.id}`)
    await cardPanel()
    await screen.findByText('Hello')
    await advance(1000)
    const requests = recordRequests()

    await advance(10 * 60_000)

    expect(requests.seen.map((r) => `${r.method} ${r.path}`)).toEqual([])
  })

  // 15
  it('still reloads when you come back to the browser tab', async () => {
    openCard()
    await cardPanel()
    await advance(1000)
    const requests = recordRequests()

    window.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => expect(requests.reads(BOARD_URL)).toBeGreaterThan(0))
  })
})

describe('The “Reconnecting…” bar (criteria 22 and 23)', () => {
  function bar() {
    return screen.queryByText('Reconnecting…')
  }

  // 22, 31
  it('shows as a polite status once the connection has been down for more than 3 seconds', async () => {
    const { container } = openCard()
    await cardPanel()
    expect(bar()).toBeNull()

    await live.disconnect()
    await advance(2900)
    expect(bar()).toBeNull()
    await advance(300)

    const shown = await screen.findByText('Reconnecting…')
    expect(shown.closest('[role="status"], output')).not.toBeNull()
    expect(shown.closest('[aria-live="assertive"], [role="alert"]')).toBeNull()
    // At the top of the app, above the board.
    const heading = screen.getByRole('heading', { level: 1, name: 'Sprint 1' })
    expect(
      shown.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expectNoAccessibilityProblems(container)
  })

  // 22
  it('shows nothing when the connection is back within 3 seconds, and starts counting again for the next drop', async () => {
    openCard()
    await cardPanel()

    await live.disconnect()
    await advance(2500)
    await live.reconnect()
    await advance(5000)
    expect(bar()).toBeNull()

    await live.disconnect()
    await advance(2500)
    expect(bar()).toBeNull()
    await advance(1000)
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument()
  })

  // 23
  it('goes away without a “Back online” message when the connection is back', async () => {
    openCard()
    await cardPanel()
    await live.disconnect()
    await advance(3500)
    await screen.findByText('Reconnecting…')

    await live.reconnect()

    await waitFor(() => expect(bar()).toBeNull())
    expect(screen.queryByText(/back online/i)).toBeNull()
    expect(screen.queryByText(/reconnected/i)).toBeNull()
  })

  // 23
  it('joins the board’s room again, and reloads the board, the card, the chat list and the open chat once', async () => {
    fakeBoard(board(), { chats: [general] })
    const messages = fakeMessages({ [general.id]: [message('Hello')] })
    server.use(...messages.handlers)
    renderApp(`${boardPath}?card=${login.id}&chat=${general.id}`)
    await cardPanel()
    await screen.findByText('Hello')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await live.disconnect()
    await advance(4500)
    const requests = recordRequests()

    await live.reconnect()

    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await waitFor(() =>
      expect(requests.reads(`/api/chats/${general.id}/messages`)).toBe(1),
    )
    await advance(1000)
    expect(requests.reads(BOARD_URL)).toBe(1)
    expect(requests.reads(CHATS_URL)).toBe(1)
    expect(requests.reads(`/api/cards/${login.id}/checklists`)).toBe(1)
    expect(requests.reads(`/api/chats/${general.id}/messages`)).toBe(1)
  })

  // 23
  it('shows what changed while the connection was down', async () => {
    fakeBoard(board(), { chats: [general] })
    const messages = fakeMessages({ [general.id]: [message('Hello')] })
    server.use(...messages.handlers)
    renderApp(`${boardPath}?chat=${general.id}`)
    await screen.findByText('Hello')
    await live.disconnect()
    messages.arrive(general.id, message('Sent while you were away'))

    await live.reconnect()

    expect(await screen.findByText('Sent while you were away')).toBeVisible()
  })
})

describe('Removed from the project (criterion 30)', () => {
  // 30
  it('gets no more changes, and the next reload shows “Board not found”', async () => {
    openCard()
    await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const requests = recordRequests()

    // Ana is removed: the server stops sending signals and answers 404.
    server.use(
      signedInAs(ana),
      http.get(BOARD_URL, () =>
        HttpResponse.json(
          { statusCode: 404, message: 'Board not found' },
          { status: 404 },
        ),
      ),
    )
    await advance(2 * 60_000)
    expect(requests.reads(BOARD_URL)).toBe(0)
    expect(
      screen.queryByRole('heading', { name: 'Board not found' }),
    ).toBeNull()

    window.dispatchEvent(new Event('visibilitychange'))

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeInTheDocument()
  })
})
