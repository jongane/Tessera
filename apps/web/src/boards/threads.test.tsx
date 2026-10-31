import type { Thread } from '@tessera/shared'
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

function thread(fields: Partial<Thread> & { id: string; title: string }) {
  return {
    boardId: sprint.id,
    cardId: null,
    kind: 'TOPIC',
    createdAt: '2026-10-30T09:00:00.000Z',
    ...fields,
  } satisfies Thread
}

const login = boardCard('12', 'Login page', {
  threadId: '55555555-5555-4555-8555-000000000012',
})
const general = thread({
  id: '55555555-5555-4555-8555-000000000001',
  title: 'General',
  kind: 'GENERAL',
})
const releasePlan = thread({
  id: '55555555-5555-4555-8555-000000000002',
  title: 'Release plan',
})
const loginThread = thread({
  id: login.threadId!,
  title: 'Login page',
  cardId: login.id,
})

function openBoard(
  threads: Thread[] = [general, releasePlan, loginThread],
  view = boardView([boardColumn('To do', [login])]),
) {
  server.use(
    signedInAs(ana),
    http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
    http.get(`/api/projects/${website.id}/boards`, () =>
      HttpResponse.json([backlog, sprint]),
    ),
    http.get(`/api/boards/${sprint.id}`, () => HttpResponse.json(view)),
    http.get(`/api/boards/${sprint.id}/threads`, () =>
      HttpResponse.json(threads),
    ),
  )
  return renderApp(boardPath)
}

function threadPanel() {
  return screen.getByRole('complementary', { name: /^Thread: / })
}

describe('Threads on a board', () => {
  it('lists the general thread first, then the threads not linked to a card', async () => {
    openBoard()

    const list = await screen.findByRole('navigation', { name: 'Threads' })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['General', 'Release plan']),
    )
  })

  it('opens a thread in the thread panel', async () => {
    const { user, router, container } = openBoard()

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))

    const panel = threadPanel()
    expect(
      within(panel).getByRole('heading', { name: 'Release plan' }),
    ).toBeInTheDocument()
    expect(panel).toHaveTextContent('Messages are coming soon')
    expect(currentPath(router)).toBe(`${boardPath}?thread=${releasePlan.id}`)
    expect(
      screen.getByRole('separator', { name: 'Resize the thread panel' }),
    ).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)

    await user.click(
      within(panel).getByRole('button', { name: 'Close thread' }),
    )
    expect(
      screen.queryByRole('complementary', { name: /^Thread: / }),
    ).not.toBeInTheDocument()
    expect(currentPath(router)).toBe(boardPath)
  })

  it('opens a card’s thread when the card is clicked', async () => {
    const { user, router } = openBoard()

    await user.click(
      await screen.findByRole('button', { name: 'WEB-12 Login page' }),
    )

    const panel = await screen.findByRole('complementary', {
      name: 'Thread: Login page',
    })
    expect(panel).toHaveTextContent('For card WEB-12 Login page')
    expect(currentPath(router)).toBe(
      `${boardPath}?card=${login.id}&thread=${loginThread.id}`,
    )
  })

  it('docks the thread panel where it is put, and remembers it', async () => {
    const { user, unmount } = openBoard()
    await user.click(await screen.findByRole('link', { name: 'Release plan' }))

    // From the keyboard: in jsdom every element sits at 0,0, so the
    // resizable edge would take every pointer press.
    within(threadPanel())
      .getByRole('button', { name: 'Dock the panel' })
      .focus()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('menuitemradio', { name: 'Left' }))

    const board = screen.getByRole('heading', { name: 'Sprint 1', level: 1 })
    // The panel now comes before the board.
    expect(
      threadPanel().compareDocumentPosition(board) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    unmount()

    const again = openBoard()
    await again.user.click(
      await screen.findByRole('link', { name: 'Release plan' }),
    )
    within(threadPanel())
      .getByRole('button', { name: 'Dock the panel' })
      .focus()
    await again.user.keyboard('{Enter}')
    expect(screen.getByRole('menuitemradio', { name: 'Left' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('starts a new thread and opens it', async () => {
    let created: unknown
    const newThread = thread({
      id: '55555555-5555-4555-8555-000000000003',
      title: 'Launch party',
    })
    const { user, router } = openBoard()
    server.use(
      http.post(`/api/boards/${sprint.id}/threads`, async ({ request }) => {
        created = await request.json()
        server.use(
          http.get(`/api/boards/${sprint.id}/threads`, () =>
            HttpResponse.json([general, releasePlan, loginThread, newThread]),
          ),
        )
        return HttpResponse.json(newThread, { status: 201 })
      }),
    )

    await user.click(await screen.findByRole('button', { name: 'New thread' }))
    const dialog = screen.getByRole('dialog', { name: 'New thread' })
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))
    expect(dialog).toHaveTextContent('This can’t be empty')
    await user.type(within(dialog).getByLabelText('Title'), 'Launch party')
    await user.click(within(dialog).getByRole('button', { name: 'Start' }))

    expect(
      await screen.findByRole('complementary', {
        name: 'Thread: Launch party',
      }),
    ).toBeInTheDocument()
    expect(created).toEqual({ title: 'Launch party' })
    expect(currentPath(router)).toBe(`${boardPath}?thread=${newThread.id}`)
    expect(
      await screen.findByRole('link', { name: 'Launch party' }),
    ).toBeInTheDocument()
  })
})

describe('Threads and cards', () => {
  const signUp = boardCard('13', 'Sign-up page', { threadId: null })
  const toDo = boardColumn('To do', [login, signUp])
  const view = boardView([toDo, boardColumn('Done', [], { isDone: true })])

  it('asks to create a card for a thread with no card, and makes one in the first column', async () => {
    let sent: unknown
    const planCard = boardCard('14', 'Release plan', {
      threadId: releasePlan.id,
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
          http.get(`/api/boards/${sprint.id}/threads`, () =>
            HttpResponse.json([
              general,
              { ...releasePlan, cardId: planCard.id },
              loginThread,
            ]),
          ),
        )
        return HttpResponse.json(planCard, { status: 201 })
      }),
    )

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    expect(threadPanel()).toHaveTextContent('Create a card for this thread?')
    await user.click(
      within(threadPanel()).getByRole('button', { name: 'Create a card' }),
    )

    expect(
      await within(threadPanel()).findByRole('button', {
        name: 'WEB-14 Release plan',
      }),
    ).toBeInTheDocument()
    expect(sent).toEqual({ title: 'Release plan', threadId: releasePlan.id })
    expect(currentPath(router)).toBe(
      `${boardPath}?card=${planCard.id}&thread=${releasePlan.id}`,
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
        apiError(409, 'This thread is already linked to a card'),
      ),
    )

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    await user.click(
      within(threadPanel()).getByRole('button', { name: 'Create a card' }),
    )

    expect(await within(threadPanel()).findByRole('alert')).toHaveTextContent(
      'This thread is already linked to a card',
    )
  })

  it('links a thread to a card that has no thread, found by number or title', async () => {
    let sent: unknown
    const { user, container } = openBoard(undefined, view)
    server.use(
      http.put(`/api/threads/${releasePlan.id}/card`, async ({ request }) => {
        sent = await request.json()
        server.use(
          http.get(`/api/boards/${sprint.id}/threads`, () =>
            HttpResponse.json([
              general,
              { ...releasePlan, cardId: signUp.id },
              loginThread,
            ]),
          ),
        )
        return HttpResponse.json({ ...releasePlan, cardId: signUp.id })
      }),
    )

    await user.click(await screen.findByRole('link', { name: 'Release plan' }))
    await user.click(
      within(threadPanel()).getByRole('button', { name: 'Link to a card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Link to a card' })
    // Only cards without a thread are offered.
    expect(
      within(dialog)
        .getAllByRole('button', { name: /^WEB-/ })
        .map((button) => button.textContent),
    ).toEqual(['WEB-13 Sign-up page'])
    await expectNoAccessibilityProblems(container)
    await user.type(within(dialog).getByLabelText('Find a card'), 'web-99')
    expect(dialog).toHaveTextContent('No cards without a thread match.')
    await user.clear(within(dialog).getByLabelText('Find a card'))
    await user.type(within(dialog).getByLabelText('Find a card'), 'sign')
    await user.click(
      within(dialog).getByRole('button', { name: 'WEB-13 Sign-up page' }),
    )

    expect(
      await within(threadPanel()).findByRole('button', {
        name: 'WEB-13 Sign-up page',
      }),
    ).toBeInTheDocument()
    expect(sent).toEqual({ cardId: signUp.id })
    expect(
      screen.queryByRole('dialog', { name: 'Link to a card' }),
    ).not.toBeInTheDocument()
  })

  it('unlinks a thread from its card, keeping both', async () => {
    let unlinked = false
    const { user } = openBoard(undefined, view)
    server.use(
      http.delete(`/api/threads/${loginThread.id}/card`, () => {
        unlinked = true
        server.use(
          http.get(`/api/boards/${sprint.id}/threads`, () =>
            HttpResponse.json([
              general,
              releasePlan,
              { ...loginThread, cardId: null },
            ]),
          ),
        )
        return HttpResponse.json({ ...loginThread, cardId: null })
      }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'WEB-12 Login page' }),
    )
    const panel = await screen.findByRole('complementary', {
      name: 'Thread: Login page',
    })
    await user.click(
      within(panel).getByRole('button', { name: 'Unlink from WEB-12' }),
    )

    expect(
      await within(panel).findByText('Create a card for this thread?'),
    ).toBeInTheDocument()
    expect(unlinked).toBe(true)
  })

  it('offers no card for the general thread', async () => {
    const { user } = openBoard(undefined, view)

    await user.click(await screen.findByRole('link', { name: 'General' }))

    expect(threadPanel()).not.toHaveTextContent('Create a card')
    expect(
      within(threadPanel()).queryByRole('button', { name: 'Link to a card' }),
    ).not.toBeInTheDocument()
  })
})
