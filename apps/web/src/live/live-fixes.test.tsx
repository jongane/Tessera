import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  board,
  boardPath,
  cardPanel,
  login,
  openCard,
  typeInto,
} from '../test/card-panel'
import {
  chatPanel,
  general,
  messageList,
  messageOf,
  openChat,
} from '../test/chat-panel'
import { ben, fakeBoard } from '../test/fake-board'
import { live } from '../test/fake-live'
import { fakeMessages, message } from '../test/fake-messages'
import { backlog, sprint } from '../test/fixtures'
import { renderApp } from '../test/render'
import { recordRequests } from '../test/requests'
import { ana, server } from '../test/server'

// Live updates PR, review and attack fixes (criteria 34 to 42; the server's
// are in the API tests). Here: what the web app does after a join, while its
// own save is in flight, in the status region and in a deleted message.

const BOARD_URL = `/api/boards/${sprint.id}`
const CHATS_URL = `/api/boards/${sprint.id}/chats`
const NOTE = /Someone changed this while you were editing/

async function pause(ms = 400) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

// Someone else saves a change on the server (the fake API keeps it).
async function someoneElseSends(path: string, method: string, body: unknown) {
  const response = await fetch(new URL(path, window.location.origin), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.ok, `${method} ${path}`).toBe(true)
}

function openWithEverything() {
  const api = fakeBoard(board(), { chats: [general] })
  const messages = fakeMessages({ [general.id]: [message('Hello')] })
  server.use(...messages.handlers)
  renderApp(`${boardPath}?card=${login.id}&chat=${general.id}`)
  return { api, messages }
}

describe('Reloading once the join is answered (criterion 38)', () => {
  // 38
  it('reloads the board, chat list, open card and open chat once when the first join is answered, so changes made before it show', async () => {
    live.holdJoins()
    openWithEverything()
    await cardPanel()
    await screen.findByText('Hello')
    // Someone changes the card before this tab is in the room.
    await someoneElseSends(`/api/cards/${login.id}`, 'PATCH', {
      title: 'Sign-in page',
    })
    await pause()
    const requests = recordRequests()

    await live.answerJoins()

    await waitFor(() =>
      expect(
        within(
          screen.getByRole('complementary', { name: /^Card / }),
        ).getByLabelText('Title'),
      ).toHaveValue('Sign-in page'),
    )
    await pause()
    expect(requests.reads(BOARD_URL)).toBe(1)
    expect(requests.reads(CHATS_URL)).toBe(1)
    expect(requests.reads(`/api/cards/${login.id}/checklists`)).toBe(1)
    expect(requests.reads(`/api/chats/${general.id}/messages`)).toBe(1)
  })

  // 38
  it('reloads the new board once when the join for a changed board is answered', async () => {
    const { router } = openCard()
    await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    server.use(
      http.get(`/api/boards/${backlog.id}/chats`, () => HttpResponse.json([])),
    )
    live.holdJoins()
    await act(async () => {
      await router.navigate(`/WEB/boards/${backlog.id}`)
    })
    await screen.findByRole('heading', { level: 1, name: 'Backlog' })
    await pause()
    const requests = recordRequests()

    await live.answerJoins()

    await waitFor(() =>
      expect(requests.reads(`/api/boards/${backlog.id}`)).toBe(1),
    )
    await pause()
    expect(requests.reads(`/api/boards/${backlog.id}`)).toBe(1)
    expect(requests.reads(`/api/boards/${backlog.id}/chats`)).toBe(1)
  })

  // 38
  it('after a reconnect, reloads once each only when the join is answered, not when the connection comes back', async () => {
    openWithEverything()
    await cardPanel()
    await screen.findByText('Hello')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await live.disconnect()
    live.holdJoins()
    const requests = recordRequests()

    await live.reconnect()
    await pause()
    expect(requests.reads(BOARD_URL)).toBe(0)
    expect(requests.reads(`/api/chats/${general.id}/messages`)).toBe(0)

    await live.answerJoins()

    await waitFor(() =>
      expect(requests.reads(`/api/chats/${general.id}/messages`)).toBe(1),
    )
    await pause()
    expect(requests.reads(BOARD_URL)).toBe(1)
    expect(requests.reads(CHATS_URL)).toBe(1)
    expect(requests.reads(`/api/cards/${login.id}/checklists`)).toBe(1)
    expect(requests.reads(`/api/chats/${general.id}/messages`)).toBe(1)
  })
})

describe('A signal during your own card save (criterion 39)', () => {
  // The first test is the antagonist's proof; docs/web-app.md section 6: "A
  // signal that arrives while your own save of the same thing is still in
  // flight never undoes that save."

  // 39
  it('keeps your new title shown while it is being saved when someone else changes the card, and shows their change once it is saved', async () => {
    const { user } = openCard()
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    // Saving a title waits; the fake API then saves it as usual.
    server.use(
      http.patch('/api/cards/:cardId', async ({ request }) => {
        const body = (await request.clone().json()) as { title?: string }
        if (body.title !== undefined) await gate
        return undefined
      }),
    )
    const panel = await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const title = within(panel).getByLabelText('Title')
    await user.clear(title)
    await typeInto(user, title, 'My title{Enter}')

    // Someone else changes the priority; our title is not saved yet.
    await someoneElseSends(`/api/cards/${login.id}`, 'PATCH', {
      priority: 'HIGH',
    })
    await live.cardChanged(login.id)
    await pause()

    expect(title).toHaveValue('My title')
    expect(
      screen.getByRole('button', { name: 'WEB-12 My title' }),
    ).toBeInTheDocument()

    release()
    await waitFor(() =>
      expect(within(panel).getByLabelText('Priority')).toHaveDisplayValue(
        'High',
      ),
    )
    expect(title).toHaveValue('My title')
    expect(
      screen.getByRole('button', { name: 'WEB-12 My title' }),
    ).toBeInTheDocument()
  })

  // 39
  it('keeps a card in the column you moved it to while the move is being saved, then shows their change', async () => {
    const { user } = openCard()
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post('/api/cards/:cardId/move', async () => {
        await gate
        return undefined
      }),
    )
    const panel = await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await user.click(within(panel).getByRole('checkbox', { name: 'Complete' }))
    await user.click(
      await within(panel).findByRole('button', { name: 'Move to Done' }),
    )
    const inDone = () =>
      within(screen.getByRole('region', { name: 'Done' })).queryByRole(
        'button',
        { name: 'WEB-12 Login page' },
      )
    await waitFor(() => expect(inDone()).not.toBeNull())

    await someoneElseSends(`/api/cards/${login.id}`, 'PATCH', {
      priority: 'HIGH',
    })
    await live.cardChanged(login.id)
    await pause()

    expect(inDone()).not.toBeNull()

    release()
    await waitFor(() =>
      expect(within(panel).getByLabelText('Priority')).toHaveDisplayValue(
        'High',
      ),
    )
    expect(inDone()).not.toBeNull()
  })
})

describe('Announcements (criterion 40)', () => {
  // 40
  it('keeps the “Reconnecting…” status region in the page, empty when connected, and only changes its text', async () => {
    openCard()
    await cardPanel()
    const before = screen.queryAllByRole('status')
    expect(
      before.some((region) => region.textContent === ''),
      'an empty status region when connected',
    ).toBe(true)

    await live.disconnect()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3300))
    })

    const text = await screen.findByText('Reconnecting…')
    const region = text.closest('[role="status"], output')
    expect(region).not.toBeNull()
    // The very region that was there, now with text.
    expect(before).toContain(region)

    await live.reconnect()
    await waitFor(() => expect(region!.textContent).toBe(''))
    expect(region!.isConnected).toBe(true)
  })

  // 40
  it('announces “Someone changed this” politely', async () => {
    const { user } = openCard({ ...login, description: 'Old text' })
    const panel = await cardPanel()
    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, ' and mine')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await someoneElseSends(`/api/cards/${login.id}`, 'PATCH', {
      description: 'Their text',
    })
    await live.cardChanged(login.id)

    const note = await within(panel).findByText(NOTE)

    // The page's status region carries the announcement (criterion 49).
    expect(
      screen
        .getAllByRole('status')
        .some((region) => NOTE.test(region.textContent ?? '')),
    ).toBe(true)
    expect(note.closest('[aria-live="assertive"], [role="alert"]')).toBeNull()
  })
})

describe('Your message deleted while you edit it (criterion 41)', () => {
  // 41
  it('moves the focus to the message or the message list, never loses it', async () => {
    const { api, user } = openChat({
      me: ben,
      messages: [message('Oops', { author: ben })],
    })
    const list = await messageList()
    await within(list).findByText('Oops')
    const id = api.messagesOf(general.id)[0]!.id
    await user.click(
      within(list).getByRole('button', { name: 'Message options' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editor = await within(list).findByRole('textbox')
    await typeInto(user, editor, ' and more')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    expect(editor).toHaveFocus()
    const item = messageOf(editor)

    api.remove(id, ana)
    await live.messageChanged(general.id, id)

    await waitFor(() => expect(within(list).queryByRole('textbox')).toBeNull())
    expect(item.querySelector('del')).toHaveTextContent('Oops')
    const active = document.activeElement
    expect(active).not.toBe(document.body)
    expect(
      active !== null && chatPanel().contains(active) && list.contains(active),
      'the focus is on the message or the message list',
    ).toBe(true)
  })
})
