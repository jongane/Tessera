import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { BOARD_RELOAD_MS } from '../api/query-keys'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { cardPanel, login, openCard, typeInto } from '../test/card-panel'
import { checklist, itemOf } from '../test/fake-checklists'
import { boardCard } from '../test/fixtures'
import { apiError, server } from '../test/server'

// Web PR 7a: checklists in the card panel, under the description
// (acceptance criteria 14 to 24 and 44; docs/card-features.md, section 2).

// One checklist in the panel, found by its name.
function findChecklist(panel: HTMLElement, name: string) {
  return within(panel).findByRole('region', { name })
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The button that opens the menu for an item or a checklist: a menu
// button whose name mentions it.
function menuButton(scope: HTMLElement, name: string) {
  const buttons = within(scope)
    .getAllByRole('button', { name: new RegExp(escape(name)) })
    .filter((button) => button.getAttribute('aria-haspopup') === 'menu')
  expect(buttons, `one menu button for “${name}”`).toHaveLength(1)
  return buttons[0]!
}

// The handle that picks an item up to drag it.
function dragHandle(scope: HTMLElement, text: string) {
  const handles = within(scope)
    .getAllByRole('button', { name: new RegExp(escape(text)) })
    .filter(
      (button) => button.getAttribute('aria-roledescription') === 'sortable',
    )
  expect(handles, `one drag handle for “${text}”`).toHaveLength(1)
  return handles[0]!
}

// Turned off, as a button or as a menu item.
function expectTurnedOff(element: HTMLElement) {
  expect(
    element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true',
  ).toBe(true)
}

function expectTurnedOn(element: HTMLElement) {
  expect(
    element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true',
  ).toBe(false)
}

// The items' tick boxes are in this order, and there are no others.
function expectItems(scope: HTMLElement, names: string[]) {
  const boxes = within(scope).getAllByRole('checkbox')
  expect(boxes).toHaveLength(names.length)
  names.forEach((name, i) => {
    expect(within(scope).getByRole('checkbox', { name })).toBe(boxes[i])
  })
}

// `first` comes before `second` on the page.
function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
}

const SAVE_FAILED = 'Couldn’t save, try again'

describe('Seeing a card’s checklists', () => {
  // Criteria 14 and 44.
  it('shows each checklist with its name, its own progress and its items as tick boxes', async () => {
    const testing = checklist('Testing', [
      ['Chrome', true],
      ['Firefox', true],
      'Safari',
      'Edge',
    ])
    const release = checklist('Release', ['Tag the build'])
    const { container } = openCard(login, {
      checklists: { [login.id]: [testing, release] },
    })
    const panel = await cardPanel()

    const first = await findChecklist(panel, 'Testing')
    expect(
      within(first).getByRole('heading', { name: 'Testing' }),
    ).toBeInTheDocument()
    expect(first).toHaveTextContent('2 of 4')
    expectItems(first, ['Chrome', 'Firefox', 'Safari', 'Edge'])
    expect(
      within(first).getByRole('checkbox', { name: 'Chrome' }),
    ).toBeChecked()
    expect(
      within(first).getByRole('checkbox', { name: 'Safari' }),
    ).not.toBeChecked()

    const second = await findChecklist(panel, 'Release')
    expect(second).toHaveTextContent('0 of 1')
    expectItems(second, ['Tag the build'])
    expectBefore(first, second)
    // Under the description (plan, section 2).
    expectBefore(
      await within(panel).findByRole('button', { name: 'Edit description' }),
      first,
    )
    await expectNoAccessibilityProblems(container)
  })

  // Changes reload with the board every 30 seconds: someone else ticks an
  // item, and after the reload this panel shows it.
  it('reloads with the board every 30 seconds and shows another person’s tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const testing = checklist('Testing', ['Safari'])
      openCard(login, { checklists: { [login.id]: [testing] } })
      const panel = await cardPanel()
      const box = await within(panel).findByRole('checkbox', {
        name: 'Safari',
      })
      expect(box).not.toBeChecked()

      // Another person ticks it on the server.
      server.use(
        http.get('/api/cards/:cardId/checklists', () =>
          HttpResponse.json([
            {
              ...testing,
              cardId: login.id,
              items: testing.items.map((i) => ({ ...i, isDone: true })),
              progress: { done: 1, total: 1 },
            },
          ]),
        ),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_RELOAD_MS + 1000)
      })
      await vi.waitFor(
        () =>
          expect(
            within(panel).getByRole('checkbox', { name: 'Safari' }),
          ).toBeChecked(),
        { timeout: 3000 },
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Adding checklists', () => {
  // Criteria 15 and 44.
  it('asks for a name, refuses one over 100 characters or blank, and adds the checklist', async () => {
    const { user, api, container } = openCard()
    const panel = await cardPanel()

    await user.click(
      within(panel).getByRole('button', { name: 'Add checklist' }),
    )
    const name = within(panel).getByRole('textbox', { name: 'Checklist name' })
    name.focus()
    await user.paste('x'.repeat(101))
    await user.keyboard('{Enter}')
    expect(
      await within(panel).findByText('Use at most 100 characters'),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([])
    await expectNoAccessibilityProblems(container)

    // Jon, 2026-11-03: spaces only is refused by the shared rule.
    await user.clear(name)
    await typeInto(user, name, '   {Enter}')
    expect(await within(panel).findByText("Can't be blank")).toBeInTheDocument()
    expect(api.requests).toEqual([])

    await user.clear(name)
    await typeInto(user, name, 'Release{Enter}')

    expect(await findChecklist(panel, 'Release')).toBeInTheDocument()
    expect(api.requests).toEqual([
      {
        request: `POST /api/cards/${login.id}/checklists`,
        body: { name: 'Release' },
      },
    ])
    // Only the 11th checklist suggests a new card (criterion 24).
    expect(within(panel).queryByText(/a lot of checklists/)).toBe(null)
  })

  // Criteria 24 and 44.
  it('suggests a new card when the card has a lot of checklists, and still adds it', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => checklist(`List ${i + 1}`))
    const { user, api, container } = openCard(login, {
      checklists: { [login.id]: ten },
    })
    const panel = await cardPanel()
    await findChecklist(panel, 'List 10')

    await user.click(
      within(panel).getByRole('button', { name: 'Add checklist' }),
    )
    await typeInto(
      user,
      within(panel).getByRole('textbox', { name: 'Checklist name' }),
      'Eleventh{Enter}',
    )

    expect(
      await within(panel).findByText(
        'This card has a lot of checklists. Would a new card be clearer?',
      ),
    ).toBeInTheDocument()
    expect(await findChecklist(panel, 'Eleventh')).toBeInTheDocument()
    expect(api.requests.map((r) => r.request)).toEqual([
      `POST /api/cards/${login.id}/checklists`,
    ])
    await expectNoAccessibilityProblems(container)

    // Jon, 2026-11-03: the shortcut opens the board's Add card form in
    // this card's column.
    await user.click(
      within(panel).getByRole('button', { name: 'Create a card' }),
    )
    const column = screen.getByRole('region', { name: 'To do' })
    expect(
      await within(column).findByRole('textbox', { name: 'Card title' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Done' })).queryByRole(
        'textbox',
        { name: 'Card title' },
      ),
    ).toBe(null)
  })

  // Escape in the Add checklist form cancels the form only.
  it('closes the Add checklist form on Escape from its Cancel button, not the panel', async () => {
    const { user } = openCard(login)
    const panel = await cardPanel()
    await user.click(
      within(panel).getByRole('button', { name: 'Add checklist' }),
    )
    within(panel).getByRole('button', { name: 'Cancel' }).focus()
    await user.keyboard('{Escape}')

    expect(
      screen.getByRole('complementary', { name: 'Card WEB-12' }),
    ).toBeInTheDocument()
  })
})

describe('Adding items', () => {
  // Criterion 16.
  it('adds an item on Enter, clears the box and keeps it ready for the next', async () => {
    const testing = checklist('Testing', ['Chrome'])
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const list = await findChecklist(await cardPanel(), 'Testing')

    await user.click(within(list).getByRole('button', { name: 'Add item' }))
    const box = within(list).getByRole('textbox', { name: 'New item' })
    await typeInto(user, box, 'Safari{Enter}')

    expect(
      await within(list).findByRole('checkbox', { name: 'Safari' }),
    ).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(list).toHaveTextContent('0 of 2')
    expect(api.requests).toEqual([
      {
        request: `POST /api/checklists/${testing.id}/items`,
        body: { text: 'Safari' },
      },
    ])
  })

  // Criterion 16.
  it('refuses a blank item and one over 500 characters, and sends nothing', async () => {
    const testing = checklist('Testing', ['Chrome'])
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const list = await findChecklist(await cardPanel(), 'Testing')

    await user.click(within(list).getByRole('button', { name: 'Add item' }))
    const box = within(list).getByRole('textbox', { name: 'New item' })
    await typeInto(user, box, '   {Enter}')
    // Jon, 2026-11-03: the shared rule's message.
    expect(await within(list).findByText("Can't be blank")).toBeInTheDocument()
    expect(api.requests).toEqual([])
    await user.clear(box)
    box.focus()
    await user.paste('x'.repeat(501))
    await user.keyboard('{Enter}')

    expect(
      await within(list).findByText('Use at most 500 characters'),
    ).toBeInTheDocument()
    expectItems(list, ['Chrome'])
    expect(api.requests).toEqual([])
  })

  // Criteria 23 and 44.
  it('turns Add item off at 100 items, and says why', async () => {
    const full = checklist(
      'Browsers',
      Array.from({ length: 100 }, (_, i) => `Browser ${i + 1}`),
    )
    const { container } = openCard(login, {
      checklists: { [login.id]: [full] },
    })
    const list = await findChecklist(await cardPanel(), 'Browsers')

    const add = within(list).getByRole('button', { name: 'Add item' })
    expectTurnedOff(add)
    expect(add).toHaveAccessibleDescription('A checklist holds up to 100 items')
    await expectNoAccessibilityProblems(container)
  })

  // Criterion 23: one fewer is still allowed.
  it('keeps Add item on at 99 items', async () => {
    const almost = checklist(
      'Browsers',
      Array.from({ length: 99 }, (_, i) => `Browser ${i + 1}`),
    )
    openCard(login, { checklists: { [login.id]: [almost] } })
    const list = await findChecklist(await cardPanel(), 'Browsers')

    expectTurnedOn(within(list).getByRole('button', { name: 'Add item' }))
  })

  // Escape in the Add item form cancels the form only.
  // Escape in the Add item form cancels the form; it does not also close
  // the whole card panel.
  it('closes the Add item form on Escape from its Add button, not the panel', async () => {
    const testing = checklist('Testing', ['Safari'])
    const { user } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const panel = await cardPanel()
    await user.click(
      await within(panel).findByRole('button', { name: 'Add item' }),
    )
    const box = within(panel).getByRole('textbox', { name: 'New item' })
    await typeInto(user, box, 'Edge')
    within(panel).getByRole('button', { name: 'Add' }).focus()
    await user.keyboard('{Escape}')

    expect(
      screen.getByRole('complementary', { name: 'Card WEB-12' }),
    ).toBeInTheDocument()
  })

  // Criterion 23: the box closes when the list fills up, and stays closed
  // when room appears again.
  it('closes the New item box at 100 items and keeps it closed after an item is deleted', async () => {
    const almost = checklist(
      'Browsers',
      Array.from({ length: 99 }, (_, i) => `Browser ${i + 1}`),
    )
    const { user } = openCard(login, { checklists: { [login.id]: [almost] } })
    const list = await findChecklist(await cardPanel(), 'Browsers')

    await user.click(within(list).getByRole('button', { name: 'Add item' }))
    const box = within(list).getByRole('textbox', { name: 'New item' })
    await typeInto(user, box, 'Browser 100{Enter}')
    await within(list).findByRole('checkbox', { name: 'Browser 100' })
    await waitFor(() =>
      expect(within(list).queryByRole('textbox', { name: 'New item' })).toBe(
        null,
      ),
    )

    await user.click(menuButton(list, 'Browser 100'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() =>
      expect(
        within(list).queryByRole('checkbox', { name: 'Browser 100' }),
      ).toBe(null),
    )
    expect(within(list).queryByRole('textbox', { name: 'New item' })).toBe(null)
    expectTurnedOn(within(list).getByRole('button', { name: 'Add item' }))
  })
})

describe('Editing an item', () => {
  // Criteria 17 and 44.
  it('edits an item’s text when it is clicked: Escape puts it back, Enter saves', async () => {
    const testing = checklist('Testing', ['Safari', 'Edge'])
    const { user, api, container } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const panel = await cardPanel()
    const list = await findChecklist(panel, 'Testing')

    await user.click(within(list).getByRole('button', { name: 'Safari' }))
    let box = within(list).getByDisplayValue('Safari')
    await expectNoAccessibilityProblems(container)
    await user.clear(box)
    await typeInto(user, box, 'Safari 17{Escape}')

    expect(
      within(list).getByRole('button', { name: 'Safari' }),
    ).toBeInTheDocument()
    expect(within(list).queryByDisplayValue('Safari 17')).toBe(null)
    // Escape in the box does not close the panel.
    expect(panel).toBeInTheDocument()
    expect(api.requests).toEqual([])

    await user.click(within(list).getByRole('button', { name: 'Safari' }))
    box = within(list).getByDisplayValue('Safari')
    await user.clear(box)
    await typeInto(user, box, 'Safari 17{Enter}')

    expect(
      await within(list).findByRole('checkbox', { name: 'Safari 17' }),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([
      {
        request: `PATCH /api/checklist-items/${itemOf(testing, 'Safari').id}`,
        body: { text: 'Safari 17' },
      },
    ])
  })
})

describe('Ticking items', () => {
  // Criterion 18.
  it('ticks and unticks an item, and updates the progress', async () => {
    const testing = checklist('Testing', [['Chrome', true], 'Safari'])
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const list = await findChecklist(await cardPanel(), 'Testing')
    const safari = within(list).getByRole('checkbox', { name: 'Safari' })

    await user.click(safari)
    await waitFor(() => expect(safari).toBeChecked())
    expect(list).toHaveTextContent('2 of 2')
    await waitFor(() => expect(api.requests).toHaveLength(1))
    await user.click(safari)
    await waitFor(() => expect(safari).not.toBeChecked())
    expect(list).toHaveTextContent('1 of 2')

    await waitFor(() => expect(api.requests).toHaveLength(2))
    const safariId = itemOf(testing, 'Safari').id
    expect(api.requests).toEqual([
      {
        request: `PATCH /api/checklist-items/${safariId}`,
        body: { isDone: true },
      },
      {
        request: `PATCH /api/checklist-items/${safariId}`,
        body: { isDone: false },
      },
    ])
  })

  // Criterion 18 (docs/web-app.md, section 5).
  it('shows the tick straight away, and undoes it when it cannot be saved', async () => {
    const testing = checklist('Testing', [['Chrome', true], 'Safari'])
    const { user } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    let answer = () => {}
    const answered = new Promise<void>((resolve) => (answer = resolve))
    server.use(
      http.patch('/api/checklist-items/:itemId', async () => {
        await answered
        return apiError(500, 'Broken')
      }),
    )
    const panel = await cardPanel()
    const list = await findChecklist(panel, 'Testing')
    const safari = within(list).getByRole('checkbox', { name: 'Safari' })

    await user.click(safari)

    // Before the API has answered.
    await waitFor(() => expect(safari).toBeChecked())
    expect(list).toHaveTextContent('2 of 2')
    answer()
    expect(await within(panel).findByText(SAVE_FAILED)).toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(list).getByRole('checkbox', { name: 'Safari' }),
      ).not.toBeChecked(),
    )
    expect(list).toHaveTextContent('1 of 2')
  })
})

describe('The item menu', () => {
  // Criteria 19 and 44.
  it('moves an item up and down, with the ends turned off', async () => {
    const testing = checklist('Testing', ['Chrome', 'Firefox', 'Safari'])
    const { user, api, container } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const list = await findChecklist(await cardPanel(), 'Testing')

    await user.click(menuButton(list, 'Chrome'))
    expectTurnedOff(await screen.findByRole('menuitem', { name: 'Move up' }))
    expectTurnedOn(screen.getByRole('menuitem', { name: 'Move down' }))
    await expectNoAccessibilityProblems(container)
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    await waitFor(() => expectItems(list, ['Firefox', 'Chrome', 'Safari']))

    await user.click(menuButton(list, 'Safari'))
    expectTurnedOff(await screen.findByRole('menuitem', { name: 'Move down' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }))
    await waitFor(() => expectItems(list, ['Firefox', 'Safari', 'Chrome']))

    await waitFor(() => expect(api.requests).toHaveLength(2))
    expect(api.requests).toEqual([
      {
        request: `PATCH /api/checklist-items/${itemOf(testing, 'Chrome').id}`,
        body: { position: 1 },
      },
      {
        request: `PATCH /api/checklist-items/${itemOf(testing, 'Safari').id}`,
        body: { position: 1 },
      },
    ])
  })

  // Criterion 19.
  it('deletes an item', async () => {
    const testing = checklist('Testing', ['Chrome', 'Firefox'])
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const list = await findChecklist(await cardPanel(), 'Testing')

    await user.click(menuButton(list, 'Firefox'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    await waitFor(() => expectItems(list, ['Chrome']))
    expect(list).toHaveTextContent('0 of 1')
    expect(api.requests.map((r) => r.request)).toEqual([
      `DELETE /api/checklist-items/${itemOf(testing, 'Firefox').id}`,
    ])
  })

  // Criterion 21. That the subtask shows in the Subtasks section comes
  // with PR 7b.
  it('turns an item into a subtask: the item leaves and the board shows the subtask', async () => {
    const testing = checklist('Testing', ['Write tests', 'Deploy'])
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const list = await findChecklist(await cardPanel(), 'Testing')

    await user.click(menuButton(list, 'Write tests'))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Turn into subtask' }),
    )

    await waitFor(() => expectItems(list, ['Deploy']))
    expect(
      await screen.findByRole('button', { name: 'WEB-12.1 Write tests' }),
    ).toBeInTheDocument()
    expect(api.requests.map((r) => r.request)).toEqual([
      `POST /api/checklist-items/${itemOf(testing, 'Write tests').id}/subtask`,
    ])
  })

  // Criteria 21 and 44. Jon, 2026-11-03: turned off at depth 4, with the
  // reason.
  it('turns “Turn into subtask” off on a card 5 levels deep, and says why', async () => {
    const deep = boardCard('12.1.1.1.1', 'Deep card')
    const testing = checklist('Testing', ['Write tests'])
    const { user, api, container } = openCard(deep, {
      checklists: { [deep.id]: [testing] },
    })
    const list = await findChecklist(
      await cardPanel('WEB-12.1.1.1.1'),
      'Testing',
    )

    await user.click(menuButton(list, 'Write tests'))
    const turn = await screen.findByRole('menuitem', {
      name: 'Turn into subtask',
    })

    expectTurnedOff(turn)
    expect(turn).toHaveAccessibleDescription(
      'Subtasks can only go 5 levels deep',
    )
    await expectNoAccessibilityProblems(container)
    expect(api.requests).toEqual([])
  })
})

describe('Dragging items', () => {
  // jsdom lays nothing out, so every element is given its own place, one
  // under the other in page order, for the drag to find the next item.
  function layOutInPageOrder() {
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const index = Array.from(document.querySelectorAll('*')).indexOf(this)
        return new DOMRect(0, index * 40, 300, 30)
      })
    onTestFinished(() => spy.mockRestore())
  }

  // Criterion 20.
  it('reorders an item with the keyboard: Space, an arrow, Space', async () => {
    layOutInPageOrder()
    const testing = checklist('Testing', ['Chrome', 'Firefox', 'Safari'])
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const moves: unknown[] = []
    server.use(
      http.patch('/api/checklist-items/:itemId', async ({ request }) => {
        moves.push(await request.json())
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )
    const list = await findChecklist(await cardPanel(), 'Testing')

    dragHandle(list, 'Chrome').focus()
    await user.keyboard(' ')
    await user.keyboard('{ArrowDown}')
    await user.keyboard(' ')

    // On screen before the API has answered.
    await waitFor(() => expectItems(list, ['Firefox', 'Chrome', 'Safari']))
    expect(moves).toEqual([{ position: 1 }])
    // The card on the board was not moved.
    expect(api.requests).toEqual([])
    expect(
      within(screen.getByRole('region', { name: 'To do' })).getByRole(
        'button',
        { name: 'WEB-12 Login page' },
      ),
    ).toBeInTheDocument()
  })
})

describe('The checklist menu', () => {
  // Criterion 22.
  it('renames a checklist and moves it down and up', async () => {
    const testing = checklist('Testing', ['Chrome'])
    const release = checklist('Release', ['Tag the build'])
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing, release] },
    })
    const panel = await cardPanel()

    await user.click(
      menuButton(await findChecklist(panel, 'Testing'), 'Testing'),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const name = within(panel).getByDisplayValue('Testing')
    await user.clear(name)
    await typeInto(user, name, 'QA{Enter}')
    const qa = await findChecklist(panel, 'QA')

    await user.click(menuButton(qa, 'QA'))
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    await waitFor(async () =>
      expectBefore(
        await findChecklist(panel, 'Release'),
        await findChecklist(panel, 'QA'),
      ),
    )

    await user.click(menuButton(await findChecklist(panel, 'QA'), 'QA'))
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    await waitFor(async () =>
      expectBefore(
        await findChecklist(panel, 'QA'),
        await findChecklist(panel, 'Release'),
      ),
    )

    await waitFor(() => expect(api.requests).toHaveLength(3))
    expect(api.requests).toEqual([
      { request: `PATCH /api/checklists/${testing.id}`, body: { name: 'QA' } },
      { request: `PATCH /api/checklists/${testing.id}`, body: { position: 1 } },
      { request: `PATCH /api/checklists/${testing.id}`, body: { position: 0 } },
    ])
  })

  // Criteria 22 and 44.
  it('asks before deleting a checklist with its items', async () => {
    const testing = checklist('Testing', [
      'Chrome',
      'Firefox',
      'Safari',
      'Edge',
      'Opera',
      'Brave',
    ])
    const { user, api, container } = openCard(login, {
      checklists: { [login.id]: [testing] },
    })
    const panel = await cardPanel()
    const list = await findChecklist(panel, 'Testing')

    await user.click(menuButton(list, 'Testing'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete .Testing. and its 6 items\?/)
    await expectNoAccessibilityProblems(container)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.requests).toEqual([])
    expect(list).toBeInTheDocument()

    await user.click(menuButton(list, 'Testing'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^Delete/ }))

    await waitFor(() =>
      expect(within(panel).queryByRole('region', { name: 'Testing' })).toBe(
        null,
      ),
    )
    expect(api.requests.map((r) => r.request)).toEqual([
      `DELETE /api/checklists/${testing.id}`,
    ])
  })
})
