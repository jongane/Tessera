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
import { ana, server, signedInAs } from '../test/server'

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

function openBoard(threads: Thread[] = [general, releasePlan, loginThread]) {
  const view = boardView([boardColumn('To do', [login])])
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
