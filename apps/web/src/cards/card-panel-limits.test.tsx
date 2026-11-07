import type { BoardCard } from '@tessera/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  boardPath,
  cardPanel,
  login,
  openCard,
  typeInto,
} from '../test/card-panel'
import { ben, fakeBoard } from '../test/fake-board'
import { boardCard, boardColumn, boardView } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { apiError, server } from '../test/server'

const TOO_LONG = 'Use at most 50000 characters'
const PICKER = 'Move to another parent'
const todoId = '88888888-8888-4888-8888-000000000001'

describe('The description’s length limit', () => {
  // Decision 1 (2026-11-07): the panel checks the shared rule first.
  it('says the description is too long and sends nothing', async () => {
    const long = boardCard('12', 'Login page', {
      description: 'a'.repeat(50_000),
    })
    const { user, api } = openCard(long)
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, 'b')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    expect(await within(panel).findByText(TOO_LONG)).toBeInTheDocument()
    expect(api.requests).toEqual([])
    // What was written is kept.
    expect(
      within(panel).getByRole('textbox', { name: 'Description' }),
    ).toBeInTheDocument()
  })
})

describe('A refusal shown in the panel', () => {
  // Decision 2 (2026-11-07): the API's "field: " prefix is dropped.
  it('drops the field name the API puts in front of its message', async () => {
    const { user } = openCard()
    server.use(
      http.patch(`/api/cards/${login.id}`, () =>
        apiError(400, 'title: Use at most 200 characters'),
      ),
    )
    const panel = await cardPanel()

    await user.selectOptions(within(panel).getByLabelText('Priority'), 'High')

    expect(
      await within(panel).findByText('Use at most 200 characters'),
    ).toBeInTheDocument()
    expect(within(panel).queryByText(/^title:/)).toBe(null)
  })

  it('shows a message without a prefix unchanged', async () => {
    const { user } = openCard()
    server.use(
      http.patch(`/api/cards/${login.id}`, () =>
        apiError(404, 'Card not found'),
      ),
    )
    const panel = await cardPanel()

    await user.selectOptions(within(panel).getByLabelText('Priority'), 'High')

    expect(await within(panel).findByText('Card not found')).toBeInTheDocument()
  })
})

describe('Focus when the opener is gone', () => {
  // Decision 3 (2026-11-07).
  it('goes to the Subtasks heading after a subtask is moved to another parent', async () => {
    const form = boardCard('12.1', 'Form', { depth: 1, parentId: login.id })
    const errors = boardCard('12.2', 'Errors', { depth: 1, parentId: login.id })
    const parent = { ...login, subtaskProgress: { complete: 0, total: 2 } }
    const icons = boardCard('14', 'Icon set')
    const cards: BoardCard[] = [parent, form, errors, icons]
    fakeBoard(boardView([boardColumn('To do', cards, { id: todoId })]))
    const { user } = renderApp(`${boardPath}?card=${parent.id}`)
    const panel = await cardPanel()
    const section = await within(panel).findByRole('region', {
      name: 'Subtasks',
    })
    const rows = await within(section).findAllByRole('listitem')
    const formRow = rows.find((item) => item.textContent?.includes('WEB-12.1'))!

    await user.click(
      within(formRow).getByRole('button', { name: 'Options for WEB-12.1' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: PICKER }))
    const picker = await screen.findByRole('dialog', { name: PICKER })
    await typeInto(user, within(picker).getByLabelText('Find a card'), 'icon')
    await user.click(
      await within(picker).findByRole('button', { name: /WEB-14 Icon set/ }),
    )
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    await waitFor(() =>
      expect(within(section).queryByText(/WEB-12\.1/)).toBe(null),
    )

    expect(
      within(section).getByRole('heading', { name: 'Subtasks' }),
    ).toHaveFocus()
  })

  it('goes to the heading of the card’s column after the card is deleted', async () => {
    const mine = boardCard('12', 'Login page', { createdById: ben.id })
    const { user, router } = openCard(mine, { me: ben })
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('button', { name: 'Delete card' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    )
    await waitFor(() => expect(currentPath(router)).toBe(boardPath))

    const column = screen.getByRole('region', { name: 'To do' })
    await waitFor(() =>
      expect(
        within(column).getByRole('heading', { name: 'To do' }),
      ).toHaveFocus(),
    )
  })
})
