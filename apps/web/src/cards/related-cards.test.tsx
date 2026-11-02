import type { CardRelatives, RelatedCard } from '@tessera/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { boardPath, cardPanel } from '../test/card-panel'
import { fakeBoard } from '../test/fake-board'
import {
  backlog,
  boardCard,
  boardColumn,
  boardView,
  sprint,
  website,
} from '../test/fixtures'
import { renderApp } from '../test/render'
import { apiError, server } from '../test/server'

// WEB-12 > WEB-12.1 > WEB-12.1.1 on this board, WEB-12.2 on the Backlog,
// and WEB-14, which is not related.
const login = boardCard('12', 'Login page')
const form = { ...boardCard('12.1', 'Form'), parentId: login.id }
const checks = { ...boardCard('12.1.1', 'Checks'), parentId: form.id }
const icons = boardCard('14', 'Icon set')
const errors: RelatedCard = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-999999999999',
  number: 'WEB-12.2',
  title: 'Errors',
  boardId: backlog.id,
  boardName: 'Backlog',
  isComplete: false,
}

function related(card: typeof login): RelatedCard {
  return {
    id: card.id,
    number: card.number,
    title: card.title,
    boardId: sprint.id,
    boardName: sprint.name,
    isComplete: card.isComplete,
  }
}

const relatives: Record<string, CardRelatives> = {
  [login.id]: {
    parents: [],
    subtasks: [
      { ...related(form), level: 1 },
      { ...related(checks), level: 2 },
      { ...errors, level: 1 },
    ],
    siblings: [],
  },
  [form.id]: {
    parents: [related(login)],
    subtasks: [{ ...related(checks), level: 1 }],
    siblings: [errors],
  },
}

function openBoard(cardId: string) {
  fakeBoard(boardView([boardColumn('To do', [login, form, checks, icons])]), {
    relatives,
  })
  return renderApp(`${boardPath}?card=${cardId}`)
}

function tile(name: string) {
  return screen.getByRole('button', { name })
}

describe('Seeing related cards', () => {
  it('tags the open card’s relatives on the board', async () => {
    const { container } = openBoard(form.id)
    await cardPanel('WEB-12.1')

    await waitFor(() =>
      expect(tile('WEB-12 Login page')).toHaveAccessibleDescription(
        expect.stringContaining('Parent of the open card.'),
      ),
    )
    expect(tile('WEB-12.1.1 Checks')).toHaveAccessibleDescription(
      expect.stringContaining('Subtask of the open card.'),
    )
    expect(tile('WEB-14 Icon set')).not.toHaveAccessibleDescription(
      expect.stringContaining('open card'),
    )
    // The tags are on screen too, so colour is never the only sign.
    const parentTile = tile('WEB-12 Login page').closest('li')!
    expect(within(parentTile).getByText('Parent')).toBeVisible()
    await expectNoAccessibilityProblems(container)
  })

  it('tells direct subtasks from deeper ones', async () => {
    openBoard(login.id)
    await cardPanel('WEB-12')

    await waitFor(() =>
      expect(tile('WEB-12.1 Form')).toHaveAccessibleDescription(
        expect.stringContaining('Subtask of the open card.'),
      ),
    )
    expect(tile('WEB-12.1.1 Checks')).toHaveAccessibleDescription(
      expect.stringContaining('Deeper subtask of the open card.'),
    )
  })

  it('lists relatives on other boards in the card panel, with links', async () => {
    openBoard(form.id)
    const panel = await cardPanel('WEB-12.1')

    const others = await within(panel).findByRole('region', {
      name: 'Related cards on other boards',
    })
    const siblings = within(others).getByRole('list', { name: 'Siblings' })
    const link = within(siblings).getByRole('link', {
      name: 'WEB-12.2 Errors',
    })
    expect(link).toHaveAttribute('href', '/WEB-12.2')
    expect(siblings).toHaveTextContent('Backlog')
    // Relatives on this board are shown on the board instead.
    expect(within(others).queryByRole('list', { name: 'Parents' })).toBe(null)
  })

  it('has no list when every relative is on this board', async () => {
    openBoard(checks.id)
    const panel = await cardPanel('WEB-12.1.1')

    await within(panel).findByLabelText('Title')
    expect(
      within(panel).queryByRole('region', {
        name: 'Related cards on other boards',
      }),
    ).toBe(null)
  })

  it('says when the related cards could not be loaded', async () => {
    openBoard(form.id)
    server.use(
      http.get(`/api/cards/${form.id}/relatives`, () =>
        apiError(500, 'Broken'),
      ),
    )
    const panel = await cardPanel('WEB-12.1')

    expect(
      await within(panel).findByText(
        'Couldn’t load the related cards. They will be tried again shortly.',
      ),
    ).toBeInTheDocument()
  })

  it('outlines relatives in the project’s colours', async () => {
    fakeBoard(boardView([boardColumn('To do', [login, form, checks])]), {
      relatives,
      project: {
        ...website,
        relationColours: { ...website.relationColours, parent: 'TEAL' },
      },
    })
    renderApp(`${boardPath}?card=${form.id}`)
    await cardPanel('WEB-12.1')

    await waitFor(() =>
      expect(
        tile('WEB-12 Login page').closest('li')!.firstElementChild,
      ).toHaveAttribute('data-relation-colour', 'TEAL'),
    )
  })
})
