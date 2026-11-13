import type { BoardCard } from '@tessera/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { cardPanel, login, openCard, typeInto } from '../test/card-panel'
import { general, messageList, messageOf, openChat } from '../test/chat-panel'
import { ben } from '../test/fake-board'
import { checklist } from '../test/fake-checklists'
import { live } from '../test/fake-live'
import { message } from '../test/fake-messages'
import { boardCard, sprint } from '../test/fixtures'
import { recordRequests } from '../test/requests'
import { ana } from '../test/server'

// Live updates PR (plan "live updates", Jon's answers of 2026-11-13): what
// happens to a field you are editing when someone else changes it
// (acceptance criteria 24 to 29 and 31). Only a change to the same field
// brings up the “Someone changed this” panel; a change elsewhere on the
// card just shows. “Someone else” here is a request sent straight to the
// fake API, followed by the signal the server would send.

const NOTE = /Someone changed this while you were editing/

// Someone else saves a change on the server (the fake API remembers it).
async function someoneElseSends(
  api: { requests: unknown[] },
  method: string,
  path: string,
  body: unknown,
) {
  const response = await fetch(new URL(path, window.location.origin), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.ok, `${method} ${path}`).toBe(true)
  // Only the changes this person makes count in the tests.
  api.requests.length = 0
}

const withDescription: BoardCard = { ...login, description: 'Old text' }

async function joined() {
  await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
}

async function openDescription(card: BoardCard = withDescription) {
  const app = openCard(card)
  const panel = await cardPanel()
  await app.user.click(
    within(panel).getByRole('button', { name: 'Edit description' }),
  )
  const editor = await within(panel).findByRole('textbox', {
    name: 'Description',
  })
  await typeInto(app.user, editor, ' and mine')
  await joined()
  return { ...app, panel, editor }
}

async function openTitle(card: BoardCard = login) {
  const app = openCard(card)
  const panel = await cardPanel()
  const title = within(panel).getByLabelText('Title')
  await app.user.clear(title)
  await typeInto(app.user, title, 'My title')
  await joined()
  return { ...app, panel, title }
}

async function openItem() {
  const testing = checklist('Testing', ['Chrome', 'Safari'])
  const app = openCard(login, { checklists: { [login.id]: [testing] } })
  const panel = await cardPanel()
  const list = await within(panel).findByRole('region', { name: 'Testing' })
  await app.user.click(within(list).getByRole('button', { name: 'Chrome' }))
  const box = within(list).getByDisplayValue('Chrome')
  await app.user.clear(box)
  await typeInto(app.user, box, 'My Chrome')
  await joined()
  return { ...app, panel, list, box, testing }
}

describe('A change somewhere else on the card (criterion 24)', () => {
  // 24
  it('shows a new checklist straight away and leaves the open description box alone', async () => {
    const { api, panel, editor } = await openDescription()

    await someoneElseSends(api, 'POST', `/api/cards/${login.id}/checklists`, {
      name: 'Release',
    })
    await live.cardChanged(login.id)

    expect(
      await within(panel).findByRole('region', { name: 'Release' }),
    ).toBeInTheDocument()
    expect(editor).toHaveTextContent('Old text and mine')
    expect(within(panel).queryByText(NOTE)).toBeNull()
  })

  // 24
  it('shows a new title straight away and leaves the open description box alone', async () => {
    const { api, panel, editor } = await openDescription()

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Sign-in page',
    })
    await live.cardChanged(login.id)

    await waitFor(() =>
      expect(within(panel).getByLabelText('Title')).toHaveValue('Sign-in page'),
    )
    expect(editor).toHaveTextContent('Old text and mine')
    expect(within(panel).queryByText(NOTE)).toBeNull()
  })

  // 24
  it('shows a change to checklist item B straight away and leaves the box of item A alone', async () => {
    const { api, list, box, testing } = await openItem()

    await someoneElseSends(
      api,
      'PATCH',
      `/api/checklist-items/${testing.items[1]!.id}`,
      { text: 'Safari 17' },
    )
    await live.cardChanged(login.id)

    expect(
      await within(list).findByRole('checkbox', { name: 'Safari 17' }),
    ).toBeInTheDocument()
    expect(box).toHaveValue('My Chrome')
    expect(within(list).queryByText(NOTE)).toBeNull()
  })

  // 24
  it('shows a priority picked by someone else and leaves the open title box alone', async () => {
    const { api, panel, title } = await openTitle()

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      priority: 'HIGH',
    })
    await live.cardChanged(login.id)

    await waitFor(() =>
      expect(within(panel).getByLabelText('Priority')).toHaveDisplayValue(
        'High',
      ),
    )
    expect(title).toHaveValue('My title')
    expect(within(panel).queryByText(NOTE)).toBeNull()
  })

  // 28
  it('shows a priority picked by someone else, without a panel, while you edit the description', async () => {
    const { api, panel } = await openDescription()

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      priority: 'HIGH',
    })
    await live.cardChanged(login.id)

    await waitFor(() =>
      expect(within(panel).getByLabelText('Priority')).toHaveDisplayValue(
        'High',
      ),
    )
    expect(within(panel).queryByText(NOTE)).toBeNull()
  })

  // 28
  it('shows a priority picked by someone else while nothing is being edited', async () => {
    const { api } = openCard()
    const panel = await cardPanel()
    await joined()

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      priority: 'URGENT',
    })
    await live.cardChanged(login.id)

    await waitFor(() =>
      expect(within(panel).getByLabelText('Priority')).toHaveDisplayValue(
        'Urgent',
      ),
    )
    expect(within(panel).queryByText(NOTE)).toBeNull()
  })
})

describe('The same field changed (criteria 25 to 27)', () => {
  // 25
  it('keeps your description in the box and shows their version, formatted, in a panel', async () => {
    const { api, panel, editor } = await openDescription()

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their **bold** text',
    })
    await live.cardChanged(login.id)

    expect(await within(panel).findByText(NOTE)).toBeInTheDocument()
    expect(within(panel).getByText('bold').tagName).toBe('STRONG')
    expect(editor).toHaveTextContent('Old text and mine')
  })

  // 25
  it('keeps your title in the box and shows their title in a panel', async () => {
    const { api, panel, title } = await openTitle()

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their title',
    })
    await live.cardChanged(login.id)

    expect(await within(panel).findByText(NOTE)).toBeInTheDocument()
    expect(within(panel).getByText('Their title')).toBeInTheDocument()
    expect(title).toHaveValue('My title')
  })

  // 25
  it('does the same for the title of a subtask opened as a card', async () => {
    const subtask = boardCard('12.1', 'Review', {
      parentId: login.id,
      chatId: login.chatId,
    })
    const app = openCard(subtask)
    const panel = await cardPanel('WEB-12.1')
    const title = within(panel).getByLabelText('Title')
    await app.user.clear(title)
    await typeInto(app.user, title, 'My review')
    await joined()

    await someoneElseSends(app.api, 'PATCH', `/api/cards/${subtask.id}`, {
      title: 'Their review',
    })
    await live.cardChanged(subtask.id)

    expect(await within(panel).findByText(NOTE)).toBeInTheDocument()
    expect(within(panel).getByText('Their review')).toBeInTheDocument()
    expect(title).toHaveValue('My review')
  })

  // 25
  it('keeps your checklist item text in the box and shows their text in a panel', async () => {
    const { api, list, box, testing } = await openItem()

    await someoneElseSends(
      api,
      'PATCH',
      `/api/checklist-items/${testing.items[0]!.id}`,
      { text: 'Chromium' },
    )
    await live.cardChanged(login.id)

    expect(await within(list).findByText(NOTE)).toBeInTheDocument()
    expect(within(list).getByText('Chromium')).toBeInTheDocument()
    expect(box).toHaveValue('My Chrome')
  })

  // 25
  it('keeps the message you are editing in its box and shows their version, formatted, in a panel', async () => {
    const { api, user } = openChat({ messages: [message('Original words')] })
    const list = await messageList()
    await within(list).findByText('Original words')
    const id = api.messagesOf(general.id)[0]!.id
    await user.click(
      within(list).getByRole('button', { name: 'Message options' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editor = await within(list).findByRole('textbox')
    await typeInto(user, editor, ' and mine')
    await joined()

    api.edit(id, 'Their **bold** words')
    await live.messageChanged(general.id, id)

    const item = messageOf(editor)
    expect(await within(item).findByText(NOTE)).toBeInTheDocument()
    expect(within(item).getByText('bold').tagName).toBe('STRONG')
    expect(editor).toHaveTextContent('Original words and mine')
  })

  // 27
  it('shows the newest version when they change it again while the panel is open', async () => {
    const { api, panel } = await openDescription()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their first words',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText('Their first words')

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their second words',
    })
    await live.cardChanged(login.id)

    expect(await within(panel).findByText('Their second words')).toBeVisible()
    expect(within(panel).queryByText('Their first words')).toBeNull()
    expect(within(panel).getAllByText(NOTE)).toHaveLength(1)
  })

  // 27
  it('shows the newest title when they change it again while the panel is open', async () => {
    const { api, panel } = await openTitle()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their first title',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText('Their first title')

    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their second title',
    })
    await live.cardChanged(login.id)

    expect(await within(panel).findByText('Their second title')).toBeVisible()
    expect(within(panel).queryByText('Their first title')).toBeNull()
  })
})

describe('The panel’s buttons (criterion 26)', () => {
  // 26
  it('Use theirs puts their description in the box, which stays open, and sends nothing', async () => {
    const { api, user, panel, editor } = await openDescription()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await user.click(within(panel).getByRole('button', { name: 'Use theirs' }))

    await waitFor(() => expect(editor).toHaveTextContent('Their text'))
    expect(editor).not.toHaveTextContent('mine')
    expect(
      within(panel).getByRole('textbox', { name: 'Description' }),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Save' })).toBeVisible()
    expect(api.requests).toEqual([])
  })

  // 26
  it('Keep mine closes the panel and keeps your description, sending nothing', async () => {
    const { api, user, panel, editor } = await openDescription()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await user.click(within(panel).getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(within(panel).queryByText(NOTE)).toBeNull())
    expect(editor).toHaveTextContent('Old text and mine')
    expect(api.requests).toEqual([])
  })

  // 26
  it('Save saves your description over theirs, and the panel goes away', async () => {
    const { api, user, panel } = await openDescription()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]).toEqual({
      request: `PATCH /api/cards/${login.id}`,
      body: { description: 'Old text and mine' },
    })
    await waitFor(() => expect(within(panel).queryByText(NOTE)).toBeNull())
    expect(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    ).toBeInTheDocument()
  })

  // 26
  it('Cancel closes the description box and shows their version', async () => {
    const { api, user, panel } = await openDescription()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await user.click(within(panel).getByRole('button', { name: 'Cancel' }))
    // The box may still ask before it throws your text away.
    const discard = within(panel).queryByRole('button', { name: 'Discard' })
    if (discard) await user.click(discard)

    await waitFor(() =>
      expect(
        within(panel).queryByRole('textbox', { name: 'Description' }),
      ).toBeNull(),
    )
    expect(within(panel).getByText('Their text')).toBeInTheDocument()
    expect(within(panel).queryByText(NOTE)).toBeNull()
    expect(api.requests).toEqual([])
  })

  // 26
  it('Use theirs puts their title in the box, which stays open, and sends nothing', async () => {
    const { api, user, panel, title } = await openTitle()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their title',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await user.click(within(panel).getByRole('button', { name: 'Use theirs' }))

    await waitFor(() => expect(title).toHaveValue('Their title'))
    expect(api.requests).toEqual([])
  })

  // 26
  it('Keep mine closes the panel and keeps your title, sending nothing', async () => {
    const { api, user, panel, title } = await openTitle()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their title',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await user.click(within(panel).getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(within(panel).queryByText(NOTE)).toBeNull())
    expect(title).toHaveValue('My title')
    expect(api.requests).toEqual([])
  })

  // 26
  it('Enter in the title box saves your title over theirs, and the panel goes away', async () => {
    const { api, user, panel, title } = await openTitle()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their title',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    title.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]).toEqual({
      request: `PATCH /api/cards/${login.id}`,
      body: { title: 'My title' },
    })
    await waitFor(() => expect(within(panel).queryByText(NOTE)).toBeNull())
  })

  // 26
  it('Escape in the title box closes the field and shows their title', async () => {
    const { api, user, panel, title } = await openTitle()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their title',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    title.focus()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(title).toHaveValue('Their title'))
    expect(within(panel).queryByText(NOTE)).toBeNull()
    expect(api.requests).toEqual([])
  })

  // 26
  it('Use theirs, Keep mine and Enter work for a checklist item too', async () => {
    const { api, user, list, box, testing } = await openItem()
    await someoneElseSends(
      api,
      'PATCH',
      `/api/checklist-items/${testing.items[0]!.id}`,
      { text: 'Chromium' },
    )
    await live.cardChanged(login.id)
    await within(list).findByText(NOTE)

    await user.click(within(list).getByRole('button', { name: 'Use theirs' }))
    await waitFor(() => expect(box).toHaveValue('Chromium'))
    expect(api.requests).toEqual([])

    await typeInto(user, box, ' 2')
    await someoneElseSends(
      api,
      'PATCH',
      `/api/checklist-items/${testing.items[0]!.id}`,
      { text: 'Chromium 3' },
    )
    await live.cardChanged(login.id)
    await within(list).findByText('Chromium 3')
    await user.click(within(list).getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(within(list).queryByText(NOTE)).toBeNull())
    expect(box).toHaveValue('Chromium 2')
    expect(api.requests).toEqual([])

    box.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.requests).toHaveLength(1))
    expect(api.requests[0]).toEqual({
      request: `PATCH /api/checklist-items/${testing.items[0]!.id}`,
      body: { text: 'Chromium 2' },
    })
  })

  // 26
  it('Use theirs, Keep mine and Save work for the message you are editing', async () => {
    const requests = recordRequests()
    const { api, user } = openChat({ messages: [message('Original words')] })
    const list = await messageList()
    await within(list).findByText('Original words')
    const id = api.messagesOf(general.id)[0]!.id
    await user.click(
      within(list).getByRole('button', { name: 'Message options' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editor = await within(list).findByRole('textbox')
    await typeInto(user, editor, ' and mine')
    await joined()
    const item = messageOf(editor)
    api.edit(id, 'Their words')
    await live.messageChanged(general.id, id)
    await within(item).findByText(NOTE)

    await user.click(within(item).getByRole('button', { name: 'Use theirs' }))
    await waitFor(() => expect(editor).toHaveTextContent('Their words'))
    expect(editor).not.toHaveTextContent('mine')
    expect(api.changes).toEqual([])

    await typeInto(user, editor, ' plus mine')
    api.edit(id, 'Their newer words')
    await live.messageChanged(general.id, id)
    await within(item).findByText('Their newer words')
    await user.click(within(item).getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(within(item).queryByText(NOTE)).toBeNull())
    expect(editor).toHaveTextContent('Their words plus mine')

    await user.click(within(item).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]).toEqual({
      request: `PATCH /api/messages/${id}`,
      body: { body: 'Their words plus mine' },
    })
    expect(requests.saves()).toHaveLength(1)
  })
})

describe('Your message deleted while you edit it (criterion 29)', () => {
  // 29
  it('closes the editor and shows the message crossed out, sending nothing', async () => {
    // Ben writes and edits his message; Ana (the admin) deletes it elsewhere.
    const { api, user } = openChat({
      me: ben,
      messages: [message('Oops', { author: ben })],
    })
    const list = await messageList()
    await within(list).findByText('Oops')
    const id = api.messagesOf(general.id)[0]!.id
    await user.click(
      within(list).getByRole('button', { name: 'Message options' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editor = await within(list).findByRole('textbox')
    await typeInto(user, editor, ' and more')
    await joined()
    const item = messageOf(editor)

    api.remove(id, ana)
    await live.messageChanged(general.id, id)

    await waitFor(() => expect(within(list).queryByRole('textbox')).toBeNull())
    expect(item.querySelector('del')).toHaveTextContent('Oops')
    expect(item).toHaveTextContent('Deleted by Ana')
    expect(within(item).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(item).queryByText(NOTE)).toBeNull()
    expect(api.changes).toEqual([])
  })
})

describe('Accessibility of the panel (criterion 31)', () => {
  // 31
  it('has no accessibility problems with the description panel shown', async () => {
    const { api, panel, container } = await openDescription()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their **bold** text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await expectNoAccessibilityProblems(container)
  })

  // 31
  it('has no accessibility problems with the title panel shown', async () => {
    const { api, panel, container } = await openTitle()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      title: 'Their title',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    await expectNoAccessibilityProblems(container)
  })

  // 31
  it('has buttons that work with Enter and Space', async () => {
    const { api, user, panel, editor } = await openDescription()
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText(NOTE)

    const useTheirs = within(panel).getByRole('button', { name: 'Use theirs' })
    useTheirs.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(editor).toHaveTextContent('Their text'))

    await typeInto(user, editor, ' again')
    await someoneElseSends(api, 'PATCH', `/api/cards/${login.id}`, {
      description: 'Their newer text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText('Their newer text')
    const keepMine = within(panel).getByRole('button', { name: 'Keep mine' })
    keepMine.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(within(panel).queryByText(NOTE)).toBeNull())
    expect(editor).toHaveTextContent('Their text again')
  })
})
