import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import {
  ago,
  chatPanel,
  general,
  messageList,
  messageOf,
  messageWith,
  MINUTE,
  openChat,
  openMenu,
  typeInto,
} from '../test/chat-panel'
import { ben } from '../test/fake-board'
import { message } from '../test/fake-messages'
import { ana, apiError, server } from '../test/server'

// Chat messages PR (plan "chat messages"): editing and deleting a message
// (acceptance criteria 25 to 28, 31 and 33).

const COULDNT_SAVE = /Couldn.t save, try again/

// Opens the board and waits for the messages.
async function open(options: Parameters<typeof openChat>[0]) {
  const app = openChat(options)
  await messageList()
  return app
}

function optionsOf(text: string) {
  return within(messageWith(text)).getByRole('button', {
    name: 'Message options',
  })
}

async function startEditing(
  user: Awaited<ReturnType<typeof open>>['user'],
  text: string,
) {
  await openMenu(user, optionsOf(text))
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
  return within(messageWith(text)).findByRole('textbox')
}

describe('Who sees the message menu (criterion 25)', () => {
  // 25
  it('gives your own message a "Message options" menu with Edit and Delete', async () => {
    const { user } = await open({ messages: [message('Mine')] })
    await screen.findByText('Mine')

    await openMenu(user, optionsOf('Mine'))

    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  })

  // 25
  it('gives a project admin only Delete on someone else’s message', async () => {
    // Ana is the project's admin.
    const { user } = await open({
      messages: [message('Ben’s words', { author: ben })],
    })
    await screen.findByText('Ben’s words')

    await openMenu(user, optionsOf('Ben’s words'))

    expect(
      await screen.findByRole('menuitem', { name: 'Delete' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('menuitem', { name: 'Edit' }),
    ).not.toBeInTheDocument()
  })

  // 25
  it('gives a plain member no menu on someone else’s message, but one on their own', async () => {
    // Ben is a plain member.
    await open({
      me: ben,
      messages: [
        message('Ana’s words', { createdAt: ago(10 * MINUTE) }),
        message('Ben’s words', { author: ben, createdAt: ago(1 * MINUTE) }),
      ],
    })
    await screen.findByText('Ben’s words')

    expect(
      within(messageWith('Ana’s words')).queryByRole('button', {
        name: 'Message options',
      }),
    ).not.toBeInTheDocument()
    expect(optionsOf('Ben’s words')).toBeInTheDocument()
  })
})

describe('Editing (criterion 26)', () => {
  // 26
  it('replaces the message with an editor holding its text, with Save and Cancel', async () => {
    const { user } = await open({ messages: [message('Helo **wrld**')] })
    await screen.findByText('Helo')

    const editor = await startEditing(user, 'Helo')

    expect(editor).toHaveTextContent('Helo wrld')
    const item = messageWith('Helo')
    expect(within(item).getByRole('button', { name: 'Save' })).toBeVisible()
    expect(within(item).getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  // 26
  it('Save sends PATCH and shows the new text with "(edited)"', async () => {
    const { user, api } = await open({ messages: [message('Helo wrld')] })
    await screen.findByText('Helo wrld')

    const editor = await startEditing(user, 'Helo wrld')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('Hello world')
    await user.click(
      within(messageOf(editor)).getByRole('button', { name: 'Save' }),
    )

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]).toEqual({
      request: `PATCH /api/messages/${api.messagesOf(general.id)[0]!.id}`,
      body: { body: 'Hello world' },
    })
    const item = await waitFor(() => {
      const found = messageWith('Hello world')
      expect(found).toHaveTextContent('(edited)')
      return found
    })
    expect(within(item).queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Helo wrld')).not.toBeInTheDocument()
  })

  // 26
  it('Cancel restores the message and sends nothing', async () => {
    const { user, api } = await open({ messages: [message('Original words')] })
    await screen.findByText('Original words')
    const editor = await startEditing(user, 'Original words')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('Something else')

    await user.click(
      within(messageWith('Something else')).getByRole('button', {
        name: 'Cancel',
      }),
    )

    expect(await screen.findByText('Original words')).toBeInTheDocument()
    expect(screen.queryByText('Something else')).not.toBeInTheDocument()
    expect(messageWith('Original words')).not.toHaveTextContent('(edited)')
    expect(api.changes).toEqual([])
  })

  // 26
  it('Escape restores the message and sends nothing', async () => {
    const { user, api } = await open({ messages: [message('Original words')] })
    await screen.findByText('Original words')
    const editor = await startEditing(user, 'Original words')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('Something else')

    await user.keyboard('{Escape}')

    expect(await screen.findByText('Original words')).toBeInTheDocument()
    expect(screen.queryByText('Something else')).not.toBeInTheDocument()
    expect(api.changes).toEqual([])
  })

  // 26
  it('applies the blank rule: blank text is not saved', async () => {
    const { user, api } = await open({ messages: [message('Some words')] })
    await screen.findByText('Some words')
    const editor = await startEditing(user, 'Some words')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}{Backspace}')

    await user.click(
      within(messageOf(editor)).getByRole('button', { name: 'Save' }),
    )

    expect(api.changes).toEqual([])
    expect(within(chatPanel()).getAllByRole('textbox').length).toBeGreaterThan(
      1,
    )
  })

  // 26
  it('applies the length rule: over 10,000 characters shows "Use at most 10000 characters" and is not saved', async () => {
    const { user, api } = await open({ messages: [message('Some words')] })
    await screen.findByText('Some words')
    const editor = await startEditing(user, 'Some words')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.paste('x'.repeat(10_001))

    await user.click(
      within(messageOf(editor)).getByRole('button', { name: 'Save' }),
    )

    expect(
      await within(chatPanel()).findByText('Use at most 10000 characters'),
    ).toBeInTheDocument()
    expect(api.changes).toEqual([])
  })
})

describe('Reviewer findings', () => {
  // 26 (reviewer finding): Enter pressed twice while the edit is saving
  it('sends only one PATCH when Enter is pressed twice while the edit is saving', async () => {
    const original = message('Helo')
    const { user } = await open({ messages: [original] })
    await screen.findByText('Helo')
    let patches = 0
    server.use(
      http.patch('/api/messages/:messageId', async () => {
        patches += 1
        await new Promise((resolve) => setTimeout(resolve, 300))
        return HttpResponse.json({
          ...original,
          body: 'Hello',
          editedAt: new Date().toISOString(),
        })
      }),
    )
    const editor = await startEditing(user, 'Helo')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('Hello')

    await user.keyboard('{Enter}{Enter}')
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(patches).toBe(1)
  })

  // 25 (reviewer finding): a message of a deleted account is nobody's to edit
  it.each([
    ['a plain member', ben, false],
    ['a project admin', ana, true],
  ])(
    'never offers Edit on a message whose author is gone, to %s',
    async (_who, me, hasMenu) => {
      await open({
        me,
        messages: [message('From a gone account', { author: null })],
      })
      await screen.findByText('From a gone account')

      const menu = within(messageWith('From a gone account')).queryByRole(
        'button',
        { name: 'Message options' },
      )
      expect(menu !== null).toBe(hasMenu)
      expect(
        screen.queryByRole('menuitem', { name: 'Edit' }),
      ).not.toBeInTheDocument()
    },
  )
})

describe('Deleting (criterion 27)', () => {
  // 27
  it('asks "Delete this message?"; confirming sends DELETE and shows the message crossed out', async () => {
    const { user, api } = await open({ messages: [message('Oops')] })
    await screen.findByText('Oops')

    await openMenu(user, optionsOf('Oops'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })
    expect(api.changes).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.request).toMatch(/^DELETE \/api\/messages\//)
    await waitFor(() =>
      expect(messageWith('Oops').querySelector('del')).toHaveTextContent(
        'Oops',
      ),
    )
    expect(messageWith('Oops')).toHaveTextContent('Deleted by Ana')
    expect(
      screen.queryByRole('dialog', { name: 'Delete this message?' }),
    ).not.toBeInTheDocument()
  })

  // 27
  it('lets a project admin delete someone else’s message', async () => {
    const { user, api } = await open({
      messages: [message('Ben’s words', { author: ben })],
    })
    await screen.findByText('Ben’s words')

    await openMenu(user, optionsOf('Ben’s words'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    await waitFor(() =>
      expect(messageWith('Ben’s words')).toHaveTextContent('Deleted by Ana'),
    )
  })

  // 27
  it('Cancel sends nothing and returns the focus to the menu button', async () => {
    const { user, api } = await open({ messages: [message('Keep me')] })
    await screen.findByText('Keep me')
    const button = optionsOf('Keep me')

    await openMenu(user, button)
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Delete this message?' }),
      ).not.toBeInTheDocument(),
    )
    expect(api.changes).toEqual([])
    expect(messageWith('Keep me').querySelector('del')).toBeNull()
    expect(optionsOf('Keep me')).toHaveFocus()
  })
})

describe('When an edit or a delete fails (criterion 28)', () => {
  // 28
  it('shows the server’s message for a 4xx on an edit, and keeps the message as it was', async () => {
    const { user, api } = await open({ messages: [message('Helo')] })
    await screen.findByText('Helo')
    server.use(
      http.patch('/api/messages/:messageId', () =>
        apiError(409, 'This message was deleted'),
      ),
    )
    const editor = await startEditing(user, 'Helo')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('Hello')
    await user.click(
      within(messageWith('Hello')).getByRole('button', { name: 'Save' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This message was deleted',
    )
    expect(api.messagesOf(general.id)[0]).toMatchObject({
      body: 'Helo',
      editedAt: null,
    })
    expect(chatPanel()).not.toHaveTextContent('(edited)')
  })

  // 28
  it('says "Couldn’t save, try again" when an edit fails otherwise', async () => {
    const { user } = await open({ messages: [message('Helo')] })
    await screen.findByText('Helo')
    server.use(
      http.patch('/api/messages/:messageId', () =>
        apiError(500, 'Something broke'),
      ),
    )
    const editor = await startEditing(user, 'Helo')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('Hello')
    await user.click(
      within(messageWith('Hello')).getByRole('button', { name: 'Save' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(COULDNT_SAVE)
    expect(chatPanel()).not.toHaveTextContent('(edited)')
  })

  // 28
  it('shows the server’s message for a 4xx on a delete, and keeps the message as it was', async () => {
    const { user } = await open({ messages: [message('Stay')] })
    await screen.findByText('Stay')
    server.use(
      http.delete('/api/messages/:messageId', () =>
        apiError(403, 'Only the author or a project admin can delete this'),
      ),
    )

    await openMenu(user, optionsOf('Stay'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the author or a project admin can delete this',
    )
    expect(messageWith('Stay').querySelector('del')).toBeNull()
  })

  // 28
  it('says "Couldn’t save, try again" when a delete fails otherwise', async () => {
    const { user } = await open({ messages: [message('Stay')] })
    await screen.findByText('Stay')
    server.use(
      http.delete('/api/messages/:messageId', () =>
        apiError(500, 'Something broke'),
      ),
    )

    await openMenu(user, optionsOf('Stay'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(COULDNT_SAVE)
    expect(messageWith('Stay').querySelector('del')).toBeNull()
  })
})

describe('Reloading after your own change (criterion 31)', () => {
  // 31
  it('reloads the messages after an edit and after a delete', async () => {
    const { user, api } = await open({ messages: [message('Helo')] })
    await screen.findByText('Helo')
    let loads = api.gets.length

    const editor = await startEditing(user, 'Helo')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('Hello')
    await user.click(
      within(messageWith('Hello')).getByRole('button', { name: 'Save' }),
    )
    await waitFor(() => expect(api.gets.length).toBeGreaterThan(loads))
    await waitFor(() =>
      expect(messageWith('Hello')).toHaveTextContent('(edited)'),
    )
    loads = api.gets.length

    await openMenu(user, optionsOf('Hello'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.gets.length).toBeGreaterThan(loads))
  })
})

describe('Accessibility of editing and deleting (criterion 33)', () => {
  // 33
  it('has no accessibility problems with the menu open, an edit open, the confirmation open or an error shown', async () => {
    const { user, container } = await open({
      messages: [
        message('First words', { createdAt: ago(10 * MINUTE) }),
        message('Ben’s words', { author: ben, createdAt: ago(5 * MINUTE) }),
      ],
    })
    await screen.findByText('Ben’s words')

    await openMenu(user, optionsOf('First words'))
    await screen.findByRole('menuitem', { name: 'Edit' })
    await expectNoAccessibilityProblems(container)
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await within(messageWith('First words')).findByRole('textbox')
    await expectNoAccessibilityProblems(container)
    server.use(
      http.patch('/api/messages/:messageId', () => apiError(500, 'Broke')),
    )
    const editor = within(messageWith('First words')).getByRole('textbox')
    await typeInto(user, editor, ' more')
    await user.click(
      within(messageOf(editor)).getByRole('button', { name: 'Save' }),
    )
    await screen.findByRole('alert')
    await expectNoAccessibilityProblems(container)
    await user.click(
      within(messageOf(editor)).getByRole('button', {
        name: 'Cancel',
      }),
    )

    await openMenu(user, optionsOf('Ben’s words'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await screen.findByRole('dialog', { name: 'Delete this message?' })
    await expectNoAccessibilityProblems(container)
  })
})

// Antagonist proof, round 2 (criteria 35 and 44).
describe('Editing an odd body', () => {
  // 35, 44: ">>>…x" (no spaces) used to pass the API's nesting rule, and the
  // edit box read it outside the message's safety net.
  it('keeps the chat working when the author edits a deeply quoted message', async () => {
    const body = '>'.repeat(3000) + 'x'
    const { user } = await open({
      messages: [message('Hello before'), message(body)],
    })

    await openMenu(user, optionsOf(body))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    expect(
      await within(await messageList()).findByText('Hello before'),
    ).toBeInTheDocument()
  })
})

// Antagonist proof, round 3 (R1).
describe('The edit box keeps the whole text (criteria 43 and 45)', () => {
  // 43, 45: a heading (which the rich edit box cannot hold) must not empty the
  // box, or Save throws the whole message away. Either the rich box holds all
  // the text, or the plain-text fallback opens holding it.
  it('opens a message with a heading in it holding all its text', async () => {
    const body = 'intro\n\n## Part two\n\nmore'
    const { user } = await open({ messages: [message(body)] })
    const item = within(await messageList()).getAllByRole('listitem')[0]!

    await openMenu(
      user,
      within(item).getByRole('button', { name: 'Message options' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editor = await within(item).findByRole('textbox')

    const text =
      editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent
    expect(text ?? '').toMatch(/intro.*Part two.*more/s)
  })
})

// Criterion 45: anything the rich box would change on reading must open in
// the plain-text box. Antagonist proof, round 4 (R4-1), and a reviewer case.
describe('Bodies the rich edit box cannot hold keep their text through an edit (criterion 45)', () => {
  // 45. An image, a table, a task list or a footnote is edited as plain text.
  it.each([
    ['a footnote', 'text[^1]\n\n[^1]: note', '[^1]: note'],
    [
      'an image',
      '![chart](https://x.io/c.png) see',
      '![chart](https://x.io/c.png)',
    ],
    [
      'a table',
      '| Task | Who |\n|---|---|\n| Deploy | Ben |',
      '|\n|---|---|\n|',
    ],
    ['a task list', '- [ ] buy milk\n- [x] done', '[ ] buy milk'],
  ])('keeps %s through an edit', async (_name, body, kept) => {
    const { user, api } = await open({ messages: [message(body)] })
    const item = within(await messageList()).getAllByRole('listitem')[0]!

    await openMenu(
      user,
      within(item).getByRole('button', { name: 'Message options' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editor = await within(item).findByRole('textbox')
    await waitFor(() => expect(editor).toHaveFocus())
    await user.keyboard(editor.tagName === 'TEXTAREA' ? '{End} z' : ' z')
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { body: string }).body).toContain(kept)
  })
})
