import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import {
  board,
  boardPath,
  cardPanel,
  login,
  openCard,
  tile,
  typeInto,
} from '../test/card-panel'
import { ben, fakeBoard } from '../test/fake-board'
import {
  boardCard,
  sprint,
  website,
} from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { apiError, server } from '../test/server'

describe('Opening the card panel', () => {
  it('opens the card panel, and only that, when a card is clicked', async () => {
    fakeBoard(board())
    const { user, router, container } = renderApp(boardPath)

    await user.click(
      await screen.findByRole('button', { name: 'WEB-12 Login page' }),
    )

    const panel = await cardPanel()
    expect(within(panel).getByLabelText('Title')).toHaveValue('Login page')
    expect(currentPath(router)).toBe(`${boardPath}?card=${login.id}`)
    expect(
      screen.queryByRole('complementary', { name: /^Chat: / }),
    ).not.toBeInTheDocument()
    expect(tile('WEB-12 Login page')).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('separator', { name: 'Resize the card panel' }),
    ).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)
  })

  it('closes with its close button, Escape, or Back', async () => {
    fakeBoard(board())
    const { user, router } = renderApp(boardPath)
    // Found again each time: opening the panel lays the board out afresh.
    const card = () => screen.findByRole('button', { name: 'WEB-12 Login page' })

    await user.click(await card())
    await user.click(
      within(await cardPanel()).getByRole('button', { name: 'Close card' }),
    )
    expect(screen.queryByRole('complementary', { name: 'Card WEB-12' })).toBe(
      null,
    )
    expect(currentPath(router)).toBe(boardPath)

    await user.click(await card())
    within(await cardPanel())
      .getByRole('button', { name: 'Close card' })
      .focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'Card WEB-12' })).toBe(
      null,
    )

    await user.click(await card())
    await cardPanel()
    await router.navigate(-1)
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Card WEB-12' }),
      ).toBe(null),
    )
  })

  it('opens the card’s chat next to it', async () => {
    const { user, router } = openCard(login, {
      chats: [
        {
          id: login.chatId!,
          boardId: sprint.id,
          cardId: login.id,
          kind: 'TOPIC',
          title: 'Login page',
          createdAt: '2026-10-30T09:00:00.000Z',
        },
      ],
    })

    await user.click(
      within(await cardPanel()).getByRole('button', { name: 'Open chat' }),
    )

    expect(
      await screen.findByRole('complementary', { name: 'Chat: Login page' }),
    ).toBeInTheDocument()
    expect(await cardPanel()).toBeInTheDocument()
    expect(currentPath(router)).toBe(
      `${boardPath}?card=${login.id}&chat=${login.chatId}`,
    )

    await user.click(screen.getByRole('button', { name: 'Close chat' }))
    expect(await cardPanel()).toBeInTheDocument()
    expect(currentPath(router)).toBe(`${boardPath}?card=${login.id}`)
  })

  it('says when the card is no longer on the board', async () => {
    fakeBoard(board())
    renderApp(`${boardPath}?card=${website.id}`)

    expect(
      await screen.findByText(
        'This card has been deleted or moved to another board.',
      ),
    ).toBeInTheDocument()
  })
})

describe('Editing a card’s fields', () => {
  it('saves a new title on Enter, and shows it on the board', async () => {
    const { user, api } = openCard()
    const title = within(await cardPanel()).getByLabelText('Title')

    await user.clear(title)
    await typeInto(user, title, 'Sign-in page{Enter}')

    expect(
      await screen.findByRole('button', { name: 'WEB-12 Sign-in page' }),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([
      { request: `PATCH /api/cards/${login.id}`, body: { title: 'Sign-in page' } },
    ])
  })

  it('puts the title back on Escape, and refuses an empty one', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()
    const title = within(panel).getByLabelText('Title')

    await user.clear(title)
    await typeInto(user, title, 'Something else{Escape}')
    expect(title).toHaveValue('Login page')
    // Escape in the title box does not close the panel.
    expect(panel).toBeInTheDocument()

    await user.clear(title)
    await user.tab()
    expect(within(panel).getByText('This can’t be empty')).toBeInTheDocument()
    expect(api.requests).toEqual([])
  })

  it('saves the priority as soon as it is picked', async () => {
    const { user, api } = openCard()

    await user.selectOptions(
      within(await cardPanel()).getByLabelText('Priority'),
      'High',
    )

    await waitFor(() =>
      expect(tile('WEB-12 Login page')).toHaveAccessibleDescription(
        expect.stringContaining('High priority'),
      ),
    )
    expect(api.requests).toEqual([
      { request: `PATCH /api/cards/${login.id}`, body: { priority: 'HIGH' } },
    ])
  })

  it('saves a due date, then a time in the project’s time zone, then clears it', async () => {
    const { user, api } = openCard(login, {
      project: { ...website, timeZone: 'Europe/London' },
    })
    const panel = await cardPanel()
    expect(panel).toHaveTextContent('Times are in Europe/London')

    await typeInto(user, within(panel).getByLabelText('Due date'), '2026-07-02')
    await waitFor(() => expect(api.requests).toHaveLength(1))
    await typeInto(user, within(panel).getByLabelText('Due time'), '17:00')
    await user.tab()
    await waitFor(() => expect(api.requests).toHaveLength(2))
    await user.click(
      within(panel).getByRole('button', { name: 'Clear due date' }),
    )

    await waitFor(() => expect(api.requests).toHaveLength(3))
    expect(api.requests.map((r) => r.body)).toEqual([
      { due: { date: '2026-07-02' } },
      { due: { at: '2026-07-02T17:00:00+01:00' } },
      { due: null },
    ])
    expect(within(panel).getByLabelText('Due date')).toHaveValue('')
  })

  it('saves the estimate in hours and minutes, and clears it', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()

    await typeInto(user, within(panel).getByLabelText('Hours'), '1')
    await typeInto(user, within(panel).getByLabelText('Minutes'), '30')
    await user.tab()
    await waitFor(() => expect(api.requests).toHaveLength(1))
    await user.click(
      within(panel).getByRole('button', { name: 'Clear estimate' }),
    )

    await waitFor(() => expect(api.requests).toHaveLength(2))
    expect(api.requests.map((r) => r.body)).toEqual([
      { estimateMinutes: 90 },
      { estimateMinutes: null },
    ])
  })

  it('shows the estimate rolled up from the subtasks', async () => {
    const parent = boardCard('12', 'Login page', {
      estimateMinutes: 120,
      subtaskProgress: { complete: 0, total: 2 },
    })
    server.use(
      http.get(`/api/cards/${parent.id}/time-totals`, () =>
        HttpResponse.json({
          estimateMinutes: 300,
          originalEstimateMinutes: 120,
          timeSpentMinutes: 0,
          ownTimeMinutes: 0,
        }),
      ),
    )
    openCard(parent)
    const panel = await cardPanel()

    expect(
      await within(panel).findByText('5h from its subtasks'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Original estimate')).toBeInTheDocument()
  })

  it('puts a change back and says so when it cannot be saved', async () => {
    const { user } = openCard()
    server.use(
      http.patch(`/api/cards/${login.id}`, () => apiError(500, 'Broken')),
    )
    const panel = await cardPanel()

    await user.selectOptions(within(panel).getByLabelText('Priority'), 'High')

    expect(
      await within(panel).findByText('Couldn’t save, try again'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(within(panel).getByLabelText('Priority')).toHaveValue('NONE'),
    )
  })
})

describe('Assignees', () => {
  it('assigns a member, who becomes the owner', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('button', { name: 'Assign' }))
    await typeInto(user, screen.getByLabelText('Find a member'), 'be')
    await user.click(screen.getByRole('button', { name: 'Ben' }))

    const list = within(panel).getByRole('list', { name: 'Assignees' })
    expect(await within(list).findByText('Ben')).toBeInTheDocument()
    expect(within(list).getByText('Owner')).toBeInTheDocument()
    expect(api.requests).toEqual([
      {
        request: `PUT /api/cards/${login.id}/assignees/${ben.id}`,
        body: undefined,
      },
    ])
  })

  it('makes someone else the owner, and hands it on when the owner is unassigned', async () => {
    const card = boardCard('12', 'Login page', {
      assignees: [
        { id: '11111111-1111-4111-8111-111111111111', displayName: 'Ana', isOwner: true },
        { id: ben.id, displayName: 'Ben', isOwner: false },
      ],
    })
    const { user, api } = openCard(card)
    const panel = await cardPanel()
    const list = within(panel).getByRole('list', { name: 'Assignees' })

    await user.click(within(list).getByRole('button', { name: 'Make Ben the owner' }))
    await waitFor(() =>
      expect(
        within(list).getAllByRole('listitem')[0],
      ).toHaveTextContent('BenOwner'),
    )
    await user.click(within(list).getByRole('button', { name: 'Unassign Ben' }))

    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')).toHaveLength(1),
    )
    expect(within(list).getByRole('listitem')).toHaveTextContent('AnaOwner')
    expect(api.requests.map((r) => r.request)).toEqual([
      `PUT /api/cards/${card.id}/owner`,
      `DELETE /api/cards/${card.id}/assignees/${ben.id}`,
    ])
  })
})
