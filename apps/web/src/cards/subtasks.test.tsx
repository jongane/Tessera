import type { BoardCard } from '@tessera/shared'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BOARD_RELOAD_MS } from '../api/query-keys'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { boardPath, cardPanel, typeInto } from '../test/card-panel'
import { backlogCard, backlogColumns, fakeBoard } from '../test/fake-board'
import { boardCard, boardColumn, boardView } from '../test/fixtures'
import { currentPath, renderApp } from '../test/render'
import { apiError, server } from '../test/server'

// Web PR 7b: the parent line, the Subtasks section, adding and moving
// subtasks, and the third choice when deleting a card (acceptance criteria
// 3 to 13 and 44; docs/card-features.md, section 4).

// Wording. Proposed ones wait for the repository owner; they are all here,
// so a change is made in one place.
const SAVE_FAILED = 'Couldn’t save, try again'
const TOO_DEEP = 'Subtasks can only go 5 levels deep'
const NO_SUBTASKS = 'No subtasks yet'
const OFFER = 'Completed. Move it to Done?'
const OFFER_MOVE = 'Move'
const OFFER_KEEP = 'Keep here'
const EMPTY = 'This can’t be empty'
// The name of the picker's dialog, wherever it was opened from (answered
// 2026-11-04: the same from a row, the card's menu and the delete dialog).
const PICKER = 'Move to another parent'

const todoId = '88888888-8888-4888-8888-000000000001'
const doneId = '88888888-8888-4888-8888-000000000002'

// A board with `cards` in To do and an empty Done column.
function boardOf(...cards: BoardCard[]) {
  return boardView([
    boardColumn('To do', cards, { id: todoId }),
    boardColumn('Done', [], { id: doneId, isDone: true }),
  ])
}

// A card with its subtasks: the card's count follows what is given.
function family(
  parent: BoardCard,
  ...children: BoardCard[]
): { parent: BoardCard; children: BoardCard[] } {
  const direct = children.filter(
    (c) => c.numberPath.split('.').length === parent.depth + 2,
  )
  return {
    parent: {
      ...parent,
      subtaskProgress: {
        complete: direct.filter((c) => c.isComplete).length,
        total: direct.length,
      },
    },
    children: children.map((c) =>
      c.numberPath.split('.').length === parent.depth + 2
        ? { ...c, parentId: parent.id }
        : c,
    ),
  }
}

const login = boardCard('12', 'Login page')

function open(
  cards: BoardCard[],
  cardId: string,
  options: Parameters<typeof fakeBoard>[1] = {},
) {
  const api = fakeBoard(boardOf(...cards), options)
  const app = renderApp(`${boardPath}?card=${cardId}`)
  return { ...app, api }
}

// The Subtasks section of the open card.
async function subtasksOf(panel: HTMLElement) {
  return within(panel).findByRole('region', { name: 'Subtasks' })
}

// The row of one subtask in the section, found by its number.
async function row(section: HTMLElement, number: string) {
  const items = await within(section).findAllByRole('listitem')
  const found = items.filter((item) => item.textContent?.includes(number))
  expect(found, `one row for ${number}`).toHaveLength(1)
  return found[0]!
}

// What opens a subtask: a link (another board) or a button (this board).
function opener(scope: HTMLElement, number: string) {
  const name = new RegExp(`${number.replace('.', '\\.')}`)
  return (
    within(scope).queryByRole('link', { name }) ??
    within(scope).getByRole('button', { name })
  )
}

// The button that opens the menu of a row: the row's only menu button.
function rowMenu(row: HTMLElement) {
  const buttons = within(row)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-haspopup') === 'menu')
  expect(buttons, 'one menu button in the row').toHaveLength(1)
  return buttons[0]!
}

// The button of the card panel's own options menu, named "Card options"
// (owner's answer, 2026-11-07). It is not in a subtask's row.
function cardMenu(panel: HTMLElement) {
  const button = within(panel).getByRole('button', { name: 'Card options' })
  expect(button).toHaveAttribute('aria-haspopup', 'menu')
  expect(button.closest('li'), 'not in a row').toBe(null)
  return button
}

function expectTurnedOff(element: HTMLElement) {
  expect(
    element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true',
  ).toBe(true)
}

// Types into the picker's search box, replacing what was there.
async function search(
  user: ReturnType<typeof renderApp>['user'],
  dialog: HTMLElement,
  words: string,
) {
  const box = within(dialog).getByLabelText('Find a card')
  box.focus()
  await user.clear(box)
  await user.type(box, words, { skipClick: true })
}

describe('The parent line', () => {
  // Criteria 3 and 44.
  it('shows “Subtask of …” as a link to the parent, and Back returns', async () => {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
    )
    const form = children[0]!
    const { user, router, container } = open([parent, form], form.id)
    const panel = await cardPanel('WEB-12.1')

    const link = await within(panel).findByRole('link', {
      name: 'WEB-12 Login page',
    })
    expect(panel).toHaveTextContent(/Subtask of\s*WEB-12 Login page/)
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(`card=${parent.id}`),
    )
    await expectNoAccessibilityProblems(container)

    await user.click(link)
    expect(await cardPanel('WEB-12')).toBeInTheDocument()
    expect(currentPath(router)).toBe(`${boardPath}?card=${parent.id}`)

    await act(async () => {
      await router.navigate(-1)
    })
    expect(await cardPanel('WEB-12.1')).toBeInTheDocument()
  })

  it('links to the parent’s board when the parent is on another board', async () => {
    const platform = backlogCard('30', 'Platform')
    const form = boardCard('30.1', 'Form', {
      parentId: platform.id,
      depth: 1,
    })
    open([form], form.id, { elsewhere: [platform] })
    const panel = await cardPanel('WEB-30.1')

    expect(
      await within(panel).findByRole('link', { name: 'WEB-30 Platform' }),
    ).toHaveAttribute('href', '/WEB-30')
  })

  it('shows no such line on a top-level card', async () => {
    open([login], login.id)
    const panel = await cardPanel()
    await within(panel).findByRole('region', { name: 'Subtasks' })

    expect(panel).not.toHaveTextContent('Subtask of')
  })
})

describe('The Subtasks section', () => {
  // Criteria 4 and 44.
  it('shows the progress of the direct subtasks and a row for each', async () => {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.1.1', 'Fields', { depth: 2, isComplete: true }),
      boardCard('12.1.2', 'Layout', { depth: 2 }),
      boardCard('12.2', 'Checks', { depth: 1, isComplete: true }),
      backlogCard('12.3', 'Errors', { depth: 1 }),
    )
    const [form, fields, layout, checks, errors] = children as [
      BoardCard,
      BoardCard,
      BoardCard,
      BoardCard,
      BoardCard,
    ]
    const { container } = open(
      [
        parent,
        {
          ...form,
          subtaskProgress: { complete: 1, total: 2 },
        },
        { ...fields, parentId: form.id },
        { ...layout, parentId: form.id },
        checks,
      ],
      parent.id,
      { elsewhere: [errors] },
    )
    const section = await subtasksOf(await cardPanel())

    // Direct subtasks only: 1 of 3, though 5 cards are below.
    await waitFor(() => expect(section).toHaveTextContent('1 of 3 complete'))
    expect(section).not.toHaveTextContent('Fields')
    const formRow = await row(section, 'WEB-12.1')
    expect(formRow).toHaveTextContent('Form')
    expect(formRow).toHaveTextContent('To do')
    expect(formRow).toHaveTextContent('1 of 2')
    expect(formRow).not.toHaveTextContent('Sprint 1')
    expect(within(formRow).getByRole('checkbox')).not.toBeChecked()
    const checksRow = await row(section, 'WEB-12.2')
    expect(checksRow).not.toHaveTextContent(' of ')
    expect(within(checksRow).getByRole('checkbox')).toBeChecked()
    const errorsRow = await row(section, 'WEB-12.3')
    expect(errorsRow).toHaveTextContent('Ideas')
    expect(errorsRow).toHaveTextContent('Backlog')
    await expectNoAccessibilityProblems(container)
  })

  it('says there are no subtasks yet, with the Add subtask button', async () => {
    const { container } = open([login], login.id)
    const section = await subtasksOf(await cardPanel())

    expect(section).toHaveTextContent(NO_SUBTASKS)
    expect(
      within(section).getByRole('button', { name: 'Add subtask' }),
    ).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)
  })

  // Criterion 5.
  it('opens a subtask when it is clicked, and Back returns to the parent', async () => {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
    )
    const { user, router } = open([parent, ...children], parent.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(opener(await row(section, 'WEB-12.1'), 'WEB-12.1'))

    expect(await cardPanel('WEB-12.1')).toBeInTheDocument()
    expect(currentPath(router)).toBe(`${boardPath}?card=${children[0]!.id}`)
    await act(async () => {
      await router.navigate(-1)
    })
    expect(await cardPanel('WEB-12')).toBeInTheDocument()
  })

  it('links a subtask on another board to that board', async () => {
    const errors = backlogCard('12.3', 'Errors', { depth: 1 })
    const { parent } = family(login, errors)
    open([parent], parent.id, {
      elsewhere: [{ ...errors, parentId: parent.id }],
    })
    const section = await subtasksOf(await cardPanel())

    expect(
      within(await row(section, 'WEB-12.3')).getByRole('link', {
        name: /WEB-12\.3/,
      }),
    ).toHaveAttribute('href', '/WEB-12.3')
  })
})

describe('Completing a subtask from the list', () => {
  function twoSubtasks() {
    return family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.2', 'Checks', { depth: 1 }),
    )
  }

  // Criterion 6 and the answer to Q4: the offer to move it to Done.
  it('ticks it straight away, then offers to move it to its board’s Done column', async () => {
    const { parent, children } = twoSubtasks()
    const [form] = children as [BoardCard, BoardCard]
    const { user, api, container } = open([parent, ...children], parent.id)
    const section = await subtasksOf(await cardPanel())
    const formRow = await row(section, 'WEB-12.1')

    await user.click(within(formRow).getByRole('checkbox'))
    expect(within(formRow).getByRole('checkbox')).toBeChecked()
    expect(await within(section).findByText(OFFER)).toBeInTheDocument()
    await waitFor(() => expect(section).toHaveTextContent('1 of 2 complete'))
    await expectNoAccessibilityProblems(container)
    await user.click(within(section).getByRole('button', { name: OFFER_MOVE }))

    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Done' })).getByRole(
          'button',
          { name: 'WEB-12.1 Form' },
        ),
      ).toBeInTheDocument(),
    )
    expect(within(section).queryByText(OFFER)).not.toBeInTheDocument()
    expect(api.requests.map((r) => r.request)).toEqual([
      `POST /api/cards/${form.id}/complete`,
      `POST /api/cards/${form.id}/move`,
    ])
    expect(api.requests[1]!.body).toMatchObject({ columnId: doneId })
  })

  it('leaves the subtask where it is on “Keep here”', async () => {
    const { parent, children } = twoSubtasks()
    const { user, api } = open([parent, ...children], parent.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    )
    await user.click(
      await within(section).findByRole('button', { name: OFFER_KEEP }),
    )

    expect(within(section).queryByText(OFFER)).not.toBeInTheDocument()
    expect(api.requests).toHaveLength(1)
    expect(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    ).toBeChecked()
  })

  it('moves a subtask on another board to that board’s own Done column', async () => {
    const errors = backlogCard('12.3', 'Errors', { depth: 1 })
    const { parent } = family(login, errors)
    const { user, api } = open([parent], parent.id, {
      elsewhere: [{ ...errors, parentId: parent.id }],
    })
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(await row(section, 'WEB-12.3')).getByRole('checkbox'),
    )
    await user.click(
      await within(section).findByRole('button', { name: OFFER_MOVE }),
    )

    await waitFor(() => expect(api.requests).toHaveLength(2))
    expect(api.requests[1]).toMatchObject({
      request: `POST /api/cards/${errors.id}/move`,
      body: { columnId: backlogColumns.shipped },
    })
  })

  it('makes no offer for a subtask already in its Done column', async () => {
    const { parent } = family(login, boardCard('12.1', 'Form', { depth: 1 }))
    const form = boardCard('12.1', 'Form', { depth: 1, parentId: parent.id })
    const api = fakeBoard(
      boardView([
        boardColumn('To do', [parent], { id: todoId }),
        boardColumn('Done', [form], { id: doneId, isDone: true }),
      ]),
    )
    const { user } = renderApp(`${boardPath}?card=${parent.id}`)
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    )

    await waitFor(() =>
      expect(api.requests.map((r) => r.request)).toEqual([
        `POST /api/cards/${form.id}/complete`,
      ]),
    )
    expect(within(section).queryByText(OFFER)).not.toBeInTheDocument()
  })

  it('reopens a ticked subtask straight away when it is unticked', async () => {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1, isComplete: true }),
    )
    const { user, api } = open([parent, ...children], parent.id)
    const section = await subtasksOf(await cardPanel())
    const formRow = await row(section, 'WEB-12.1')
    expect(within(formRow).getByRole('checkbox')).toBeChecked()

    await user.click(within(formRow).getByRole('checkbox'))

    expect(within(formRow).getByRole('checkbox')).not.toBeChecked()
    await waitFor(() =>
      expect(api.requests.map((r) => r.request)).toEqual([
        `POST /api/cards/${children[0]!.id}/reopen`,
      ]),
    )
    expect(within(section).queryByText(OFFER)).not.toBeInTheDocument()
  })

  it('asks first when the subtask has open subtasks of its own', async () => {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.1.1', 'Fields', { depth: 2 }),
      boardCard('12.1.2', 'Layout', { depth: 2, isComplete: true }),
    )
    const [form, fields, layout] = children as [BoardCard, BoardCard, BoardCard]
    const { user, api } = open(
      [
        parent,
        { ...form, subtaskProgress: { complete: 1, total: 2 } },
        { ...fields, parentId: form.id },
        { ...layout, parentId: form.id },
      ],
      parent.id,
    )
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Complete anyway?',
    })
    expect(dialog).toHaveTextContent('1 subtask is still open.')
    expect(api.requests).toEqual([])
    await user.click(
      within(dialog).getByRole('button', { name: 'Complete anyway' }),
    )

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]).toMatchObject({
      request: `POST /api/cards/${form.id}/complete`,
      body: { confirmOpenSubtasks: true },
    })
  })

  it('undoes the tick and says so when it could not be saved', async () => {
    const { parent, children } = twoSubtasks()
    const { user } = open([parent, ...children], parent.id)
    server.use(
      http.post('/api/cards/:cardId/complete', () =>
        apiError(500, 'Something broke'),
      ),
    )
    const section = await subtasksOf(await cardPanel())
    const formRow = await row(section, 'WEB-12.1')

    await user.click(within(formRow).getByRole('checkbox'))

    expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument()
    await waitFor(() =>
      expect(within(formRow).getByRole('checkbox')).not.toBeChecked(),
    )
  })
})

describe('Adding a subtask', () => {
  // Criterion 7 and 44.
  it('adds one in the parent’s column, which the form starts on', async () => {
    const { user, api, container } = open([login], login.id)
    const section = await subtasksOf(await cardPanel())

    // The other boards' columns are not loaded before the form opens.
    expect(api.boardsRead).toEqual([])
    await user.click(
      within(section).getByRole('button', { name: 'Add subtask' }),
    )
    const column = await within(section).findByLabelText('Column')
    expect(column).toHaveDisplayValue('To do')
    expect(api.boardsRead.length).toBeGreaterThan(0)
    // Every board's columns, grouped by board.
    expect(
      within(within(column).getByRole('group', { name: 'Backlog' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ideas', 'Later', 'Shipped'])
    expect(
      within(within(column).getByRole('group', { name: 'Sprint 1' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['To do', 'Done'])
    await expectNoAccessibilityProblems(container)
    await typeInto(
      user,
      within(section).getByRole('textbox', { name: /title/i }),
      'Review{Enter}',
    )

    expect(await row(section, 'WEB-12.1')).toHaveTextContent('Review')
    await waitFor(() => expect(section).toHaveTextContent('0 of 1 complete'))
    expect(
      await within(screen.getByRole('region', { name: 'To do' })).findByRole(
        'button',
        { name: 'WEB-12.1 Review' },
      ),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([
      {
        request: `POST /api/cards/${login.id}/subtasks`,
        body: { columnId: todoId, title: 'Review' },
      },
    ])
  })

  // Criterion 8.
  it('adds one in a column of another board and shows that board', async () => {
    const { user, api } = open([login], login.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(section).getByRole('button', { name: 'Add subtask' }),
    )
    const column = await within(section).findByLabelText('Column')
    await user.selectOptions(
      column,
      await within(
        await within(column).findByRole('group', { name: 'Backlog' }),
      ).findByRole('option', { name: 'Later' }),
    )
    await typeInto(
      user,
      within(section).getByRole('textbox', { name: /title/i }),
      'Plan{Enter}',
    )

    const added = await row(section, 'WEB-12.1')
    expect(added).toHaveTextContent('Backlog')
    expect(added).toHaveTextContent('Later')
    expect(api.requests).toEqual([
      {
        request: `POST /api/cards/${login.id}/subtasks`,
        body: { columnId: backlogColumns.later, title: 'Plan' },
      },
    ])
  })

  it('refuses an empty title and one over 200 characters, sending nothing', async () => {
    const { user, api } = open([login], login.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(section).getByRole('button', { name: 'Add subtask' }),
    )
    const title = within(section).getByRole('textbox', { name: /title/i })
    await typeInto(user, title, '{Enter}')
    expect(await within(section).findByText(EMPTY)).toBeInTheDocument()

    title.focus()
    await user.paste('x'.repeat(201))
    await user.keyboard('{Enter}')
    expect(await within(section).findByText(/200/)).toBeInTheDocument()
    expect(api.requests).toEqual([])
  })

  // Escape in the Add subtask form closes the form only, not the panel.
  it.each(['title box', 'Cancel button'])(
    'closes the form on Escape from its %s, not the panel',
    async (where) => {
      const { user } = open([login], login.id)
      const panel = await cardPanel()
      const section = await subtasksOf(panel)
      await user.click(
        within(section).getByRole('button', { name: 'Add subtask' }),
      )
      const title = within(section).getByRole('textbox', { name: /title/i })
      if (where === 'title box') title.focus()
      else within(section).getByRole('button', { name: 'Cancel' }).focus()
      await user.keyboard('{Escape}')

      expect(
        within(section).queryByRole('textbox', { name: /title/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('complementary', { name: 'Card WEB-12' }),
      ).toBeInTheDocument()
    },
  )

  // Criterion 9 and 44.
  it('turns Add subtask off on a card 5 levels deep, and says why', async () => {
    const deep = boardCard('12.1.1.1.1', 'Deep card', { parentId: login.id })
    const { container, api } = open([deep], deep.id)
    const section = await subtasksOf(await cardPanel('WEB-12.1.1.1.1'))

    const add = within(section).getByRole('button', { name: 'Add subtask' })
    expectTurnedOff(add)
    expect(add).toHaveAccessibleDescription(TOO_DEEP)
    await expectNoAccessibilityProblems(container)
    expect(api.requests).toEqual([])
  })

  it('shows the API’s message when it refuses a subtask', async () => {
    const { user } = open([login], login.id)
    server.use(
      http.post('/api/cards/:cardId/subtasks', () =>
        apiError(409, 'Subtasks can only go 5 levels deep'),
      ),
    )
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(section).getByRole('button', { name: 'Add subtask' }),
    )
    await typeInto(
      user,
      within(section).getByRole('textbox', { name: /title/i }),
      'Review{Enter}',
    )

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      TOO_DEEP,
    )
  })
})

describe('Moving a subtask to another parent', () => {
  const icons = boardCard('14', 'Icon set')
  const builder = boardCard('15', 'Form builder')
  const library = backlogCard('30', 'Form library')

  function withForm() {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.1.1', 'Form checks', { depth: 2 }),
    )
    const [form, checks] = children as [BoardCard, BoardCard]
    return {
      form: { ...form, subtaskProgress: { complete: 0, total: 1 } },
      cards: [
        parent,
        { ...form, subtaskProgress: { complete: 0, total: 1 } },
        { ...checks, parentId: form.id },
        icons,
        builder,
      ],
      parent,
    }
  }

  // Criterion 10 and 44.
  it('finds cards by number or title, leaving out the card and its own subtasks, and moves it', async () => {
    const { form, cards, parent } = withForm()
    const { user, api, container } = open(cards, parent.id, {
      elsewhere: [library],
    })
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const dialog = await screen.findByRole('dialog', { name: PICKER })
    await search(user, dialog, 'form')

    // Typed in one go, asked once; the card and its subtask are not offered.
    const builderButton = await within(dialog).findByRole('button', {
      name: /WEB-15 Form builder/,
    })
    expect(builderButton).toHaveTextContent('Sprint 1')
    expect(
      within(dialog).getByRole('button', { name: /WEB-30 Form library/ }),
    ).toHaveTextContent('Backlog')
    expect(api.searches).toEqual(['form'])
    expect(
      within(dialog).queryByRole('button', { name: /WEB-12\.1 Form$/ }),
    ).toBe(null)
    expect(within(dialog).queryByRole('button', { name: /Form checks/ })).toBe(
      null,
    )
    await expectNoAccessibilityProblems(container)
    await user.click(builderButton)

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: PICKER })).toBe(null),
    )
    expect(api.requests).toEqual([
      {
        request: `PUT /api/cards/${form.id}/parent`,
        body: { parentId: builder.id },
      },
    ])
    // The list and the board reload.
    await waitFor(() => expect(section).toHaveTextContent(NO_SUBTASKS))
    expect(
      await within(screen.getByRole('region', { name: 'To do' })).findByRole(
        'button',
        { name: 'WEB-15.1 Form' },
      ),
    ).toBeInTheDocument()
  })

  it('shows the API’s message when the move would go too deep, and stays open', async () => {
    const { cards, parent } = withForm()
    const { user } = open(cards, parent.id)
    server.use(
      http.put('/api/cards/:cardId/parent', () =>
        apiError(409, 'Subtasks can only go 5 levels deep'),
      ),
    )
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const dialog = await screen.findByRole('dialog', { name: PICKER })
    await search(user, dialog, 'icon')
    await user.click(
      await within(dialog).findByRole('button', { name: /WEB-14 Icon set/ }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(TOO_DEEP)
  })

  // Criterion 11.
  it('makes a subtask its own card, which leaves the list', async () => {
    const { form, cards, parent } = withForm()
    const { user, api } = open(cards, parent.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Make its own card' }),
    )

    await waitFor(() => expect(section).toHaveTextContent(NO_SUBTASKS))
    expect(api.requests).toEqual([
      {
        request: `PUT /api/cards/${form.id}/parent`,
        body: { parentId: null },
      },
    ])
  })
})

describe('Changing the parent from the header', () => {
  const icons = boardCard('14', 'Icon set')

  function formUnderLogin() {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.1.1', 'Form checks', { depth: 2 }),
    )
    const [form, checks] = children as [BoardCard, BoardCard]
    return {
      parent,
      form: { ...form, subtaskProgress: { complete: 0, total: 1 } },
      cards: (formCard: BoardCard) => [
        parent,
        formCard,
        { ...checks, parentId: form.id },
        icons,
      ],
    }
  }

  // Criterion 12 and 44.
  it('changes the parent from the card’s menu with the same picker, and the header shows the new number', async () => {
    const { form, cards } = formUnderLogin()
    const { user, api, container } = open(cards(form), form.id)
    const panel = await cardPanel('WEB-12.1')

    await user.click(cardMenu(panel))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const dialog = await screen.findByRole('dialog', { name: PICKER })
    await search(user, dialog, 'form')
    // Itself and its own subtask are left out; nothing else matches.
    await waitFor(() => expect(api.searches).toEqual(['form']))
    await act(async () => {})
    expect(within(dialog).queryByRole('button', { name: /Form/ })).toBe(null)
    await search(user, dialog, 'icon')
    await expectNoAccessibilityProblems(container)
    await user.click(
      await within(dialog).findByRole('button', { name: /WEB-14 Icon set/ }),
    )

    expect(await cardPanel('WEB-14.1')).toBeInTheDocument()
    expect(
      await within(await cardPanel('WEB-14.1')).findByRole('link', {
        name: 'WEB-14 Icon set',
      }),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([
      {
        request: `PUT /api/cards/${form.id}/parent`,
        body: { parentId: icons.id },
      },
    ])
  })

  it('makes the subtask its own card from the card’s menu', async () => {
    const { form, cards } = formUnderLogin()
    const { user, api } = open(cards(form), form.id)
    const panel = await cardPanel('WEB-12.1')

    await user.click(cardMenu(panel))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Make its own card' }),
    )

    await waitFor(() =>
      expect(api.requests).toEqual([
        {
          request: `PUT /api/cards/${form.id}/parent`,
          body: { parentId: null },
        },
      ]),
    )
    expect(
      await screen.findByRole('complementary', { name: /^Card WEB-\d+$/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Card WEB-12.1' })).toBe(
      null,
    )
  })

  it('has neither item in the menu of a top-level card', async () => {
    const { user } = open([login], login.id)
    const panel = await cardPanel()
    await within(panel).findByRole('region', { name: 'Subtasks' })

    // The menu may be absent, or have other items, but not these two.
    const menus = within(panel).queryAllByRole('button', {
      name: 'Card options',
    })
    for (const menu of menus) {
      await user.click(menu)
      await screen.findByRole('menu')
      expect(
        screen.queryByRole('menuitem', { name: 'Move to another parent' }),
      ).toBe(null)
      expect(
        screen.queryByRole('menuitem', { name: 'Make its own card' }),
      ).toBe(null)
      await user.keyboard('{Escape}')
    }
    // The old plain buttons are gone too.
    expect(within(panel).queryByRole('button', { name: 'Change parent' })).toBe(
      null,
    )
    expect(
      within(panel).queryByRole('button', { name: 'Make its own card' }),
    ).toBe(null)
  })

  it('puts the options menu on the subtask’s card panel', async () => {
    const { form, cards } = formUnderLogin()
    open(cards(form), form.id)
    const panel = await cardPanel('WEB-12.1')

    expect(cardMenu(panel)).toBeInTheDocument()
  })
})

describe('Deleting a card with subtasks: the third choice', () => {
  const icons = boardCard('14', 'Icon set')

  function setup() {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.1.1', 'Form checks', { depth: 2 }),
      boardCard('12.2', 'Errors', { depth: 1 }),
    )
    const [form, checks, errors] = children as [BoardCard, BoardCard, BoardCard]
    const withChild = { ...form, subtaskProgress: { complete: 0, total: 1 } }
    return {
      parent,
      form,
      errors,
      ...open(
        [parent, withChild, { ...checks, parentId: form.id }, errors, icons],
        parent.id,
      ),
    }
  }

  // Criterion 13 and 44.
  it('moves a subtask to another parent, with Delete off until one is chosen', async () => {
    const { user, api, container, form, errors } = setup()
    const panel = await cardPanel()

    await user.click(
      await within(panel).findByRole('button', { name: 'Delete card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    const group = await within(dialog).findByRole('radiogroup', {
      name: 'WEB-12.1 Form',
    })
    await user.click(
      within(group).getByRole('radio', { name: 'Move to another parent' }),
    )

    // Delete is off until the subtask has its new parent.
    const confirm = within(dialog).getByRole('button', { name: 'Delete card' })
    expect(confirm).toBeDisabled()
    // Choosing it opens the picker straight away: no separate button.
    const picker = await screen.findByRole('dialog', { name: PICKER })
    // The deleted card and the subtask's own subtask are not offered.
    await search(user, picker, 'login')
    await waitFor(() => expect(api.searches).toEqual(['login']))
    await act(async () => {})
    expect(within(picker).queryByRole('button', { name: /Login page/ })).toBe(
      null,
    )
    await search(user, picker, 'checks')
    await waitFor(() => expect(api.searches).toEqual(['login', 'checks']))
    await act(async () => {})
    expect(within(picker).queryByRole('button', { name: /Form checks/ })).toBe(
      null,
    )
    await search(user, picker, 'icon')
    await expectNoAccessibilityProblems(container)
    await user.click(
      await within(picker).findByRole('button', { name: /WEB-14 Icon set/ }),
    )

    await waitFor(() => expect(confirm).toBeEnabled())
    // The dialog shows the chosen parent's number.
    expect(dialog).toHaveTextContent('WEB-14')
    await user.click(confirm)

    await waitFor(() =>
      expect(api.requests.map((r) => r.request)).toContain(
        `DELETE /api/cards/${login.id}`,
      ),
    )
    const deletion = api.requests.find((r) => r.request.startsWith('DELETE'))!
    expect(deletion.body).toEqual({
      subtasks: {
        [form.id]: { action: 'move', parentId: icons.id },
        [errors.id]: { action: 'standalone' },
      },
    })
  })
})

describe('Subtasks: what the list shows when things go wrong', () => {
  function twoSubtasks() {
    return family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.2', 'Errors', { depth: 1 }),
    )
  }

  it('shows the error, not “No subtasks yet”, when the list cannot be loaded', async () => {
    const { parent } = twoSubtasks()
    fakeBoard(boardOf(parent))
    server.use(
      http.get('/api/cards/:cardId/subtasks', () =>
        apiError(500, 'Something broke'),
      ),
    )
    renderApp(`${boardPath}?card=${parent.id}`)
    const section = await subtasksOf(await cardPanel())

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Something broke',
    )
    expect(section).not.toHaveTextContent(NO_SUBTASKS)
  })

  it('names the form’s submit button “Add”, next to “Cancel”', async () => {
    const { user } = open([login], login.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(section).getByRole('button', { name: 'Add subtask' }),
    )

    expect(
      within(section).getByRole('button', { name: 'Add' }),
    ).toHaveAttribute('type', 'submit')
    expect(
      within(section).getByRole('button', { name: 'Cancel' }),
    ).toBeInTheDocument()
  })

  // The same rule as checklists (PR 7a): a reload that finishes while another
  // tick is still being saved must not bring back the old state.
  it('keeps the first tick shown while it is still being saved', async () => {
    const { parent, children } = twoSubtasks()
    const [form] = children as [BoardCard, BoardCard]
    const { user } = open([parent, ...children], parent.id)
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post(`/api/cards/${form.id}/complete`, async () => {
        await held
        return HttpResponse.json({ card: form, doneColumnId: null })
      }),
    )
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    )
    await user.click(
      within(await row(section, 'WEB-12.2')).getByRole('checkbox'),
    )
    await waitFor(() => expect(section).toHaveTextContent(OFFER))
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    ).toBeChecked()
    release()
  })

  it('shows the API’s message when “Make its own card” is refused', async () => {
    const { parent, children } = twoSubtasks()
    const { user } = open([parent, ...children], parent.id)
    server.use(
      http.put('/api/cards/:cardId/parent', () =>
        apiError(404, 'Card not found'),
      ),
    )
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Make its own card' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Card not found')
  })

  it('asks “Complete anyway?” when the API says subtasks are still open', async () => {
    const { parent, children } = twoSubtasks()
    const [form] = children as [BoardCard, BoardCard]
    const { user } = open([parent, ...children], parent.id)
    server.use(
      http.post(`/api/cards/${form.id}/complete`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: '1 subtask is still open',
            openSubtasks: 1,
          },
          { status: 409 },
        ),
      ),
    )
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    )

    // Criterion 6.
    expect(
      await screen.findByRole('dialog', { name: 'Complete anyway?' }),
    ).toBeInTheDocument()
  })
})

describe('Deleting a card: the picker leaves out its whole subtree', () => {
  function setup() {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
      boardCard('12.2', 'Errors', { depth: 1 }),
      boardCard('12.2.1', 'Errors detail', { depth: 2 }),
    )
    const [form, errors, detail] = children as [BoardCard, BoardCard, BoardCard]
    const icons = boardCard('14', 'Icon set')
    return open(
      [
        parent,
        form,
        { ...errors, subtaskProgress: { complete: 0, total: 1 } },
        { ...detail, parentId: errors.id },
        icons,
      ],
      parent.id,
    )
  }

  async function openPicker(user: ReturnType<typeof renderApp>['user']) {
    await user.click(
      await within(await cardPanel()).findByRole('button', {
        name: 'Delete card',
      }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    const group = await within(dialog).findByRole('radiogroup', {
      name: 'WEB-12.1 Form',
    })
    const radio = within(group).getByRole('radio', {
      name: 'Move to another parent',
    })
    await user.click(radio)
    return {
      dialog,
      radio,
      picker: await screen.findByRole('dialog', { name: PICKER }),
    }
  }

  // Decision 1 (2026-11-07).
  it('does not offer another subtask of the card being deleted, nor its subtasks', async () => {
    const { user, api } = setup()
    const { picker } = await openPicker(user)

    // Both cards match "errors"; neither may be offered.
    await search(user, picker, 'errors')
    await waitFor(() => expect(api.searches).toEqual(['errors']))
    expect(await within(picker).findByRole('status')).toHaveTextContent(
      'No cards found',
    )
    expect(within(picker).queryByRole('button', { name: /Errors/ })).toBe(null)
  })

  // Decision 2.
  it('closes only the picker on Escape, and focus goes back to “Move to another parent”', async () => {
    const { user } = setup()
    const { dialog, radio, picker } = await openPicker(user)
    within(picker).getByLabelText('Find a card').focus()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(
      screen.getByRole('dialog', { name: 'Delete WEB-12?' }),
    ).toBeInTheDocument()
    expect(dialog).toContainElement(radio)
    expect(radio).toHaveFocus()
  })

  it('gives focus back to “Move to another parent” on Cancel and after a pick', async () => {
    const { user } = setup()
    const first = await openPicker(user)
    await user.click(
      within(first.picker).getByRole('button', { name: 'Cancel' }),
    )
    await waitFor(() => expect(first.picker).not.toBeInTheDocument())
    expect(first.radio).toHaveFocus()

    // Open it again (choose another option, then this one).
    const group = within(first.dialog).getByRole('radiogroup', {
      name: 'WEB-12.1 Form',
    })
    await user.click(within(group).getByRole('radio', { name: 'Delete' }))
    await user.click(
      within(group).getByRole('radio', { name: 'Move to another parent' }),
    )
    const picker = await screen.findByRole('dialog', { name: PICKER })
    await search(user, picker, 'icon')
    await user.click(
      await within(picker).findByRole('button', { name: /WEB-14 Icon set/ }),
    )
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(
      within(group).getByRole('radio', { name: 'Move to another parent' }),
    ).toHaveFocus()
  })
})

describe('Where focus goes when a card picker closes', () => {
  function setup() {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
    )
    return {
      parent,
      ...open([parent, ...children], parent.id),
    }
  }

  // Decision 2: back to the "Options for <number>" button.
  it('goes back to the subtask row’s options button on Escape and on Cancel', async () => {
    const { user } = setup()
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    let picker = await screen.findByRole('dialog', { name: PICKER })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(
      within(section).getByRole('button', { name: 'Options for WEB-12.1' }),
    ).toHaveFocus()

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    picker = await screen.findByRole('dialog', { name: PICKER })
    await user.click(within(picker).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(
      within(section).getByRole('button', { name: 'Options for WEB-12.1' }),
    ).toHaveFocus()
  })

  it('goes back to “Card options” on Escape and on Cancel', async () => {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
    )
    const [form] = children as [BoardCard]
    const { user } = open([parent, form], form.id)
    const panel = await cardPanel('WEB-12.1')

    await user.click(cardMenu(panel))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    let picker = await screen.findByRole('dialog', { name: PICKER })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(cardMenu(panel)).toHaveFocus()

    await user.click(cardMenu(panel))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    picker = await screen.findByRole('dialog', { name: PICKER })
    await user.click(within(picker).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(cardMenu(panel)).toHaveFocus()
  })
})

describe('The picker and the 5 level limit', () => {
  // Decision 3: a leaf subtask can go under a card at depth 3 at most.
  it('shows cards too deep for the subtask, turned off and saying why', async () => {
    const { parent, children } = family(
      login,
      boardCard('12.1', 'Form', { depth: 1 }),
    )
    const chain = [
      boardCard('20', 'Chain a'),
      boardCard('20.1', 'Chain b'),
      boardCard('20.1.1', 'Chain c'),
      boardCard('20.1.1.1', 'Chain d'),
      boardCard('20.1.1.1.1', 'Chain e'),
    ]
    const linked = chain.map((card, i) => ({
      ...card,
      parentId: i === 0 ? null : chain[i - 1]!.id,
    }))
    const { user, api } = open([parent, ...children, ...linked], parent.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const dialog = await screen.findByRole('dialog', { name: PICKER })
    await search(user, dialog, 'chain')
    await waitFor(() => expect(api.searches).toEqual(['chain']))

    const tooDeep = await within(dialog).findByRole('button', {
      name: /WEB-20\.1\.1\.1\.1 Chain e/,
    })
    expectTurnedOff(tooDeep)
    expect(tooDeep).toHaveAccessibleDescription(
      expect.stringContaining(TOO_DEEP),
    )
    const fine = within(dialog).getByRole('button', {
      name: /WEB-20\.1\.1\.1 Chain d/,
    })
    expect(fine).toBeEnabled()
    expect(fine).not.toHaveAccessibleDescription(
      expect.stringContaining(TOO_DEEP),
    )
  })
})

// Regression tests for breaks found in review of web PR 7b.

function twoOpenSubtasks() {
  const form = boardCard('12.1', 'Form', { depth: 1, parentId: login.id })
  const errors = boardCard('12.2', 'Errors', { depth: 1, parentId: login.id })
  const parent = { ...login, subtaskProgress: { complete: 0, total: 2 } }
  return { parent, form, errors }
}

// A request that waits until `release` is called.
function held() {
  let release: () => void = () => {}
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}

describe('Subtasks: ticks and the 30 second reload', () => {
  it('still reloads every 30 seconds after a quick tick and untick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors], parent.id)
      const gate = held()
      const gate2 = held()
      server.use(
        http.post(`/api/cards/${form.id}/complete`, async () => {
          await gate.promise
          return undefined
        }),
        http.post(`/api/cards/${form.id}/reopen`, async () => {
          await gate2.promise
          return undefined
        }),
      )
      const section = await subtasksOf(await cardPanel())
      const box = within(await row(section, 'WEB-12.1')).getByRole('checkbox')
      await user.click(box)
      await user.click(box)
      gate.release()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      gate2.release()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(box).not.toBeChecked()

      // Someone else renames the other subtask on the server.
      server.use(
        http.get(`/api/cards/${parent.id}/subtasks`, () =>
          HttpResponse.json({
            subtasks: [form, { ...errors, title: 'Errors renamed' }].map(
              (c) => ({ ...c, columnName: 'To do', boardName: 'Website' }),
            ),
            progress: { complete: 0, total: 2 },
          }),
        ),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_RELOAD_MS + 1000)
      })
      await vi.waitFor(
        () => expect(section).toHaveTextContent('Errors renamed'),
        { timeout: 3000 },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  // Another change's reload must not undo a tick that is still saving.
  it('keeps a tick shown while a Move to Done reload finishes', async () => {
    const { parent, form, errors } = twoOpenSubtasks()
    const { user } = open([parent, form, errors], parent.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(
      within(await row(section, 'WEB-12.1')).getByRole('checkbox'),
    )
    await waitFor(() => expect(section).toHaveTextContent(OFFER))

    const moveGate = held()
    const tickGate = held()
    server.use(
      http.post(`/api/cards/${form.id}/move`, async () => {
        await moveGate.promise
        return undefined
      }),
      http.post(`/api/cards/${errors.id}/complete`, async () => {
        await tickGate.promise
        return undefined
      }),
    )
    await user.click(within(section).getByRole('button', { name: OFFER_MOVE }))
    const errorsBox = within(await row(section, 'WEB-12.2')).getByRole(
      'checkbox',
    )
    await user.click(errorsBox)
    expect(errorsBox).toBeChecked()
    moveGate.release()
    await new Promise((resolve) => setTimeout(resolve, 300))

    const now = within(await row(section, 'WEB-12.2')).getByRole('checkbox')
    try {
      expect(now).toBeChecked()
    } finally {
      tickGate.release()
    }
  })
})

describe('Deleting a card: when its relatives cannot be loaded', () => {
  it('says why when choosing Move to another parent', async () => {
    const { parent, form, errors } = twoOpenSubtasks()
    const { user } = open([parent, form, errors], parent.id)
    server.use(
      http.get(`/api/cards/${parent.id}/relatives`, () =>
        apiError(500, 'Something broke'),
      ),
    )
    await user.click(
      await within(await cardPanel()).findByRole('button', {
        name: 'Delete card',
      }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    const group = await within(dialog).findByRole('radiogroup', {
      name: 'WEB-12.1 Form',
    })
    await user.click(within(group).getByRole('radio', { name: PICKER }))

    expect(
      await within(dialog).findByRole('alert', undefined, { timeout: 3000 }),
    ).toHaveTextContent('Something broke')
  })
})

describe('The card’s own Complete box', () => {
  // Criterion 6: the board's progress was out of date, so the card looked
  // like it had no open subtasks and the API said otherwise.
  it('asks “Complete anyway?” when the API says subtasks are still open', async () => {
    const { user, api } = open([login], login.id)
    server.use(
      http.post(
        `/api/cards/${login.id}/complete`,
        () =>
          HttpResponse.json(
            {
              statusCode: 409,
              message: '2 subtasks are still open',
              openSubtasks: 2,
            },
            { status: 409 },
          ),
        { once: true },
      ),
    )
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('checkbox', { name: 'Complete' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Complete anyway?',
    })
    expect(dialog).toHaveTextContent('2 subtasks are still open.')
    await user.click(
      within(dialog).getByRole('button', { name: 'Complete anyway' }),
    )

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]).toMatchObject({
      request: `POST /api/cards/${login.id}/complete`,
      body: { confirmOpenSubtasks: true },
    })
  })
})

describe('Subtasks: where focus goes when a row goes away', () => {
  // Owner's decision, 2026-11-07: focus goes to the Subtasks heading only
  // after the person's own “Make its own card” or “Move to another parent”
  // on that row succeeds.
  it('puts focus on the Subtasks heading after “Make its own card” on a row succeeds', async () => {
    const { parent, form, errors } = twoOpenSubtasks()
    const { user } = open([parent, form, errors], parent.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Make its own card' }),
    )

    await waitFor(() =>
      expect(within(section).queryByText(/WEB-12\.1/)).toBe(null),
    )
    expect(
      within(section).getByRole('heading', { name: 'Subtasks' }),
    ).toHaveFocus()
  })

  it('does not steal focus when a row goes away after its picker was cancelled', async () => {
    const { parent, form, errors } = twoOpenSubtasks()
    const { user } = open([parent, form, errors], parent.id)
    const section = await subtasksOf(await cardPanel())

    // Open the picker for WEB-12.1, then cancel it.
    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const picker = await screen.findByRole('dialog', { name: PICKER })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(picker).not.toBeInTheDocument())

    // Someone else moves WEB-12.1 away; the next reload drops its row.
    server.use(
      http.get(`/api/cards/${parent.id}/subtasks`, () =>
        HttpResponse.json({
          subtasks: [{ ...errors, columnName: 'To do', boardName: 'Website' }],
          progress: { complete: 0, total: 1 },
        }),
      ),
    )
    // Ticking WEB-12.2 reloads the list.
    const errorsBox = within(await row(section, 'WEB-12.2')).getByRole(
      'checkbox',
    )
    errorsBox.focus()
    await user.keyboard(' ')
    expect(errorsBox).toBeChecked()
    await waitFor(() =>
      expect(within(section).queryByText(/WEB-12\.1/)).toBe(null),
    )

    expect(errorsBox).toHaveFocus()
  })
})

describe('Subtasks: focus when a reload removes the row mid-save', () => {
  // Owner's decisions, 2026-11-07 (antagonist round 4): the picker never
  // offers the subtask's current parent; and if a reload removes the row
  // while the person's own move or “Make its own card” is still saving,
  // focus still goes to the Subtasks heading when the request succeeds, and
  // does not when it fails.
  const icons = boardCard('14', 'Icon set')

  // The list as another person's change leaves it: WEB-12.1 is gone.
  function onlyErrors(parent: BoardCard, errors: BoardCard) {
    return http.get(`/api/cards/${parent.id}/subtasks`, () =>
      HttpResponse.json({
        subtasks: [{ ...errors, columnName: 'To do', boardName: 'Website' }],
        progress: { complete: 0, total: 1 },
      }),
    )
  }

  // Lets the 30 second reload run and waits until the row is gone.
  async function reloadDropsRow(section: HTMLElement) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_RELOAD_MS + 1000)
    })
    await vi.waitFor(
      () => expect(within(section).queryByText(/WEB-12\.1/)).toBe(null),
      { timeout: 3000 },
    )
  }

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
  }

  it('does not offer the subtask’s current parent in the picker from its row', async () => {
    const { parent, form, errors } = twoOpenSubtasks()
    const { user, api } = open([parent, form, errors, icons], parent.id)
    const section = await subtasksOf(await cardPanel())

    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const picker = await screen.findByRole('dialog', { name: PICKER })
    await search(user, picker, 'login')

    await waitFor(() => expect(api.searches).toEqual(['login']))
    expect(await within(picker).findByRole('status')).toHaveTextContent(
      'No cards found',
    )
    expect(
      within(picker).queryByRole('button', { name: /WEB-12 Login page/ }),
    ).toBe(null)
  })

  it('does not offer the card’s current parent in the picker from Card options', async () => {
    const { parent, form, errors } = twoOpenSubtasks()
    const { user, api } = open([parent, form, errors, icons], form.id)
    const panel = await cardPanel('WEB-12.1')

    await user.click(cardMenu(panel))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const picker = await screen.findByRole('dialog', { name: PICKER })
    await search(user, picker, 'login')

    await waitFor(() => expect(api.searches).toEqual(['login']))
    expect(await within(picker).findByRole('status')).toHaveTextContent(
      'No cards found',
    )
    expect(
      within(picker).queryByRole('button', { name: /WEB-12 Login page/ }),
    ).toBe(null)
  })

  it('a reload that drops the row before “Make its own card” answers still sends focus to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return HttpResponse.json({ ...form, parentId: null })
        }),
      )
      const section = await subtasksOf(await cardPanel())
      await user.click(rowMenu(await row(section, 'WEB-12.1')))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Make its own card' }),
      )
      // The server has saved it; the reload lands before the answer.
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      gate.release()
      await settle()

      expect(
        within(section).getByRole('heading', { name: 'Subtasks' }),
      ).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a reload that drops the row before a picked move answers still sends focus to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors, icons], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return HttpResponse.json({ ...form, parentId: icons.id })
        }),
      )
      const section = await subtasksOf(await cardPanel())
      await user.click(rowMenu(await row(section, 'WEB-12.1')))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Move to another parent' }),
      )
      const picker = await screen.findByRole('dialog', { name: PICKER })
      await search(user, picker, 'icon')
      await user.click(
        await within(picker).findByRole('button', { name: /WEB-14 Icon set/ }),
      )
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      gate.release()
      await settle()

      await vi.waitFor(() => expect(picker).not.toBeInTheDocument())
      expect(
        within(section).getByRole('heading', { name: 'Subtasks' }),
      ).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not move focus to the heading when “Make its own card” fails after a reload dropped the row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return apiError(500, 'Something went wrong')
        }),
      )
      const section = await subtasksOf(await cardPanel())
      await user.click(rowMenu(await row(section, 'WEB-12.1')))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Make its own card' }),
      )
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      gate.release()
      await settle()

      expect(
        within(section).getByRole('heading', { name: 'Subtasks' }),
      ).not.toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not move focus to the heading when a picked move fails after a reload dropped the row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors, icons], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return apiError(409, TOO_DEEP)
        }),
      )
      const section = await subtasksOf(await cardPanel())
      await user.click(rowMenu(await row(section, 'WEB-12.1')))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Move to another parent' }),
      )
      const picker = await screen.findByRole('dialog', { name: PICKER })
      await search(user, picker, 'icon')
      await user.click(
        await within(picker).findByRole('button', { name: /WEB-14 Icon set/ }),
      )
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      gate.release()
      await settle()

      expect(
        within(section).getByRole('heading', { name: 'Subtasks' }),
      ).not.toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  // Owner's decisions, 2026-11-07 (antagonist round 5): when the move then
  // succeeds, focus goes to the heading only if it is on nothing; and a
  // failed picked move still shows in the panel's message area.
  async function pickIcons(
    user: ReturnType<typeof renderApp>['user'],
    section: HTMLElement,
  ) {
    await user.click(rowMenu(await row(section, 'WEB-12.1')))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to another parent' }),
    )
    const picker = await screen.findByRole('dialog', { name: PICKER })
    await search(user, picker, 'icon')
    await user.click(
      await within(picker).findByRole('button', { name: /WEB-14 Icon set/ }),
    )
    return picker
  }

  async function focusDescriptionEditor(
    user: ReturnType<typeof renderApp>['user'],
    panel: HTMLElement,
  ) {
    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    editor.focus()
    expect(editor).toHaveFocus()
    return editor
  }

  it('keeps focus in the description editor when “Make its own card” succeeds after a reload dropped the row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return HttpResponse.json({ ...form, parentId: null })
        }),
      )
      const panel = await cardPanel()
      const section = await subtasksOf(panel)
      await user.click(rowMenu(await row(section, 'WEB-12.1')))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Make its own card' }),
      )
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      const editor = await focusDescriptionEditor(user, panel)
      gate.release()
      await settle()

      expect(editor).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps focus in the description editor when a picked move succeeds after a reload dropped the row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors, icons], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return HttpResponse.json({ ...form, parentId: icons.id })
        }),
      )
      const panel = await cardPanel()
      const section = await subtasksOf(panel)
      await pickIcons(user, section)
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      const editor = await focusDescriptionEditor(user, panel)
      gate.release()
      await settle()

      expect(editor).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows in the panel that a picked move failed after a reload closed the picker', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors, icons], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return apiError(500, 'Something broke')
        }),
      )
      const section = await subtasksOf(await cardPanel())
      await pickIcons(user, section)
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      gate.release()
      await settle()

      expect(await screen.findByText(SAVE_FAILED)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the server’s words when a picked move is refused after a reload closed the picker', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { parent, form, errors } = twoOpenSubtasks()
      const { user } = open([parent, form, errors, icons], parent.id)
      const gate = held()
      server.use(
        http.put(`/api/cards/${form.id}/parent`, async () => {
          await gate.promise
          return apiError(409, TOO_DEEP)
        }),
      )
      const section = await subtasksOf(await cardPanel())
      await pickIcons(user, section)
      server.use(onlyErrors(parent, errors))
      await reloadDropsRow(section)
      gate.release()
      await settle()

      expect(await screen.findByText(TOO_DEEP)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
