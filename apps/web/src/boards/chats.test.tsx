import type { Chat } from '@tessera/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import {
  backlog,
  boardCard,
  boardColumn,
  boardView,
  sprint,
  website,
} from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { ana, apiError, server, signedInAs } from '../test/server'

const boardPath = `/WEB/boards/${sprint.id}`

function chat(fields: Partial<Chat> & { id: string; title: string }) {
  return {
    boardId: sprint.id,
    cardId: null,
    kind: 'TOPIC',
    createdAt: '2026-10-30T09:00:00.000Z',
    ...fields,
  } satisfies Chat
}

const login = boardCard('12', 'Login page', {
  chatId: '55555555-5555-4555-8555-000000000012',
})
const general = chat({
  id: '55555555-5555-4555-8555-000000000001',
  title: 'General',
  kind: 'GENERAL',
})
const releasePlan = chat({
  id: '55555555-5555-4555-8555-000000000002',
  title: 'Release plan',
})
const loginChat = chat({
  id: login.chatId!,
  title: 'Login page',
  cardId: login.id,
})

function openBoard(
  chats: Chat[] = [general, releasePlan, loginChat],
  view = boardView([boardColumn('To do', [login])]),
) {
  server.use(
    signedInAs(ana),
    http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
    http.get(`/api/projects/${website.id}/boards`, () =>
      HttpResponse.json([backlog, sprint]),
    ),
    http.get(`/api/boards/${sprint.id}`, () => HttpResponse.json(view)),
    http.get(`/api/boards/${sprint.id}/chats`, () =>
      HttpResponse.json(chats),
    ),
  )
  return renderApp(boardPath)
}

function chatPanel() {
  return screen.getByRole('complementary', { name: /^Chat: / })
}

describe('Chats on a board', () => {
  it('lists the general chat first, then the chats not linked to a card', async () => {
    openBoard()

    const list = await screen.findByRole('navigation', { name: 'Chats' })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['General', 'Release plan']),
    )
  })

  it('opens a chat in the chat panel', async () => {
    const { user, router, container } = openBoard()

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))

    const panel = chatPanel()
    expect(
      within(panel).getByRole('heading', { name: 'Release plan' }),
    ).toBeInTheDocument()
    expect(panel).toHaveTextContent('Messages are coming soon')
    expect(currentPath(router)).toBe(`${boardPath}?chat=${releasePlan.id}`)
    expect(screen.getByRole('link', { name: 'Release plan' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(
      screen.getByRole('separator', { name: 'Resize the chat panel' }),
    ).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)

    await user.click(within(panel).getByRole('button', { name: 'Close chat' }))
    expect(
      screen.queryByRole('complementary', { name: /^Chat: / }),
    ).not.toBeInTheDocument()
    expect(currentPath(router)).toBe(boardPath)
  })

  it('opens a card’s chat when the card is clicked', async () => {
    const { user, router } = openBoard()

    await user.click(
      await screen.findByRole('button', { name: 'WEB-12 Login page' }),
    )

    const panel = await screen.findByRole('complementary', {
      name: 'Chat: Login page',
    })
    expect(panel).toHaveTextContent('For card WEB-12 Login page')
    expect(currentPath(router)).toBe(
      `${boardPath}?card=${login.id}&chat=${loginChat.id}`,
    )
  })

  it('docks the chat panel where it is put, and remembers it', async () => {
    const { user, unmount } = openBoard()
    await user.click(await screen.findByRole('link', { name: 'Release plan' }))

    // From the keyboard: in jsdom every element sits at 0,0, so the
    // resizable edge would take every pointer press.
    within(chatPanel())
      .getByRole('button', { name: 'Dock the panel' })
      .focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('menuitemradio', { name: 'Left' }))

    const board = screen.getByRole('heading', { name: 'Sprint 1', level: 1 })
    // The panel now comes before the board.
    expect(
      chatPanel().compareDocumentPosition(board) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    unmount()

    const again = openBoard()
    await again.user.click(
      await screen.findByRole('link', { name: 'Release plan' }),
    )
    within(chatPanel())
      .getByRole('button', { name: 'Dock the panel' })
      .focus()
    await again.user.keyboard('{Enter}')
    expect(screen.getByRole('menuitemradio', { name: 'Left' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('starts a new chat and opens it', async () => {
    let created: unknown
    const newChat = chat({
      id: '55555555-5555-4555-8555-000000000003',
      title: 'Launch party',
    })
    const { user, router } = openBoard()
    server.use(
      http.post(`/api/boards/${sprint.id}/chats`, async ({ request }) => {
        created = await request.json()
        server.use(
          http.get(`/api/boards/${sprint.id}/chats`, () =>
            HttpResponse.json([general, releasePlan, loginChat, newChat]),
          ),
        )
        return HttpResponse.json(newChat, { status: 201 })
      }),
    )

    await user.click(await screen.findByRole('button', { name: 'New chat' }))
    const dialog = screen.getByRole('dialog', { name: 'New chat' })
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))
    expect(dialog).toHaveTextContent('This can’t be empty')
    await user.type(within(dialog).getByLabelText('Title'), 'Launch party')
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))

    expect(
      await screen.findByRole('complementary', {
        name: 'Chat: Launch party',
      }),
    ).toBeInTheDocument()
    expect(created).toEqual({ title: 'Launch party' })
    expect(currentPath(router)).toBe(`${boardPath}?chat=${newChat.id}`)
    expect(
      await screen.findByRole('link', { name: 'Launch party' }),
    ).toBeInTheDocument()
  })
})

describe('Chats and cards', () => {
  const signUp = boardCard('13', 'Sign-up page', { chatId: null })
  const toDo = boardColumn('To do', [login, signUp])
  const view = boardView([toDo, boardColumn('Done', [], { isDone: true })])

  it('asks to create a card for a chat with no card, and makes one in the first column', async () => {
    let sent: unknown
    const planCard = boardCard('14', 'Release plan', {
      chatId: releasePlan.id,
    })
    const { user, router } = openBoard(undefined, view)
    server.use(
      http.post(`/api/columns/${toDo.id}/cards`, async ({ request }) => {
        sent = await request.json()
        server.use(
          http.get(`/api/boards/${sprint.id}`, () =>
            HttpResponse.json(
              boardView([boardColumn('To do', [login, signUp, planCard])]),
            ),
          ),
          http.get(`/api/boards/${sprint.id}/chats`, () =>
            HttpResponse.json([
              general,
              { ...releasePlan, cardId: planCard.id },
              loginChat,
            ]),
          ),
        )
        return HttpResponse.json(planCard, { status: 201 })
      }),
    )

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    expect(chatPanel()).toHaveTextContent('Create a card for this chat?')
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Create a card' }),
    )

    expect(
      await within(chatPanel()).findByRole('button', {
        name: 'WEB-14 Release plan',
      }),
    ).toBeInTheDocument()
    expect(sent).toEqual({ title: 'Release plan', chatId: releasePlan.id })
    expect(currentPath(router)).toBe(
      `${boardPath}?card=${planCard.id}&chat=${releasePlan.id}`,
    )
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'To do' })).getByRole(
          'button',
          { name: 'WEB-14 Release plan' },
        ),
      ).toHaveAttribute('aria-current', 'true'),
    )
  })

  it('says when the card could not be made', async () => {
    const { user } = openBoard(undefined, view)
    server.use(
      http.post(`/api/columns/${toDo.id}/cards`, () =>
        apiError(409, 'This chat is already linked to a card'),
      ),
    )

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Create a card' }),
    )

    expect(await within(chatPanel()).findByRole('alert')).toHaveTextContent(
      'This chat is already linked to a card',
    )
  })

  it('links a chat to a card that has no chat, found by number or title', async () => {
    let sent: unknown
    const { user, container } = openBoard(undefined, view)
    server.use(
      http.put(`/api/chats/${releasePlan.id}/card`, async ({ request }) => {
        sent = await request.json()
        server.use(
          http.get(`/api/boards/${sprint.id}/chats`, () =>
            HttpResponse.json([
              general,
              { ...releasePlan, cardId: signUp.id },
              loginChat,
            ]),
          ),
        )
        return HttpResponse.json({ ...releasePlan, cardId: signUp.id })
      }),
    )

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Link to a card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Link to a card' })
    // Only cards without a chat are offered.
    expect(
      within(dialog)
        .getAllByRole('button', { name: /^WEB-/ })
        .map((button) => button.textContent),
    ).toEqual(['WEB-13 Sign-up page'])
    await expectNoAccessibilityProblems(container)
    await user.type(within(dialog).getByLabelText('Find a card'), 'web-99')
    expect(dialog).toHaveTextContent('No cards without a chat match.')
    await user.clear(within(dialog).getByLabelText('Find a card'))
    await user.type(within(dialog).getByLabelText('Find a card'), '13')
    expect(
      within(dialog).getByRole('button', { name: 'WEB-13 Sign-up page' }),
    ).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Find a card'))
    await user.type(within(dialog).getByLabelText('Find a card'), 'sign')
    await user.click(
      within(dialog).getByRole('button', { name: 'WEB-13 Sign-up page' }),
    )

    expect(
      await within(chatPanel()).findByRole('button', {
        name: 'WEB-13 Sign-up page',
      }),
    ).toBeInTheDocument()
    expect(sent).toEqual({ cardId: signUp.id })
    expect(
      screen.queryByRole('dialog', { name: 'Link to a card' }),
    ).not.toBeInTheDocument()
  })

  it('says in the picker when the link could not be made', async () => {
    const { user } = openBoard(undefined, view)
    server.use(
      http.put(`/api/chats/${releasePlan.id}/card`, () =>
        apiError(409, 'This card already has a chat'),
      ),
    )

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Link to a card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Link to a card' })
    await user.click(
      within(dialog).getByRole('button', { name: 'WEB-13 Sign-up page' }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This card already has a chat',
    )
  })

  it('leaves a failure behind when another chat is opened', async () => {
    const { user } = openBoard(undefined, view)
    server.use(
      http.post(`/api/columns/${toDo.id}/cards`, () =>
        apiError(500, 'Something broke'),
      ),
    )
    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Create a card' }),
    )
    expect(await within(chatPanel()).findByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'General' }))

    expect(
      await screen.findByRole('complementary', { name: 'Chat: General' }),
    ).toBeInTheDocument()
    expect(within(chatPanel()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('unlinks a chat from its card, keeping both', async () => {
    let unlinked = false
    const { user } = openBoard(undefined, view)
    server.use(
      http.delete(`/api/chats/${loginChat.id}/card`, () => {
        unlinked = true
        server.use(
          http.get(`/api/boards/${sprint.id}/chats`, () =>
            HttpResponse.json([
              general,
              releasePlan,
              { ...loginChat, cardId: null },
            ]),
          ),
        )
        return HttpResponse.json({ ...loginChat, cardId: null })
      }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'WEB-12 Login page' }),
    )
    const panel = await screen.findByRole('complementary', {
      name: 'Chat: Login page',
    })
    await user.click(
      within(panel).getByRole('button', { name: 'Unlink from WEB-12' }),
    )

    expect(
      await within(panel).findByText('Create a card for this chat?'),
    ).toBeInTheDocument()
    expect(unlinked).toBe(true)
  })

  it('offers no card for the general chat', async () => {
    const { user } = openBoard(undefined, view)

    await user.click(await screen.findByRole('link', { name: 'General' }))

    expect(chatPanel()).not.toHaveTextContent('Create a card')
    expect(
      within(chatPanel()).queryByRole('button', { name: 'Link to a card' }),
    ).not.toBeInTheDocument()
  })
})
