import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import {
  boardPath,
  cardPanel,
  login,
  openCard,
  typeInto,
} from '../test/card-panel'
import { ben, label, member } from '../test/fake-board'
import { boardCard, boardColumn, boardView, website } from '../test/fixtures'
import { currentPath } from '../test/render'
import { ana, server } from '../test/server'

describe('Labels on a card', () => {
  const frontend = label('Frontend', 'BLUE')
  const security = label('Security', 'PURPLE')

  it('adds a project label and takes one off', async () => {
    const card = boardCard('12', 'Login page', {
      labels: [{ id: security.id, name: 'Security', colour: 'PURPLE' }],
    })
    const { user, api } = openCard(card, { labels: [frontend, security] })
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('button', { name: 'Add label' }))
    // Labels already on the card are not offered.
    expect(screen.queryByRole('button', { name: 'Security' })).toBe(null)
    await user.click(await screen.findByRole('button', { name: 'Frontend' }))
    const list = within(panel).getByRole('list', { name: 'Labels' })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('listitem')
          // Without the ✕ of each label's remove button.
          .map((item) => item.textContent?.replace('✕', '')),
      ).toEqual(['Frontend', 'Security']),
    )
    await user.click(
      within(list).getByRole('button', { name: 'Remove label Security' }),
    )

    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')).toHaveLength(1),
    )
    expect(api.requests.map((r) => r.request)).toEqual([
      `PUT /api/cards/${card.id}/labels/${frontend.id}`,
      `DELETE /api/cards/${card.id}/labels/${security.id}`,
    ])
  })

  it('makes a new label with the colour picked, and puts it on the card', async () => {
    const { user, api, container } = openCard(login, { labels: [frontend] })
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('button', { name: 'Add label' }))
    await typeInto(user, screen.getByLabelText('Find a label'), 'Docs')
    await user.click(
      screen.getByRole('button', { name: 'Create label “Docs”' }),
    )
    await user.click(within(panel).getByRole('radio', { name: 'Green' }))
    await user.click(within(panel).getByRole('button', { name: 'Create' }))

    expect(
      await within(panel).findByRole('list', { name: 'Labels' }),
    ).toHaveTextContent('Docs')
    expect(api.requests).toEqual([
      {
        request: `POST /api/projects/${website.id}/labels`,
        body: { name: 'Docs', colour: 'GREEN' },
      },
      {
        request: expect.stringMatching(
          new RegExp(`^PUT /api/cards/${login.id}/labels/`),
        ),
        body: undefined,
      },
    ])
    await expectNoAccessibilityProblems(container)
  })

  it('offers no new label with a name already taken, in any letter case', async () => {
    const { user } = openCard(login, { labels: [frontend] })

    await user.click(
      within(await cardPanel()).getByRole('button', { name: 'Add label' }),
    )
    await typeInto(user, screen.getByLabelText('Find a label'), 'frontEND')

    expect(screen.queryByRole('button', { name: /^Create label/ })).toBe(null)
  })
})

describe('The description', () => {
  it('shows the description formatted', async () => {
    const { container } = openCard(
      boardCard('12', 'Login page', {
        description: '## Steps\n\n- **Open** the page\n- Sign in',
      }),
    )
    const panel = await cardPanel()

    expect(
      await within(panel).findByRole('heading', { name: 'Steps' }),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Open').tagName).toBe('STRONG')
    await expectNoAccessibilityProblems(container)
  })

  it('saves what is written, as Markdown', async () => {
    const { user, api, container } = openCard()
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await user.click(within(panel).getByRole('button', { name: 'Bold' }))
    await typeInto(user, editor, 'Check the form')
    await expectNoAccessibilityProblems(container)
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]!.body).toEqual({ description: '**Check the form**' })
    expect(
      within(panel).getByRole('button', { name: 'Edit description' }),
    ).toBeInTheDocument()
  })

  it('asks before throwing away changes', async () => {
    const { user, api, router } = openCard(
      boardCard('12', 'Login page', { description: 'Old text' }),
    )
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, ' and more')
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      'Discard your changes?',
    )
    await user.click(
      within(panel).getByRole('button', { name: 'Keep editing' }),
    )

    // Closing the card asks too.
    await user.click(within(panel).getByRole('button', { name: 'Close card' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Discard your changes?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(currentPath(router)).toContain('card=')

    await user.click(within(panel).getByRole('button', { name: 'Cancel' }))
    await user.click(within(panel).getByRole('button', { name: 'Discard' }))
    expect(within(panel).getByText('Old text')).toBeInTheDocument()
    expect(api.requests).toEqual([])
  })
})

describe('Completing and reopening', () => {
  it('completes the card, then offers to move it to the done column', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('checkbox', { name: 'Complete' }))
    expect(
      within(panel).getByRole('checkbox', { name: 'Complete' }),
    ).toBeChecked()
    await user.click(
      await within(panel).findByRole('button', { name: 'Move to Done' }),
    )

    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Done' })).getByRole(
          'button',
          { name: 'WEB-12 Login page' },
        ),
      ).toBeInTheDocument(),
    )
    expect(await cardPanel()).toHaveTextContent('in Done')
    expect(api.requests.map((r) => r.request)).toEqual([
      `POST /api/cards/${login.id}/complete`,
      `POST /api/cards/${login.id}/move`,
    ])
  })

  it('asks first when subtasks are still open', async () => {
    const card = boardCard('12', 'Login page', {
      subtaskProgress: { complete: 1, total: 3 },
    })
    server.use(
      http.get(`/api/cards/${card.id}/time-totals`, () =>
        HttpResponse.json({
          estimateMinutes: null,
          originalEstimateMinutes: null,
          timeSpentMinutes: 0,
          ownTimeMinutes: 0,
        }),
      ),
    )
    const { user, api } = openCard(card)

    await user.click(
      within(await cardPanel()).getByRole('checkbox', { name: 'Complete' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Complete anyway?' })
    expect(dialog).toHaveTextContent('2 subtasks are still open.')
    await user.click(
      within(dialog).getByRole('button', { name: 'Complete anyway' }),
    )

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]!.body).toEqual({ confirmOpenSubtasks: true })
  })

  it('reopens a complete card, leaving it where it is', async () => {
    const done = boardCard('12', 'Login page', { isComplete: true })
    const { user, api } = openCard(done, {
      view: boardView([boardColumn('Done', [done], { isDone: true })]),
    })
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('checkbox', { name: 'Complete' }))

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]!.request).toBe(`POST /api/cards/${done.id}/reopen`)
    expect(
      within(panel).getByRole('checkbox', { name: 'Complete' }),
    ).not.toBeChecked()
    expect(within(panel).queryByRole('button', { name: /^Move to/ })).toBe(null)
  })
})

describe('Deleting a card', () => {
  it('deletes a card its creator made, after asking, and closes the panel', async () => {
    const mine = boardCard('12', 'Login page', { createdById: ben.id })
    const { user, api, router } = openCard(mine, { me: ben })
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('button', { name: 'Delete card' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    expect(dialog).toHaveTextContent('Its chat is kept')
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    )

    await waitFor(() => expect(currentPath(router)).toBe(boardPath))
    expect(api.requests).toEqual([
      { request: `DELETE /api/cards/${mine.id}`, body: undefined },
    ])
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'WEB-12 Login page' })).toBe(
        null,
      ),
    )
  })

  it('lets a project admin delete anyone’s card', async () => {
    openCard(boardCard('12', 'Login page', { createdById: ben.id }))

    const panel = await cardPanel()

    // Once the project's members have loaded.
    await waitFor(() =>
      expect(
        within(panel).getByRole('button', { name: 'Delete card' }),
      ).toBeEnabled(),
    )
  })

  it('turns the button off, with the reason, for anyone else', async () => {
    const { container } = openCard(
      boardCard('12', 'Login page', { createdById: ana.id }),
      { me: ben },
    )
    const panel = await cardPanel()

    const button = within(panel).getByRole('button', { name: 'Delete card' })
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAccessibleDescription(
      'Only the person who made this card or a project admin can delete it.',
    )
    await expectNoAccessibilityProblems(container)
  })

  it('says how much time is logged when the card cannot be deleted', async () => {
    const { user } = openCard()
    server.use(
      http.delete(`/api/cards/${login.id}`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Cards with logged time cannot be deleted',
            loggedMinutes: 200,
          },
          { status: 409 },
        ),
      ),
    )

    await user.click(
      within(await cardPanel()).getByRole('button', { name: 'Delete card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This card has 3h 20m logged. A project admin can delete the time entries first.',
    )
  })

  it('asks what happens to each subtask, never deleting one with its own', async () => {
    const parent = boardCard('12', 'Login page', {
      subtaskProgress: { complete: 0, total: 2 },
    })
    const leaf = { ...boardCard('12.1', 'Form'), parentId: parent.id }
    const branch = { ...boardCard('12.2', 'Checks'), parentId: parent.id }
    server.use(
      http.get(`/api/cards/${parent.id}/time-totals`, () =>
        HttpResponse.json({
          estimateMinutes: null,
          originalEstimateMinutes: null,
          timeSpentMinutes: 0,
          ownTimeMinutes: 0,
        }),
      ),
      http.get(`/api/cards/${parent.id}/subtasks`, () =>
        HttpResponse.json({
          subtasks: [leaf, branch],
          progress: { complete: 0, total: 2 },
        }),
      ),
      http.get(`/api/cards/${leaf.id}/subtasks`, () =>
        HttpResponse.json({
          subtasks: [],
          progress: { complete: 0, total: 0 },
        }),
      ),
      http.get(`/api/cards/${branch.id}/subtasks`, () =>
        HttpResponse.json({
          subtasks: [boardCard('12.2.1', 'Deep')],
          progress: { complete: 0, total: 1 },
        }),
      ),
    )
    const { user, api } = openCard(parent)

    await user.click(
      within(await cardPanel()).getByRole('button', { name: 'Delete card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    const form = await within(dialog).findByRole('radiogroup', {
      name: 'WEB-12.1 Form',
    })
    const checks = within(dialog).getByRole('radiogroup', {
      name: 'WEB-12.2 Checks',
    })
    expect(within(checks).getByRole('radio', { name: 'Delete' })).toBeDisabled()
    expect(checks).toHaveTextContent('It has subtasks of its own')
    await user.click(within(form).getByRole('radio', { name: 'Delete' }))
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    )

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]!.body).toEqual({
      subtasks: {
        [leaf.id]: { action: 'delete' },
        [branch.id]: { action: 'standalone' },
      },
    })
  })
})

describe('On a phone', () => {
  it('shows the card and chat panels as tabs under the board', async () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      const chat = {
        id: login.chatId!,
        boardId: login.boardId,
        cardId: login.id,
        kind: 'TOPIC' as const,
        title: 'Login page',
        createdAt: '2026-10-30T09:00:00.000Z',
      }
      const { user, router } = openCard(login, {
        chats: [chat],
        members: [member(ana, 'ADMIN')],
      })
      await user.click(
        within(await cardPanel()).getByRole('button', { name: 'Open chat' }),
      )
      expect(currentPath(router)).toContain(`chat=${chat.id}`)

      const tabs = await screen.findByRole('tablist', { name: 'Panels' })
      await user.click(within(tabs).getByRole('tab', { name: 'Chat' }))
      expect(
        screen.getByRole('complementary', { name: 'Chat: Login page' }),
      ).toBeVisible()
      expect(
        screen.queryByRole('separator', { name: 'Resize the card panel' }),
      ).toBe(null)
    } finally {
      window.matchMedia = original
    }
  })
})
