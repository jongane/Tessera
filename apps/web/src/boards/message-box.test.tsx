import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import {
  chatPanel,
  general,
  messageList,
  messageWith,
  openChat,
  typeInto,
} from '../test/chat-panel'
import { message } from '../test/fake-messages'
import { apiError, server } from '../test/server'

// Chat messages PR (plan "chat messages"): the message box at the bottom of
// the chat panel (acceptance criteria 19 to 24, 31 and 33).

// The box is loaded lazily, like the description's editor.
async function openBox(options: Parameters<typeof openChat>[0] = {}) {
  const app = openChat(options)
  const box = await within(
    await screen.findByRole('complementary', { name: /^Chat: / }),
  ).findByRole('textbox', { name: 'Message' })
  return { ...app, box }
}

const COULDNT_SEND = /Couldn.t send/

async function pause() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
}

describe('The message box', () => {
  // 20
  it('is labelled "Message", with a toolbar and a Send button', async () => {
    await openBox()

    const panel = within(chatPanel())
    for (const name of [
      'Bold',
      'Italic',
      'Code',
      'Link',
      'Bulleted list',
      'Numbered list',
      'Send',
    ]) {
      expect(panel.getByRole('button', { name }), name).toBeInTheDocument()
    }
    expect(panel.getByRole('textbox', { name: 'Message' })).toBeInTheDocument()
  })

  // 21
  it('sends the message as Markdown with Enter, and clears the box', async () => {
    const { user, box, api } = await openBox()

    await user.click(within(chatPanel()).getByRole('button', { name: 'Bold' }))
    await typeInto(user, box, 'Ship it')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]).toEqual({
      request: `POST /api/chats/${general.id}/messages`,
      body: { body: '**Ship it**', id: expect.stringMatching(UUID) },
    })
    await waitFor(() => expect(box).toHaveTextContent(''))
    expect(
      await within(await messageList()).findByText('Ship it'),
    ).toBeInTheDocument()
  })

  // 21
  it('starts a new line with Shift+Enter, and sends nothing', async () => {
    const { user, box, api } = await openBox()

    await typeInto(user, box, 'one')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.keyboard('two')
    await pause()

    expect(api.changes).toEqual([])
    expect(box).toHaveTextContent('one')
    expect(box).toHaveTextContent('two')
    await user.click(within(chatPanel()).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { body: string }).body).toMatch(
      /^one[\\ ]*\n+two$/,
    )
  })

  // 21
  it('sends with the Send button too', async () => {
    const { user, box, api } = await openBox()

    await typeInto(user, box, 'Hello team')
    await user.click(within(chatPanel()).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toEqual({
      body: 'Hello team',
      id: expect.stringMatching(UUID),
    })
    await waitFor(() => expect(box).toHaveTextContent(''))
  })

  // 21 (found while testing 37): what is typed is what is sent and shown
  it('sends > < & as typed, and shows them as typed, never as &gt; &lt; &amp;', async () => {
    const { user, box, api } = await openBox()

    await typeInto(user, box, 'a > b & c < d')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    const sent = (api.changes[0]!.body as { body: string }).body
    expect(sent).not.toMatch(/&(gt|lt|amp);/)
    expect(sent).toContain('>')
    expect(sent).toContain('&')
    const list = await messageList()
    expect(await within(list).findByText('a > b & c < d')).toBeInTheDocument()
    expect(list).not.toHaveTextContent(/&(gt|lt|amp);/)
  })

  // 21
  it('sends nothing for blank text, with Enter or with Send', async () => {
    const { user, box, api } = await openBox()

    box.focus()
    await user.keyboard('{Enter}')
    await user.click(within(chatPanel()).getByRole('button', { name: 'Send' }))
    await typeInto(user, box, '   ')
    await user.keyboard('{Enter}')
    await user.click(within(chatPanel()).getByRole('button', { name: 'Send' }))
    await pause()

    expect(api.changes).toEqual([])
    expect(api.messagesOf(general.id)).toEqual([])
  })

  // 22
  it('refuses text over 10,000 characters with "Use at most 10000 characters", and sends nothing', async () => {
    const { user, box, api } = await openBox()

    box.focus()
    await user.paste('x'.repeat(10_001))
    await user.keyboard('{Enter}')

    expect(
      await within(chatPanel()).findByText('Use at most 10000 characters'),
    ).toBeInTheDocument()
    await pause()
    expect(api.changes).toEqual([])
  })

  // 22
  it('sends text of exactly 10,000 characters', async () => {
    const { user, box, api } = await openBox()

    box.focus()
    await user.paste('x'.repeat(10_000))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(chatPanel()).not.toHaveTextContent('Use at most 10000 characters')
  })

  // 19
  it('turns an address typed as https://… or www.… into a link by itself', async () => {
    const { user, box, api } = await openBox()

    await typeInto(
      user,
      box,
      'Visit https://example.com and www.example.org now ',
    )
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { body: string }).body).toBe(
      'Visit [https://example.com](https://example.com) and [www.example.org](https://www.example.org) now',
    )
    const link = await within(await messageList()).findByRole('link', {
      name: 'https://example.com',
    })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  // 19
  it('turns a pasted address into a link by itself', async () => {
    const { user, box, api } = await openBox()

    box.focus()
    await user.paste('https://example.com/docs')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { body: string }).body).toBe(
      '[https://example.com/docs](https://example.com/docs)',
    )
  })

  // 19
  it('puts a link on the selected words with the toolbar’s Link button', async () => {
    const { user, box, api } = await openBox()
    const panel = within(chatPanel())

    await typeInto(user, box, 'read the docs')
    await user.keyboard('{Control>}a{/Control}')
    await user.click(panel.getByRole('button', { name: 'Link' }))
    await typeInto(
      user,
      panel.getByLabelText('Link address'),
      'https://example.com/docs',
    )
    await user.click(panel.getByRole('button', { name: 'Apply' }))
    await user.click(panel.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { body: string }).body).toBe(
      '[read the docs](https://example.com/docs)',
    )
  })

  // 19
  it('does not make a link of a javascript: address', async () => {
    const { user, box, api } = await openBox()
    const panel = within(chatPanel())

    await typeInto(user, box, 'click me')
    await user.keyboard('{Control>}a{/Control}')
    await user.click(panel.getByRole('button', { name: 'Link' }))
    await typeInto(
      user,
      panel.getByLabelText('Link address'),
      'javascript:alert(1)',
    )
    await user.click(panel.getByRole('button', { name: 'Apply' }))
    await user.click(panel.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { body: string }).body).not.toMatch(
      /\]\(\s*javascript:/i,
    )
  })
})

describe('Sending (criterion 23)', () => {
  // 23
  it('shows the message straight away as sending, until it is saved', async () => {
    const { user, box, api } = await openBox()
    const release = api.hold()

    await typeInto(user, box, 'On its way')
    await user.keyboard('{Enter}')

    const sending = await within(await messageList()).findByText('On its way')
    expect(messageWith('On its way')).toHaveTextContent('Sending…')
    expect(sending).toBeInTheDocument()
    release()
    await waitFor(() =>
      expect(messageWith('On its way')).not.toHaveTextContent('Sending…'),
    )
    expect(screen.getAllByText('On its way')).toHaveLength(1)
  })

  // 23
  it('keeps a message that could not be saved, with "Couldn’t send" and "Try again", which sends it again', async () => {
    const { user, box, api } = await openBox()
    server.use(
      http.post(
        '/api/chats/:chatId/messages',
        () => apiError(500, 'Something broke'),
        { once: true },
      ),
    )

    await typeInto(user, box, 'Please arrive')
    await user.keyboard('{Enter}')

    const item = await waitFor(() => {
      const found = messageWith('Please arrive')
      expect(found).toHaveTextContent(COULDNT_SEND)
      return found
    })
    expect(item).not.toHaveTextContent('Sending…')
    expect(api.changes).toEqual([])
    await user.click(within(item).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toEqual({
      body: 'Please arrive',
      id: expect.stringMatching(UUID),
    })
    await waitFor(() =>
      expect(messageWith('Please arrive')).not.toHaveTextContent(COULDNT_SEND),
    )
    expect(screen.getAllByText('Please arrive')).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument()
  })

  // 23
  it('shows the server’s message instead of "Couldn’t send" for a 4xx', async () => {
    const { user, box } = await openBox()
    server.use(
      http.post('/api/chats/:chatId/messages', () =>
        apiError(400, 'This contains a hidden character that can’t be saved'),
      ),
    )

    await typeInto(user, box, 'Nope')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(messageWith('Nope')).toHaveTextContent(
        'This contains a hidden character that can’t be saved',
      ),
    )
    expect(messageWith('Nope')).not.toHaveTextContent(COULDNT_SEND)
  })
})

describe('Sending when the first load failed (criterion 23, reviewer finding)', () => {
  // 23
  it('keeps a saved message in view, no longer "Sending…", until a reload succeeds', async () => {
    const { user } = openChat()
    server.use(
      http.get('/api/chats/:chatId/messages', () =>
        apiError(500, 'Something broke'),
      ),
    )
    const box = await within(
      await screen.findByRole('complementary', { name: /^Chat: / }),
    ).findByRole('textbox', { name: 'Message' })
    await within(chatPanel()).findByText(/Couldn.t load the messages/)

    await typeInto(user, box, 'Saved anyway')
    await user.keyboard('{Enter}')

    expect(
      await within(chatPanel()).findByText('Saved anyway'),
    ).toBeInTheDocument()
    await pause()
    expect(within(chatPanel()).getByText('Saved anyway')).toBeInTheDocument()
    expect(chatPanel()).not.toHaveTextContent('Sending…')
  })
})

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('The same message is never posted twice (criterion 39)', () => {
  // 39
  it('sends every new message with an id of its own, a UUID', async () => {
    const { user, box, api } = await openBox()

    await typeInto(user, box, 'First')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.changes).toHaveLength(1))
    await typeInto(user, box, 'Second')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.changes).toHaveLength(2))

    const ids = api.changes.map((c) => (c.body as { id?: string }).id)
    expect(ids[0]).toMatch(UUID)
    expect(ids[1]).toMatch(UUID)
    expect(ids[0]).not.toBe(ids[1])
  })

  // 39
  it('reuses the id when "Try again" sends a message whose reply was lost', async () => {
    const { user, box, api } = await openBox()
    const lost: { id?: string; body: string }[] = []
    server.use(
      http.post(
        '/api/chats/:chatId/messages',
        async ({ request }) => {
          lost.push((await request.json()) as { id?: string; body: string })
          return HttpResponse.error()
        },
        { once: true },
      ),
    )

    await typeInto(user, box, 'Did it arrive')
    await user.keyboard('{Enter}')
    const item = await waitFor(() => {
      const found = messageWith('Did it arrive')
      expect(found).toHaveTextContent(COULDNT_SEND)
      return found
    })
    await user.click(within(item).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(lost[0]!.id).toMatch(UUID)
    expect((api.changes[0]!.body as { id?: string }).id).toBe(lost[0]!.id)
    await waitFor(() =>
      expect(screen.getAllByText('Did it arrive')).toHaveLength(1),
    )
  })
})

// Types a bulleted list nested `levels` deep, from the keyboard: Shift+Enter
// starts the next item and Tab moves it one level in.
async function typeNestedList(
  user: Awaited<ReturnType<typeof openBox>>['user'],
  box: HTMLElement,
  levels: number,
) {
  await user.click(
    within(chatPanel()).getByRole('button', { name: 'Bulleted list' }),
  )
  await typeInto(user, box, 'level 1')
  for (let level = 2; level <= levels; level += 1) {
    await user.keyboard('{Shift>}{Enter}{/Shift}{Tab}')
    await user.keyboard(`level ${level}`)
  }
}

describe('Nesting limit in the message box (criterion 37)', () => {
  // The wording is the shared rule's (packages/shared/src/messages.ts).
  const TOO_DEEP = 'Use at most 10 levels of lists and quotes'

  // 37
  it('shows the message and sends nothing for text nested more than 10 levels', async () => {
    const { user, box, api } = await openBox()

    await typeNestedList(user, box, 11)
    await user.keyboard('{Enter}')

    await pause()
    expect(await within(chatPanel()).findByText(TOO_DEEP)).toBeInTheDocument()
    expect(api.changes).toEqual([])
  })

  // 37
  it('sends text nested exactly 10 levels', async () => {
    const { user, box, api } = await openBox()

    await typeNestedList(user, box, 10)
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(chatPanel()).not.toHaveTextContent(TOO_DEEP)
  })
})

describe('Drafts (criterion 24)', () => {
  // 24
  it('keeps unsent text for each chat while the page is open, and clears it once sent', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Unsent words')

    await user.click(screen.getByRole('link', { name: 'Release plan' }))
    await screen.findByRole('complementary', { name: 'Chat: Release plan' })
    const other = await within(chatPanel()).findByRole('textbox', {
      name: 'Message',
    })
    expect(other).not.toHaveTextContent('Unsent words')
    await user.click(screen.getByRole('link', { name: 'General' }))
    await screen.findByRole('complementary', { name: 'Chat: General' })

    const again = await within(chatPanel()).findByRole('textbox', {
      name: 'Message',
    })
    await waitFor(() => expect(again).toHaveTextContent('Unsent words'))
    again.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toEqual({
      body: 'Unsent words',
      id: expect.stringMatching(UUID),
    })

    await user.click(screen.getByRole('link', { name: 'Release plan' }))
    await screen.findByRole('complementary', { name: 'Chat: Release plan' })
    await user.click(screen.getByRole('link', { name: 'General' }))
    await screen.findByRole('complementary', { name: 'Chat: General' })
    const cleared = await within(chatPanel()).findByRole('textbox', {
      name: 'Message',
    })
    expect(cleared).not.toHaveTextContent('Unsent words')
  })
})

describe('Reloading after your own change (criterion 31)', () => {
  // 31
  it('reloads the messages after a message is sent', async () => {
    const { user, box, api } = await openBox({
      messages: [message('Earlier')],
    })
    await within(await messageList()).findByText('Earlier')
    const loads = api.gets.length

    await typeInto(user, box, 'And now')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.gets.length).toBeGreaterThan(loads))
  })
})

describe('Accessibility of the message box (criterion 33)', () => {
  // 33
  it('has no accessibility problems with text typed, the link form open, sending and a failed send', async () => {
    const { user, box, api, container } = await openBox()
    await expectNoAccessibilityProblems(container)

    await typeInto(user, box, 'Some words')
    await user.click(within(chatPanel()).getByRole('button', { name: 'Link' }))
    await expectNoAccessibilityProblems(container)
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Cancel' }),
    )

    const release = api.hold()
    await user.click(within(chatPanel()).getByRole('button', { name: 'Send' }))
    await within(await messageList()).findByText('Some words')
    await expectNoAccessibilityProblems(container)
    release()

    server.use(
      http.post('/api/chats/:chatId/messages', () => apiError(500, 'Broke')),
    )
    await typeInto(user, box, 'Will fail')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(messageWith('Will fail')).toHaveTextContent(COULDNT_SEND),
    )
    await expectNoAccessibilityProblems(container)
  })

  // 33
  it('has no accessibility problems when the text is too long', async () => {
    const { user, box, container } = await openBox()

    box.focus()
    await user.paste('x'.repeat(10_001))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText('Use at most 10000 characters')

    await expectNoAccessibilityProblems(container)
  })
})
