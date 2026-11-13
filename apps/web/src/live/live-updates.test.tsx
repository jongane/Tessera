import type { BoardView } from '@tessera/shared'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { board, boardPath, cardPanel, login, openCard } from '../test/card-panel'
import {
  ago,
  chatPanel,
  general,
  messageList,
  messageWith,
  MINUTE,
  NOW,
  openChat,
  releasePlan,
} from '../test/chat-panel'
import { fakeBoard, ben } from '../test/fake-board'
import { checklist } from '../test/fake-checklists'
import { live } from '../test/fake-live'
import { message } from '../test/fake-messages'
import { activityLine, fakeActivity } from '../test/fake-activity'
import { boardCard, boardColumn, boardView, sprint } from '../test/fixtures'
import { recordRequests } from '../test/requests'
import { renderApp } from '../test/render'
import {
  hasNotMoved,
  isAtBottom,
  scrollTo,
  stubLayout,
} from '../test/scroll'
import { server } from '../test/server'

// Live updates PR (plan "live updates"): what changes on screen when the
// server says someone else changed something (acceptance criteria 17 to 21).
// A signal tells the app what changed; the app reloads it through the API.

const BOARD_URL = `/api/boards/${sprint.id}`
const TO_DO = '88888888-8888-4888-8888-000000000001'
const DONE = '88888888-8888-4888-8888-000000000002'

let layout: ReturnType<typeof stubLayout>
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
  layout = stubLayout()
})
afterEach(() => {
  layout.restore()
  vi.useRealTimers()
})

// The board as the server now has it (someone else changed it).
function serverNowHas(view: BoardView) {
  server.use(http.get(BOARD_URL, () => HttpResponse.json(view)))
}

function column(name: string) {
  return screen.getByRole('region', { name })
}

function tile(columnName: string, name: string) {
  return within(column(columnName)).queryByRole('button', { name })
}

describe('The board (criterion 17)', () => {
  const signUp = boardCard('13', 'Sign-up page')
  const logout = boardCard('14', 'Logout')

  function twoCards() {
    return boardView([
      boardColumn('To do', [login, logout], { id: TO_DO }),
      boardColumn('Done', [], { id: DONE, isDone: true }),
    ])
  }

  // 17
  it('shows a card moved, a card added and a card deleted by someone else after a board signal', async () => {
    fakeBoard(twoCards())
    renderApp(boardPath)
    expect(
      await within(await screen.findByRole('region', { name: 'To do' })).findByRole(
        'button',
        { name: 'WEB-12 Login page' },
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))

    serverNowHas(
      boardView([
        boardColumn('To do', [signUp], { id: TO_DO }),
        boardColumn('Done', [login], { id: DONE, isDone: true }),
      ]),
    )
    await live.boardChanged()

    expect(
      await within(column('Done')).findByRole('button', {
        name: 'WEB-12 Login page',
      }),
    ).toBeInTheDocument()
    expect(tile('To do', 'WEB-13 Sign-up page')).toBeInTheDocument()
    expect(tile('To do', 'WEB-14 Logout')).toBeNull()
    expect(tile('To do', 'WEB-12 Login page')).toBeNull()
  })

  // 17
  it('shows a card edited by someone else after a card signal', async () => {
    fakeBoard(twoCards())
    renderApp(boardPath)
    await within(await screen.findByRole('region', { name: 'To do' })).findByRole(
      'button',
      { name: 'WEB-12 Login page' },
    )
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))

    serverNowHas(
      boardView([
        boardColumn('To do', [{ ...login, title: 'Sign-in page' }, logout], {
          id: TO_DO,
        }),
        boardColumn('Done', [], { id: DONE, isDone: true }),
      ]),
    )
    await live.cardChanged(login.id)

    expect(
      await within(column('To do')).findByRole('button', {
        name: 'WEB-12 Sign-in page',
      }),
    ).toBeInTheDocument()
  })

  // 17
  it('reloads the board once for a signal, not on its own', async () => {
    fakeBoard(twoCards())
    renderApp(boardPath)
    await screen.findByRole('region', { name: 'To do' })
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const requests = recordRequests()

    await live.cardChanged(login.id)

    await waitFor(() => expect(requests.reads(BOARD_URL)).toBe(1))
  })
})

describe('The open card panel (criterion 18)', () => {
  // 18
  it('reloads the panel’s own data when a signal says its card changed', async () => {
    openCard()
    await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    const requests = recordRequests()

    await live.cardChanged(login.id)

    for (const part of [
      'checklists',
      'subtasks',
      'relatives',
      'time-entries',
      'time-totals',
    ]) {
      await waitFor(() =>
        expect(
          requests.reads(`/api/cards/${login.id}/${part}`),
          `the card’s ${part}`,
        ).toBeGreaterThan(0),
      )
    }
    expect(requests.reads(BOARD_URL)).toBeGreaterThan(0)
  })

  // 18
  it('shows a checklist item another person added', async () => {
    const testing = checklist('Testing', ['Chrome'])
    openCard(login, { checklists: { [login.id]: [testing] } })
    const panel = await cardPanel()
    await within(panel).findByRole('checkbox', { name: 'Chrome' })
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const more = checklist('Testing', ['Chrome', 'Safari'])
    server.use(
      http.get('/api/cards/:cardId/checklists', () =>
        HttpResponse.json([
          {
            ...testing,
            cardId: login.id,
            items: more.items,
            progress: { done: 0, total: 2 },
          },
        ]),
      ),
    )

    await live.cardChanged(login.id)

    expect(
      await within(panel).findByRole('checkbox', { name: 'Safari' }),
    ).toBeInTheDocument()
  })

  // 18
  it('shows a new title, description and assignee that another person set', async () => {
    openCard()
    const panel = await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    expect(within(panel).getByLabelText('Title')).toHaveValue('Login page')
    serverNowHas(
      boardView([
        boardColumn(
          'To do',
          [
            {
              ...login,
              title: 'Sign-in page',
              description: 'Email first, then password',
              assignees: [{ id: ben.id, displayName: 'Ben', isOwner: true }],
            },
          ],
          { id: TO_DO },
        ),
        boardColumn('Done', [], { id: DONE, isDone: true }),
      ]),
    )

    await live.cardChanged(login.id)

    await waitFor(() =>
      expect(within(panel).getByLabelText('Title')).toHaveValue('Sign-in page'),
    )
    expect(
      await within(panel).findByText('Email first, then password'),
    ).toBeInTheDocument()
    expect(
      within(within(panel).getByRole('list', { name: 'Assignees' })).getByText(
        'Ben',
      ),
    ).toBeInTheDocument()
  })

  // 18
  it('shows a new line in Activity when the Activity tab is open', async () => {
    const lines = [
      activityLine('MOVED', {
        from: { columnId: 'c1', name: 'To do' },
        to: { columnId: 'c2', name: 'In progress' },
      }),
    ]
    server.use(fakeActivity(lines).handler)
    const { user } = openCard()
    const panel = await cardPanel()
    await user.click(within(panel).getByRole('tab', { name: 'Activity' }))
    const tab = await within(panel).findByRole('tabpanel', { name: 'Activity' })
    const list = await within(tab).findByRole('list', { name: 'Activity' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    lines.unshift(
      activityLine('MOVED', {
        from: { columnId: 'c2', name: 'In progress' },
        to: { columnId: 'c3', name: 'Done' },
      }),
    )

    await live.cardChanged(login.id)

    await waitFor(() =>
      expect(
        within(
          within(panel).getByRole('list', { name: 'Activity' }),
        ).getAllByRole('listitem'),
      ).toHaveLength(2),
    )
  })
})

describe('The sidebar’s chat list (criterion 19)', () => {
  // 19
  it('shows a chat that someone else made after a chats signal', async () => {
    fakeBoard(board(), { chats: [general] })
    renderApp(boardPath)
    const chats = await screen.findByRole('navigation', { name: 'Chats' })
    await within(chats).findByRole('link', { name: 'General' })
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    expect(within(chats).queryByRole('link', { name: 'Release plan' })).toBeNull()
    server.use(
      http.get(`/api/boards/${sprint.id}/chats`, () =>
        HttpResponse.json([general, releasePlan]),
      ),
    )

    await live.chatsChanged()

    expect(
      await within(chats).findByRole('link', { name: 'Release plan' }),
    ).toBeInTheDocument()
  })

  // 19
  it('reloads the chat list once for a chats signal', async () => {
    fakeBoard(board(), { chats: [general] })
    renderApp(boardPath)
    await screen.findByRole('link', { name: 'General' })
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const requests = recordRequests()

    await live.chatsChanged()

    await waitFor(() =>
      expect(requests.reads(`/api/boards/${sprint.id}/chats`)).toBe(1),
    )
  })
})

describe('The open chat (criterion 20)', () => {
  // 20
  it('shows a new message from someone else after a message signal', async () => {
    const first = message('Hello')
    const { api } = openChat({ messages: [first] })
    const list = await messageList()
    await within(list).findByText('Hello')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const sent = message('From Ben', { author: ben, createdAt: ago(1000) })
    api.arrive(general.id, sent)

    await live.messageChanged(general.id, sent.id)

    expect(await within(list).findByText('From Ben')).toBeInTheDocument()
  })

  // 20
  it('shows “New messages ↓” instead of moving the list when you are reading higher up', async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      message(`m00${i + 1}`, { createdAt: ago((5 - i) * MINUTE) }),
    )
    const { api } = openChat({ messages: many })
    const list = await messageList()
    await within(list).findByText('m005')
    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
    scrollTo(list, 0)
    layout.forget()
    const sent = message('Fresh news', { author: ben, createdAt: ago(1000) })
    api.arrive(general.id, sent)

    await live.messageChanged(general.id, sent.id)

    await within(list).findByText('Fresh news')
    expect(
      within(chatPanel()).getByRole('button', { name: /New messages/ }),
    ).toBeInTheDocument()
    expect(hasNotMoved(list, layout)).toBe(true)
  })

  // 20
  it('shows an edit by someone else', async () => {
    const hello = message('Hello', { author: ben })
    const { api } = openChat({ messages: [hello] })
    const list = await messageList()
    await within(list).findByText('Hello')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const id = api.messagesOf(general.id)[0]!.id
    api.edit(id, 'Hello again')

    await live.messageChanged(general.id, id)

    await within(list).findByText('Hello again')
    expect(messageWith('Hello again')).toHaveTextContent('(edited)')
  })

  // 20
  it('shows a delete by someone else, crossed out', async () => {
    const { api } = openChat({ messages: [message('Oops', { author: ben })] })
    const list = await messageList()
    await within(list).findByText('Oops')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const id = api.messagesOf(general.id)[0]!.id
    api.remove(id, ben)

    await live.messageChanged(general.id, id)

    await waitFor(() => expect(list.querySelector('del')).not.toBeNull())
    expect(messageWith('Oops')).toHaveTextContent('Deleted by Ben')
  })

  // 20
  it('does not reload the open chat for a signal about another chat', async () => {
    const { api } = openChat({
      messages: [message('Hello')],
      other: [message('Over there')],
    })
    await within(await messageList()).findByText('Hello')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const other = api.messagesOf(releasePlan.id)[0]!
    const requests = recordRequests()

    await live.messageChanged(releasePlan.id, other.id)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(requests.reads(`/api/chats/${general.id}/messages`)).toBe(0)
  })
})

describe('Older messages kept on screen (criterion 21)', () => {
  function many(count: number) {
    return Array.from({ length: count }, (_, i) =>
      message(`m${String(i + 1).padStart(3, '0')}`, {
        author: ben,
        createdAt: ago((count - i) * MINUTE),
      }),
    )
  }

  async function withOlderShown() {
    const app = openChat({ messages: many(100) })
    const list = await messageList()
    await within(list).findByText('m100')
    await app.user.click(
      within(chatPanel()).getByRole('button', { name: 'Show older messages' }),
    )
    await within(list).findByText('m001')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const first = app.api.messagesOf(general.id)[0]!
    return { ...app, list, first }
  }

  // 21
  it('shows another person’s edit of a message above the latest page, fetched on its own', async () => {
    const { api, list, first } = await withOlderShown()
    api.edit(first.id, 'm001 corrected')

    await live.messageChanged(general.id, first.id)

    await within(list).findByText('m001 corrected')
    expect(api.fetched).toEqual([first.id])
    expect(messageWith('m001 corrected')).toHaveTextContent('(edited)')
    // Everything shown before is still shown.
    expect(within(list).getByText('m002')).toBeInTheDocument()
    expect(within(list).getByText('m100')).toBeInTheDocument()
  })

  // 21
  it('shows another person’s delete of a message above the latest page', async () => {
    const { api, list, first } = await withOlderShown()
    api.remove(first.id, ben)

    await live.messageChanged(general.id, first.id)

    await waitFor(() => expect(messageWith('m001')).toHaveTextContent('Deleted by Ben'))
    expect(api.fetched).toEqual([first.id])
    expect(within(list).getByText('m100')).toBeInTheDocument()
  })
})
