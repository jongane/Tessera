import type { BoardView } from '@tessera/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
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

// Ana is signed in and the API answers with `view` for Sprint 1.
function openBoard(view: BoardView) {
  server.use(
    signedInAs(ana),
    http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
    http.get(`/api/projects/${website.id}/boards`, () =>
      HttpResponse.json([backlog, sprint]),
    ),
    http.get(`/api/boards/${sprint.id}`, () => HttpResponse.json(view)),
  )
  return renderApp(boardPath)
}

function column(name: string) {
  return screen.getByRole('region', { name })
}

function cardTitles(columnName: string) {
  return within(column(columnName))
    .queryAllByRole('button', { name: /^WEB-/ })
    .map((card) => card.getAttribute('aria-label'))
}

describe('Board', () => {
  it('shows the columns in order, each with its cards', async () => {
    const view = boardView([
      boardColumn('To do', [
        boardCard('14', 'Password reset email'),
        boardCard('15', 'Choose an icon set'),
      ]),
      boardColumn('In progress', [boardCard('12', 'Login page')]),
      boardColumn('Done', [], { isDone: true }),
    ])
    const { container } = openBoard(view)

    expect(
      await screen.findByRole('heading', { name: 'Sprint 1', level: 1 }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('region').map((r) => r.getAttribute('aria-label')),
    ).toEqual(['To do', 'In progress', 'Done'])
    expect(cardTitles('To do')).toEqual([
      'WEB-14 Password reset email',
      'WEB-15 Choose an icon set',
    ])
    expect(cardTitles('In progress')).toEqual(['WEB-12 Login page'])
    expect(within(column('Done')).getByText('No cards')).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)
  })

  it('shows what is set on a card', async () => {
    const view = boardView([
      boardColumn('In progress', [
        boardCard('12', 'Login page', {
          priority: 'HIGH',
          labels: [
            { id: 'l1', name: 'Frontend', colour: 'BLUE' },
            { id: 'l2', name: 'Security', colour: 'PURPLE' },
          ],
          checklistProgress: { done: 3, total: 5 },
          subtaskProgress: { complete: 1, total: 2 },
          dueAt: '2026-10-31T00:00:00.000Z',
          assignees: [
            { id: 'u1', displayName: 'Ben', isOwner: true },
            { id: 'u2', displayName: 'Jon', isOwner: false },
          ],
        }),
      ]),
    ])
    openBoard(view)

    const card = await screen.findByRole('button', {
      name: 'WEB-12 Login page',
    })
    for (const text of [
      'High priority',
      'Frontend',
      'Security',
      '3 of 5 checklist items done',
      '1 of 2 subtasks done',
      'Due 31 Oct',
      'Assigned to Ben (owner) and Jon',
    ]) {
      expect(card).toHaveTextContent(text)
    }
  })

  it('lists the project’s boards in the sidebar', async () => {
    openBoard(boardView([boardColumn('To do', [])]))

    const boards = await screen.findByRole('navigation', { name: 'Boards' })
    expect(
      await within(boards).findByRole('link', { name: 'Sprint 1' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(boards).getByRole('link', { name: 'Backlog' }),
    ).toHaveAttribute('href', `/WEB/boards/${backlog.id}`)
  })

  it('says when the board does not exist', async () => {
    server.use(
      signedInAs(ana),
      http.get('/api/projects/by-code/WEB', () => HttpResponse.json(website)),
      http.get(`/api/projects/${website.id}/boards`, () =>
        HttpResponse.json([]),
      ),
      http.get(`/api/boards/${sprint.id}`, () =>
        apiError(404, 'Board not found'),
      ),
    )
    renderApp(boardPath)

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeInTheDocument()
  })

  it('adds a card at the bottom of a column', async () => {
    const toDo = boardColumn('To do', [boardCard('1', 'Login')])
    let view = boardView([toDo])
    let created: unknown
    const { user } = openBoard(view)
    server.use(
      http.get(`/api/boards/${sprint.id}`, () => HttpResponse.json(view)),
      http.post(`/api/columns/${toDo.id}/cards`, async ({ request }) => {
        created = await request.json()
        view = boardView([
          boardColumn('To do', [...toDo.cards, boardCard('2', 'Sign-up')], {
            id: toDo.id,
          }),
        ])
        return HttpResponse.json(view.columns[0]!.cards[1], { status: 201 })
      }),
    )
    await user.click(
      await within(
        await screen.findByRole('region', { name: 'To do' }),
      ).findByRole('button', { name: 'Add a card' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('This can’t be empty')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Card title'), 'Sign-up')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(cardTitles('To do')).toEqual(['WEB-1 Login', 'WEB-2 Sign-up']),
    )
    expect(created).toEqual({ title: 'Sign-up' })
  })

  it('moves a card with its "Move to" menu, straight away', async () => {
    const card = boardCard('12', 'Login page')
    const toDo = boardColumn('To do', [card])
    const doing = boardColumn('In progress', [boardCard('13', 'Header')])
    let moved: unknown
    const { user } = openBoard(boardView([toDo, doing]))
    server.use(
      http.post(`/api/cards/${card.id}/move`, async ({ request }) => {
        moved = await request.json()
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Move WEB-12 to…' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'In progress' }))

    // On screen before the API has answered.
    await waitFor(() =>
      expect(cardTitles('In progress')).toEqual([
        'WEB-13 Header',
        'WEB-12 Login page',
      ]),
    )
    expect(cardTitles('To do')).toEqual([])
    expect(moved).toEqual({ columnId: doing.id, position: 1 })
  })

  it('puts a card back and says so when the move cannot be saved', async () => {
    const card = boardCard('12', 'Login page')
    const toDo = boardColumn('To do', [card])
    const doing = boardColumn('In progress', [])
    const { user } = openBoard(boardView([toDo, doing]))
    server.use(
      http.post(`/api/cards/${card.id}/move`, () =>
        apiError(500, 'Something broke'),
      ),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Move WEB-12 to…' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'In progress' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t save, try again',
    )
    expect(cardTitles('To do')).toEqual(['WEB-12 Login page'])
    expect(cardTitles('In progress')).toEqual([])
  })

  it('asks first when a card with open subtasks goes into a done column', async () => {
    const card = boardCard('12', 'Login page', {
      subtaskProgress: { complete: 1, total: 4 },
    })
    const toDo = boardColumn('To do', [card])
    const done = boardColumn('Done', [], { isDone: true })
    let moved: unknown
    const { user } = openBoard(boardView([toDo, done]))
    server.use(
      http.post(`/api/cards/${card.id}/move`, async ({ request }) => {
        moved = await request.json()
        return HttpResponse.json({})
      }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Move WEB-12 to…' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Done' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Complete anyway?',
    })
    expect(dialog).toHaveTextContent('3 subtasks are still open.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(cardTitles('To do')).toEqual(['WEB-12 Login page'])
    expect(moved).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Move WEB-12 to…' }))
    await user.click(screen.getByRole('menuitem', { name: 'Done' }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'Complete anyway?' }),
      ).getByRole('button', { name: 'Complete anyway' }),
    )

    await waitFor(() =>
      expect(moved).toEqual({
        columnId: done.id,
        position: 0,
        confirmOpenSubtasks: true,
      }),
    )
  })

  it('highlights a card when it is clicked', async () => {
    const card = boardCard('12', 'Login page')
    const { user, router } = openBoard(
      boardView([boardColumn('To do', [card])]),
    )

    const button = await screen.findByRole('button', {
      name: 'WEB-12 Login page',
    })
    await user.click(button)

    expect(button).toHaveAttribute('aria-current', 'true')
    expect(currentPath(router)).toBe(`${boardPath}?card=${card.id}`)
  })
})
