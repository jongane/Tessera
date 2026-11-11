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
import { TYPED_TEXTS, withoutEscapes } from '../test/typed-text'

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
  // Escape in the link form closes the form only, not the panel (the same
  // as in the checklist forms).
  it.each(['Apply', 'Cancel'])(
    'closes the link form on Escape from its %s button, not the panel',
    async (button) => {
      const { user } = openCard()
      const panel = await cardPanel()
      await user.click(
        within(panel).getByRole('button', { name: 'Edit description' }),
      )
      await within(panel).findByRole('textbox', { name: 'Description' })
      await user.click(within(panel).getByRole('button', { name: 'Link' }))
      expect(within(panel).getByLabelText('Link address')).toBeInTheDocument()
      const form = within(panel).getByLabelText('Link address').closest('form')!
      within(form).getByRole('button', { name: button }).focus()
      await user.keyboard('{Escape}')

      expect(
        within(panel).queryByLabelText('Link address'),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('complementary', { name: 'Card WEB-12' }),
      ).toBeInTheDocument()
    },
  )

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

  // 42 (Jon, 2026-11-10): characters are kept as typed
  it('saves > < & as typed, never as &gt; &lt; &amp;', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, 'a > b & c < d')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.requests).toHaveLength(1))
    const sent = (api.requests[0]!.body as { description: string }).description
    expect(sent).not.toMatch(/&(gt|lt|amp);/)
    expect(sent).toContain('>')
    expect(sent).toContain('<')
    expect(sent).toContain('&')
    expect(await within(panel).findByText('a > b & c < d')).toBeInTheDocument()
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

describe('The description, when things go wrong', () => {
  it('keeps what was written when it cannot be saved', async () => {
    const { user } = openCard()
    server.use(
      http.patch(`/api/cards/${login.id}`, () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Broken' },
          { status: 500 },
        ),
      ),
    )
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, 'Long text')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    expect(
      await within(panel).findByText('Couldn’t save, try again'),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('textbox', { name: 'Description' }),
    ).toHaveTextContent('Long text')
  })

  it('does not ask when only the chat panel opens', async () => {
    const { user, router } = openCard(login, {
      chats: [
        {
          id: login.chatId!,
          boardId: login.boardId,
          cardId: login.id,
          kind: 'TOPIC',
          title: 'Login page',
          createdAt: '2026-10-30T09:00:00.000Z',
        },
      ],
    })
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, 'Draft')
    await user.click(within(panel).getByRole('button', { name: 'Open chat' }))

    expect(
      await screen.findByRole('complementary', { name: 'Chat: Login page' }),
    ).toBeInTheDocument()
    expect(currentPath(router)).toContain(`chat=${login.chatId}`)
    expect(
      screen.queryByRole('dialog', { name: 'Discard your changes?' }),
    ).toBe(null)
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

  it('cannot delete a card with subtasks while they fail to load', async () => {
    const parent = boardCard('12', 'Login page', {
      subtaskProgress: { complete: 0, total: 1 },
    })
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
        HttpResponse.json(
          { statusCode: 500, message: 'Broken' },
          { status: 500 },
        ),
      ),
    )
    const { user } = openCard(parent)

    await user.click(
      within(await cardPanel()).getByRole('button', { name: 'Delete card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Broken')
    expect(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    ).toBeDisabled()
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

describe('Deleting a card: focus', () => {
  // Decision 2 (2026-11-07): the PR 6 dialog gives focus back too.
  it('goes back to the “Delete card” button after Cancel and after Escape', async () => {
    const { user } = openCard(login)
    const panel = await cardPanel()
    const button = within(panel).getByRole('button', { name: 'Delete card' })

    await user.click(button)
    let dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(button).toHaveFocus()

    await user.click(button)
    dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(button).toHaveFocus()
  })
})

// Antagonist proof, round 2 (criterion 43).
describe('The description keeps text as typed (criteria 42 and 43)', () => {
  // 43
  it('shows a typed HTML tag as written after saving', async () => {
    const { user } = openCard()
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, 'Wrap it in a <div> first')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    expect(
      await within(panel).findByText('Wrap it in a <div> first'),
    ).toBeInTheDocument()
  })
})

// Criterion 43: text that looks like HTML stays as typed through saving,
// reopening the editor and saving again.
describe('The description keeps typed HTML-like text (criterion 43)', () => {
  const ENTITY_CASE = 'a literal &lt;div&gt; here'

  it.each(TYPED_TEXTS)(
    'keeps %s through saving, reopening and saving again',
    async (_name, text) => {
      const { user, api } = openCard()
      const panel = await cardPanel()

      await user.click(
        await within(panel).findByRole('button', { name: 'Edit description' }),
      )
      const first = await within(panel).findByRole('textbox', {
        name: 'Description',
      })
      // The editor takes the focus once it is ready; typing sooner is lost.
      await waitFor(() => expect(first).toHaveFocus())
      await typeInto(user, first, text)
      await user.click(within(panel).getByRole('button', { name: 'Save' }))
      expect(await within(panel).findByText(text)).toBeInTheDocument()

      await user.click(
        await within(panel).findByRole('button', { name: 'Edit description' }),
      )
      const editor = await within(panel).findByRole('textbox', {
        name: 'Description',
      })
      await waitFor(() => expect(editor).toHaveFocus())
      // The editor opens holding the text as it was typed.
      expect(editor.textContent).toBe(text)
      await user.keyboard(' more')
      await user.click(within(panel).getByRole('button', { name: 'Save' }))
      expect(await within(panel).findByText(`${text} more`)).toBeInTheDocument()

      await waitFor(() => expect(api.requests).toHaveLength(2))
      if (text !== ENTITY_CASE) {
        // (The literal entity's own text holds "&gt;", and the exact text
        // was already found above.)
        expect(panel).not.toHaveTextContent(/&(gt|lt|amp);/)
        const saved = api.requests.map(
          (r) => (r.body as { description: string }).description,
        )
        expect(saved.map(withoutEscapes)).toEqual([text, `${text} more`])
        for (const description of saved) {
          expect(description).not.toMatch(/&(gt|lt|amp);/)
        }
      }
    },
  )
})

// Antagonist proof, round 3 (R3).
describe('A code block in the description keeps its text (criterion 43)', () => {
  // 43 (R3)
  it('saves and shows &lt; &gt; &amp; typed in a code block as typed', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()
    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await waitFor(() => expect(editor).toHaveFocus())

    // "``` " starts a code block.
    await typeInto(
      user,
      editor,
      '``` &lt;div&gt;{Enter}&gt; quoted{Enter}a &amp; b',
    )
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect((api.requests[0]!.body as { description: string }).description).toBe(
      '```\n&lt;div&gt;\n&gt; quoted\na &amp; b\n```',
    )
  })
})

describe('A code block in the description, round trip (criterion 43)', () => {
  // 43 (R3)
  it('shows the code block as typed, and keeps it through reopening and saving again', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()
    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const first = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await waitFor(() => expect(first).toHaveFocus())
    await typeInto(
      user,
      first,
      '``` &lt;div&gt;{Enter}&gt; quoted{Enter}a &amp; b',
    )
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    const typed = '&lt;div&gt;\n&gt; quoted\na &amp; b'
    await waitFor(() =>
      expect(panel.querySelector('pre')?.textContent).toBe(typed),
    )

    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await waitFor(() => expect(editor).toHaveFocus())
    expect(editor.textContent).toBe(typed)
    await user.keyboard(' x')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.requests).toHaveLength(2))
    expect((api.requests[1]!.body as { description: string }).description).toBe(
      '```\n&lt;div&gt;\n&gt; quoted\na &amp; b x\n```',
    )
  })
})

describe('A > in a quote or a list item of the description (criterion 43)', () => {
  // 43 (reviewer): a ">" written as a character, in a quote and in a list
  // item (Markdown writes it "\\>"), stays a ">" through saving.
  it('keeps a > character in a quote and in a list item, through reopening and saving', async () => {
    const { user, api } = openCard(
      boardCard('12', 'Login page', {
        description:
          '> quote line\n>\n> \\> typed greater-than\n\n- \\> in a list item',
      }),
    )
    const panel = await cardPanel()
    expect(
      await within(panel).findByText('> typed greater-than'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('> in a list item')).toBeInTheDocument()

    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await waitFor(() => expect(editor).toHaveFocus())
    expect(editor.textContent).toContain('> typed greater-than')
    expect(editor.textContent).toContain('> in a list item')
    await user.keyboard(' more')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.requests).toHaveLength(1))
    const saved = (api.requests[0]!.body as { description: string }).description
    expect(saved).not.toMatch(/&(gt|lt|amp);/)
    expect(
      await within(panel).findByText('> in a list item more'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('> typed greater-than')).toBeInTheDocument()
  })
})

// Antagonist proof, round 4 (R4-3).
describe('Line breaks in the description (criterion 43)', () => {
  // 43
  it('keeps a typed line break in table-like text through saving again', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()

    for (const typed of [
      '| a | b |{Shift>}{Enter}{/Shift}| --- | --- |',
      ' more',
    ]) {
      await user.click(
        await within(panel).findByRole('button', { name: 'Edit description' }),
      )
      const editor = await within(panel).findByRole('textbox', {
        name: 'Description',
      })
      await waitFor(() => expect(editor).toHaveFocus())
      await typeInto(user, editor, typed)
      await user.click(within(panel).getByRole('button', { name: 'Save' }))
      await within(panel).findByRole('button', { name: 'Edit description' })
    }

    await waitFor(() => expect(api.requests).toHaveLength(2))
    expect(
      (api.requests[1]!.body as { description: string }).description,
    ).toMatch(/\| a \| b \|\s*\n\| --- \| --- \|/)
  })
})

// Criterion 43 (reviewer): a paragraph that starts with four or more spaces
// must not turn into a code block when the text is read back.
describe('A paragraph starting with spaces in the description (criterion 43)', () => {
  it('stays a paragraph through saving, reopening and saving again', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()
    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const first = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await waitFor(() => expect(first).toHaveFocus())
    await typeInto(user, first, 'first{Enter}    second')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    await within(panel).findByRole('button', { name: 'Edit description' })

    expect(panel.querySelector('pre')).toBeNull()
    expect(panel).toHaveTextContent('second')
    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await waitFor(() => expect(editor).toHaveFocus())
    expect(editor.querySelector('pre')).toBeNull()
    expect(editor.textContent).toContain('second')
    await user.keyboard(' z')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))
    await within(panel).findByRole('button', { name: 'Edit description' })

    await waitFor(() => expect(api.requests).toHaveLength(2))
    expect(panel.querySelector('pre')).toBeNull()
    expect(panel).toHaveTextContent('second z')
  })
})

// Criterion 19: the Link button of the description with an odd address.
describe('The description’s Link button with an odd address (criterion 19)', () => {
  it.each([
    ['has a space', 'https://example.com/my docs', 'example.com/my'],
    ['has a )', 'https://x.io/a)b', 'x.io/a)b'],
  ])(
    'keeps the link on the selected words when the address %s',
    async (_name, address, hrefPart) => {
      const { user } = openCard()
      const panel = await cardPanel()
      await user.click(
        await within(panel).findByRole('button', { name: 'Edit description' }),
      )
      const editor = await within(panel).findByRole('textbox', {
        name: 'Description',
      })
      await waitFor(() => expect(editor).toHaveFocus())
      await typeInto(user, editor, 'read the docs')
      await user.keyboard('{Control>}a{/Control}')
      await user.click(within(panel).getByRole('button', { name: 'Link' }))
      await typeInto(
        user,
        within(panel).getByLabelText('Link address'),
        address,
      )
      await user.click(within(panel).getByRole('button', { name: 'Apply' }))
      await user.click(within(panel).getByRole('button', { name: 'Save' }))

      const link = await within(panel).findByRole('link', {
        name: 'read the docs',
      })
      expect(decodeURI(link.getAttribute('href') ?? '')).toContain(hrefPart)
      expect(panel).not.toHaveTextContent('](')
    },
  )
})
