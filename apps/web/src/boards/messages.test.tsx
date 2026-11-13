import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { expectNoAccessibilityProblems } from '../test/a11y'
import {
  ago,
  chatPanel,
  general,
  login,
  messageList,
  messageWith,
  MINUTE,
  NOW,
  openChat,
} from '../test/chat-panel'
import { ben, member } from '../test/fake-board'
import { message } from '../test/fake-messages'
import { currentPath } from '../test/render'
import {
  isAtBottom,
  hasNotMoved,
  heights,
  keptPlace,
  scrollers,
  scrollTo,
  stubLayout,
} from '../test/scroll'
import { ana, apiError, server } from '../test/server'
import { sprint } from '../test/fixtures'

// Chat messages PR (plan "chat messages"): the chat panel's message list
// (acceptance criteria 13 to 19, 29 to 33).

// A fixed clock, so “5 minutes ago” is the same every time.
let layout: ReturnType<typeof stubLayout>
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
  layout = stubLayout()
})
afterEach(() => {
  layout.restore()
  vi.useRealTimers()
})

// `count` messages called m001, m002, ..., a minute apart, oldest first.
function many(count: number) {
  return Array.from({ length: count }, (_, i) =>
    message(`m${String(i + 1).padStart(3, '0')}`, {
      createdAt: ago((count - i) * MINUTE),
    }),
  )
}

function shown(list: HTMLElement) {
  return within(list)
    .queryAllByText(/^m\d{3}$/)
    .map((e) => e.textContent)
}

describe('The message list', () => {
  // 13
  it('no longer says messages are coming soon, and shows the chat’s messages oldest first', async () => {
    openChat({
      messages: [
        message('First words', { createdAt: ago(30 * MINUTE) }),
        message('Second words', { createdAt: ago(20 * MINUTE), author: ben }),
        message('Third words', { createdAt: ago(10 * MINUTE) }),
      ],
    })

    const list = await messageList()

    expect(await within(list).findByText('First words')).toBeInTheDocument()
    expect(chatPanel()).not.toHaveTextContent('Messages are coming soon')
    expect(list.textContent).toMatch(/First words.*Second words.*Third words/s)
  })

  // 13
  it('says "No messages yet" when the chat has none', async () => {
    openChat({ messages: [] })

    const list = await messageList()

    expect(await within(list).findByText('No messages yet')).toBeInTheDocument()
  })

  // 14
  it('shows the author’s name, the time as “5 minutes ago” with the exact time, and the body', async () => {
    openChat({
      messages: [
        message('Ship it', { createdAt: ago(5 * MINUTE), author: ben }),
      ],
    })
    await messageList()
    await screen.findByText('Ship it')

    const item = messageWith('Ship it')

    expect(within(item).getByText('Ben')).toBeInTheDocument()
    const time = item.querySelector('time')!
    expect(time).toHaveAttribute('datetime', ago(5 * MINUTE))
    expect(time).toHaveTextContent('5 minutes ago')
    // The exact time in the viewer’s zone: on hover and for screen readers.
    expect(time.getAttribute('title')).toMatch(
      /^\d{1,2} \w{3} 2026, \d\d:\d\d$/,
    )
    expect(time.textContent).toContain(time.getAttribute('title')!)
  })

  // 14
  it('says “just now” for a message sent seconds ago', async () => {
    openChat({ messages: [message('Hi', { createdAt: ago(10_000) })] })
    await messageList()
    await screen.findByText('Hi')

    expect(messageWith('Hi').querySelector('time')).toHaveTextContent(
      'just now',
    )
  })

  // 14
  it('shows the body as formatted Markdown: bold, italic, code, lists and links', async () => {
    openChat({
      messages: [
        message(
          'Some **bold**, *italic* and `code`\n\n- first item\n- second item\n\n1. step one\n2. step two\n\n[the docs](https://example.com/docs)',
        ),
      ],
    })
    await messageList()

    expect((await screen.findByText('bold')).tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
    const item = messageWith('bold')
    expect(
      within(item)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['first item', 'second item', 'step one', 'step two'])
    expect(
      within(item).getByRole('link', { name: 'the docs' }),
    ).toHaveAttribute('href', 'https://example.com/docs')
    // The Markdown marks themselves are not shown.
    expect(item).not.toHaveTextContent('**')
  })

  // 15
  it('shows the name and time only on the first of several messages by one person within 5 minutes', async () => {
    openChat({
      messages: [
        message('a1', { createdAt: ago(20 * MINUTE) }),
        message('a2', { createdAt: ago(18 * MINUTE) }), // grouped with a1
        message('b1', { createdAt: ago(15 * MINUTE), author: ben }),
        message('a3', { createdAt: ago(14 * MINUTE) }), // Ben came in between
        message('a4', { createdAt: ago(5 * MINUTE) }), // 9 minutes after a3
        message('a5', { createdAt: ago(1 * MINUTE) }), // 4 minutes after a4
      ],
    })
    await messageList()
    await screen.findByText('a5')

    const named = (text: string) =>
      within(messageWith(text)).queryByText(/^(Ana|Ben)$/) !== null
    expect(
      ['a1', 'a2', 'b1', 'a3', 'a4', 'a5'].map((text) => [text, named(text)]),
    ).toEqual([
      ['a1', true],
      ['a2', false],
      ['b1', true],
      ['a3', true],
      ['a4', true],
      ['a5', false],
    ])
    // The grouped message has no time line of its own, but its exact time
    // stays there for screen readers.
    const grouped = messageWith('a2')
    expect(grouped).not.toHaveTextContent('minutes ago')
    expect(grouped.querySelector('time')).toHaveTextContent(
      /\d{1,2} \w{3} 2026/,
    )
    expect(messageWith('a1')).toHaveTextContent('20 minutes ago')
  })

  // 16
  it('marks an edited message with "(edited)"', async () => {
    openChat({
      messages: [
        message('Fixed words', { editedAt: ago(2 * MINUTE) }),
        message('Plain words', { createdAt: ago(1 * MINUTE), author: ben }),
      ],
    })
    await messageList()
    await screen.findByText('Plain words')

    expect(messageWith('Fixed words')).toHaveTextContent('(edited)')
    expect(messageWith('Plain words')).not.toHaveTextContent('(edited)')
  })

  // 17
  it('shows a deleted message crossed out, with who deleted it and when, and no menu', async () => {
    openChat({
      messages: [
        message('Oops wrong chat', {
          createdAt: ago(20 * MINUTE),
          deletedAt: ago(5 * MINUTE),
          deletedBy: ben,
        }),
        message('My own mistake', {
          createdAt: ago(10 * MINUTE),
          author: ben,
          deletedAt: ago(2 * MINUTE),
          deletedBy: ben,
        }),
      ],
    })
    await messageList()
    await screen.findByText('My own mistake')

    const item = messageWith('Oops wrong chat')
    expect(item.querySelector('del')).toHaveTextContent('Oops wrong chat')
    expect(item).toHaveTextContent('Deleted by Ben, 5 minutes ago')
    // Ana is a project admin, but a deleted message has no menu for anyone.
    expect(
      within(chatPanel()).queryByRole('button', { name: 'Message options' }),
    ).not.toBeInTheDocument()
  })

  // 17
  it('has no menu on a deleted message of the viewer’s own', async () => {
    openChat({
      me: ben,
      messages: [
        message('Gone', {
          author: ben,
          deletedAt: ago(MINUTE),
          deletedBy: ben,
        }),
      ],
    })
    await messageList()
    await screen.findByText('Gone')

    expect(
      within(chatPanel()).queryByRole('button', { name: 'Message options' }),
    ).not.toBeInTheDocument()
  })
})

describe('Card numbers in a message (criterion 18)', () => {
  const body = 'See WEB-12, the old OLD-3, the missing WEB-99 and OTH-3.'

  // 18
  it('turns a number of this project, old numbers included, into a link once the card is found', async () => {
    const { numbersAsked, queryClient } = openChat({
      messages: [message(body)],
    })
    await messageList()

    expect(
      await screen.findByRole('link', { name: 'WEB-12' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: 'OLD-3' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(numbersAsked).toContain('WEB-12')
    expect(numbersAsked).toContain('OLD-3')
  })

  // 18
  it('leaves a number that is not found, or from another project, as plain text', async () => {
    const { queryClient } = openChat({ messages: [message(body)] })
    await messageList()
    await screen.findByRole('link', { name: 'WEB-12' })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))

    const item = messageWith(/the missing/)
    expect(within(item).queryByRole('link', { name: 'WEB-99' })).toBeNull()
    expect(within(item).queryByRole('link', { name: 'OTH-3' })).toBeNull()
    expect(item).toHaveTextContent('the missing WEB-99 and OTH-3.')
  })

  // 18
  it('opens the card’s panel when the link is clicked, and keeps the chat panel open', async () => {
    const { user, router } = openChat({ messages: [message(body)] })
    await messageList()

    await user.click(await screen.findByRole('link', { name: 'WEB-12' }))

    expect(
      await screen.findByRole('complementary', { name: 'Card WEB-12' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('complementary', { name: 'Chat: General' }),
    ).toBeInTheDocument()
    expect(currentPath(router)).toContain(`card=${login.id}`)
    expect(currentPath(router)).toContain(`chat=${general.id}`)
  })
})

describe('Links to websites in a message (criterion 19)', () => {
  // 19
  it('opens a link in a new tab, with rel="noopener noreferrer"', async () => {
    openChat({
      messages: [message('Read [the docs](https://example.com/docs) first')],
    })
    await messageList()

    const link = await screen.findByRole('link', { name: 'the docs' })

    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    const rel = (link.getAttribute('rel') ?? '').split(/\s+/)
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  // 19
  it('links http, https and mailto addresses', async () => {
    openChat({
      messages: [
        message(
          '[plain](http://example.com) [secure](https://example.com) [mail](mailto:team@example.com)',
        ),
      ],
    })
    await messageList()

    expect(await screen.findByRole('link', { name: 'plain' })).toHaveAttribute(
      'href',
      'http://example.com',
    )
    expect(screen.getByRole('link', { name: 'secure' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute(
      'href',
      'mailto:team@example.com',
    )
  })

  // 19
  it('shows a javascript: link as plain text, not as a link', async () => {
    const { container } = openChat({
      messages: [
        message(
          'Try [click me](javascript:alert(1)) and [safe](https://example.com)',
        ),
      ],
    })
    await messageList()
    await screen.findByRole('link', { name: 'safe' })

    expect(screen.queryByRole('link', { name: 'click me' })).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(messageWith(/Try/)).toHaveTextContent('click me')
  })
})

describe('Loading and scrolling (criteria 29 and 30)', () => {
  // 29
  it('loads the latest 50 and scrolls to the bottom', async () => {
    const { api } = openChat({ messages: many(120) })
    const list = await messageList()

    await within(list).findByText('m120')

    expect(shown(list)).toHaveLength(50)
    expect(shown(list)[0]).toBe('m071')
    expect(shown(list)[49]).toBe('m120')
    expect(api.gets).toHaveLength(1)
    expect(api.gets[0]!.searchParams.has('before')).toBe(false)
    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
  })

  // 29 (reviewer finding: the members arrive after the messages)
  it('still opens scrolled to the bottom when the project members load after the messages', async () => {
    const { api } = openChat({ messages: many(5) })
    server.use(
      http.get('/api/projects/:projectId/members', async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return HttpResponse.json([member(ana, 'ADMIN'), member(ben, 'MEMBER')])
      }),
    )
    const list = await messageList()
    await within(list).findByText('m005')

    expect(api.gets).toHaveLength(1)
    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
  })

  // 29
  it('loads the next 50 with "Show older messages", until there are no older ones', async () => {
    const { user, api } = openChat({ messages: many(120) })
    const list = await messageList()
    await within(list).findByText('m120')

    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Show older messages' }),
    )

    await within(list).findByText('m021')
    expect(shown(list)).toHaveLength(100)
    expect(api.gets[1]!.searchParams.get('before')).toBe(
      api.messagesOf(general.id)[70]!.id,
    )
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Show older messages' }),
    )
    await within(list).findByText('m001')
    expect(shown(list)).toHaveLength(120)
    expect(api.gets[2]!.searchParams.get('before')).toBe(
      api.messagesOf(general.id)[20]!.id,
    )
    expect(
      within(chatPanel()).queryByRole('button', {
        name: 'Show older messages',
      }),
    ).not.toBeInTheDocument()
  })

  // 29
  it('has no "Show older messages" button when everything is loaded', async () => {
    openChat({ messages: many(50) })
    const list = await messageList()
    await within(list).findByText('m050')

    expect(
      within(chatPanel()).queryByRole('button', {
        name: 'Show older messages',
      }),
    ).not.toBeInTheDocument()
  })

  // 29
  it('loads the next 50 when the list is scrolled to the top', async () => {
    const { api } = openChat({ messages: many(120) })
    const list = await messageList()
    await within(list).findByText('m120')

    scrollTo(list, 0)

    await within(list).findByText('m021')
    expect(api.gets[1]!.searchParams.get('before')).toBe(
      api.messagesOf(general.id)[70]!.id,
    )
  })

  // 29
  it('keeps the reading position when older messages are added above', async () => {
    const { user } = openChat({ messages: many(120) })
    const list = await messageList()
    await within(list).findByText('m120')
    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
    const previousFirst = messageWith('m071')
    // Back at the top, as a person is who presses the button.
    for (const element of scrollers(list)) element.scrollTop = 0
    layout.forget()
    const before = heights(list)

    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Show older messages' }),
    )
    await within(list).findByText('m021')

    await waitFor(() =>
      expect(keptPlace(list, before, layout, previousFirst)).toBe(true),
    )
  })

  // 30
  it('does not jump when new messages arrive while scrolled up; shows "New messages ↓" instead', async () => {
    const { api } = openChat({ messages: many(5) })
    const list = await messageList()
    await within(list).findByText('m005')
    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
    scrollTo(list, 0)
    layout.forget()
    expect(
      within(chatPanel()).queryByRole('button', { name: /New messages/ }),
    ).not.toBeInTheDocument()

    api.arrive(
      general.id,
      message('Fresh news', { author: ben, createdAt: ago(1000) }),
    )
    window.dispatchEvent(new Event('visibilitychange'))

    await within(list).findByText('Fresh news')
    expect(
      within(chatPanel()).getByRole('button', { name: /New messages/ }),
    ).toBeInTheDocument()
    expect(hasNotMoved(list, layout)).toBe(true)
  })

  // 30
  it('scrolls to the bottom and hides "New messages ↓" when it is pressed', async () => {
    const { user, api } = openChat({ messages: many(5) })
    const list = await messageList()
    await within(list).findByText('m005')
    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
    scrollTo(list, 0)
    api.arrive(
      general.id,
      message('Fresh news', { author: ben, createdAt: ago(1000) }),
    )
    window.dispatchEvent(new Event('visibilitychange'))
    const button = await within(chatPanel()).findByRole('button', {
      name: /New messages/,
    })
    layout.forget()

    await user.click(button)

    expect(isAtBottom(list, layout)).toBe(true)
    expect(
      within(chatPanel()).queryByRole('button', { name: /New messages/ }),
    ).not.toBeInTheDocument()
  })

  // 30
  it('scrolls new messages into view when already at the bottom, without the button', async () => {
    const { api } = openChat({ messages: many(5) })
    const list = await messageList()
    await within(list).findByText('m005')
    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
    layout.forget()

    api.arrive(
      general.id,
      message('Fresh news', { author: ben, createdAt: ago(1000) }),
    )
    window.dispatchEvent(new Event('visibilitychange'))
    await within(list).findByText('Fresh news')

    await waitFor(() => expect(isAtBottom(list, layout)).toBe(true))
    expect(
      within(chatPanel()).queryByRole('button', { name: /New messages/ }),
    ).not.toBeInTheDocument()
  })
})

describe('Reloading (criterion 31; live updates criterion 15)', () => {
  // 31, changed by the live updates PR (criterion 15): the 30-second reload
  // is gone, so a message from someone else shows when the server says so
  // (see live-updates.test.tsx), not on a timer.
  it('does not reload on a timer while the chat is open', async () => {
    const { api } = openChat({ messages: [message('Hello')] })
    const list = await messageList()
    await within(list).findByText('Hello')
    const loads = api.gets.length

    api.arrive(
      general.id,
      message('From Ben', { author: ben, createdAt: ago(1000) }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })

    expect(api.gets.length).toBe(loads)
    expect(within(list).queryByText('From Ben')).not.toBeInTheDocument()
  })

  // 31
  it('reloads when the person comes back to the browser tab', async () => {
    const { api } = openChat({ messages: [message('Hello')] })
    const list = await messageList()
    await within(list).findByText('Hello')

    api.arrive(
      general.id,
      message('From Ben', { author: ben, createdAt: ago(1000) }),
    )
    window.dispatchEvent(new Event('visibilitychange'))

    expect(await within(list).findByText('From Ben')).toBeInTheDocument()
  })
})

describe('When loading fails (criterion 32)', () => {
  // 32
  it('says "Couldn’t load the messages" with "Try again", which loads them again', async () => {
    const { user } = openChat({ messages: [message('Hello')] })
    let failed = false
    server.use(
      http.get('/api/chats/:chatId/messages', () => {
        failed = true
        return apiError(500, 'Something broke')
      }),
    )

    const alert = await within(
      await screen.findByRole('complementary', { name: /^Chat: / }),
    ).findByText(/Couldn.t load the messages/)
    expect(failed).toBe(true)
    expect(alert).toBeInTheDocument()
    // The ordinary answers again.
    const retry = within(chatPanel()).getByRole('button', {
      name: 'Try again',
    })
    expect(retry).toBeInTheDocument()
    server.use(
      http.get('/api/chats/:chatId/messages', () =>
        Response.json({ messages: [message('Back again')], hasOlder: false }),
      ),
    )
    await user.click(retry)

    expect(
      await within(chatPanel()).findByText('Back again'),
    ).toBeInTheDocument()
    expect(chatPanel()).not.toHaveTextContent(/Couldn.t load the messages/)
  })
})

describe('Accessibility of the message list (criterion 33)', () => {
  // 33
  it('has no accessibility problems with messages in every state', async () => {
    const { container } = openChat({
      messages: [
        message('Plain **words** and [a link](https://example.com)', {
          createdAt: ago(30 * MINUTE),
        }),
        message('Grouped words', { createdAt: ago(29 * MINUTE) }),
        message('Edited words', {
          author: ben,
          editedAt: ago(10 * MINUTE),
          createdAt: ago(20 * MINUTE),
        }),
        message('Deleted words', {
          createdAt: ago(15 * MINUTE),
          deletedAt: ago(5 * MINUTE),
          deletedBy: ana,
        }),
        message('See WEB-12', { createdAt: ago(2 * MINUTE) }),
      ],
    })
    await messageList()
    await screen.findByRole('link', { name: 'WEB-12' })

    await expectNoAccessibilityProblems(container)
  })

  // 33
  it('has no accessibility problems when the chat is empty or fails to load', async () => {
    const empty = openChat({ messages: [] })
    await within(await messageList()).findByText('No messages yet')
    await expectNoAccessibilityProblems(empty.container)
    empty.unmount()

    const failing = openChat({ messages: [] })
    server.use(
      http.get('/api/chats/:chatId/messages', () => apiError(500, 'Boom')),
    )
    await within(
      await screen.findByRole('complementary', { name: /^Chat: / }),
    ).findByText(/Couldn.t load the messages/)
    await expectNoAccessibilityProblems(failing.container)
  })
})

// Criteria 35 to 38 and 40 (agreed 2026-11-10, after the attack round).
describe('A message that cannot be drawn (criterion 35)', () => {
  // 35 (antagonist proof B1): a body the API used to accept (1,001
  // characters) crashed the whole board.
  it('still shows the board and the other messages when a message holds deeply nested Markdown', async () => {
    const deep = '- '.repeat(500) + 'x'
    openChat({
      messages: [
        message('Hello before', { createdAt: ago(10 * MINUTE) }),
        message(deep, { author: ben, createdAt: ago(MINUTE) }),
        message('Hello after', { createdAt: ago(MINUTE / 2) }),
      ],
    })

    const list = await messageList()

    expect(await within(list).findByText('Hello before')).toBeInTheDocument()
    expect(within(list).getByText('Hello after')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Sprint 1', level: 1 }),
    ).toBeInTheDocument()
    // The deep message shows as the text that was written.
    expect(within(list).getByText(deep)).toBeInTheDocument()
  })
})

describe('A message that takes long to draw (criterion 35)', () => {
  // 35 (antagonist proof, round 2): a body the API accepts must not freeze
  // the page for everyone. Blank lines between two words made the table check
  // take seconds (9,998 lines fit in 10,000 characters).
  it('draws a message made of many blank lines quickly', async () => {
    const started = performance.now()
    openChat({
      messages: [
        message('Hello before', { createdAt: ago(10 * MINUTE) }),
        message('a' + '\n'.repeat(2500) + 'b', {
          author: ben,
          createdAt: ago(MINUTE),
        }),
      ],
    })
    const list = await messageList()
    await within(list).findByText('Hello before')

    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('Markdown the toolbar cannot make (criterion 36)', () => {
  // The words of each body must be on the screen, whatever else is shown.
  const bodies: [string, string, string[]][] = [
    // Antagonist proof B2
    [
      'a table',
      '| Task | Who |\n|---|---|\n| Deploy | Ben |',
      ['Task', 'Deploy', 'Ben'],
    ],
    [
      'an image',
      '![diagram of the flow](https://example.com/a.png)',
      ['diagram of the flow'],
    ],
    [
      'a task list',
      '- [ ] write the docs\n- [x] ship it',
      ['write the docs', 'ship it'],
    ],
    [
      'a heading',
      '## Release notes\n\nSee below',
      ['Release notes', 'See below'],
    ],
    ['raw HTML only', '<div>Only HTML here</div>', ['Only HTML here']],
  ]

  // 36
  it.each(bodies)(
    'shows %s as the text that was written',
    async (_n, body, words) => {
      openChat({ messages: [message(body)] })
      const list = await messageList()

      await waitFor(() => expect(list.textContent?.trim()).not.toBe(''))

      for (const word of words) {
        expect(list).toHaveTextContent(word)
      }
    },
  )

  // 36
  it.each(bodies)(
    'keeps the text of a deleted message that was %s, crossed out',
    async (_n, body, words) => {
      openChat({
        messages: [message(body, { deletedAt: ago(MINUTE), deletedBy: ana })],
      })
      const list = await messageList()

      await waitFor(() => expect(list.querySelector('del')).not.toBeNull())

      for (const word of words) {
        expect(list.querySelector('del')).toHaveTextContent(word)
      }
    },
  )
})

describe('The loaded list only grows (criterion 38)', () => {
  // 38 (antagonist proof B3): a reload while you read older messages must not
  // take away the message you are reading.
  it('keeps the older messages already shown when a new message arrives on reload', async () => {
    const { user, api } = openChat({ messages: many(100) })
    const list = await messageList()
    await within(list).findByText('m100')
    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Show older messages' }),
    )
    await within(list).findByText('m001')
    scrollTo(list, 0)

    api.arrive(
      general.id,
      message('Fresh news', { author: ben, createdAt: ago(1000) }),
    )
    window.dispatchEvent(new Event('visibilitychange'))
    await within(list).findByText('Fresh news')

    expect(shown(list)).toHaveLength(100)
    expect(within(list).getByText('m001')).toBeInTheDocument()
  })
})

describe('At most 20 card-number links per message (criterion 40)', () => {
  // 40
  it('looks up and links only the first 20 different numbers; the rest stay plain text', async () => {
    const numbers = Array.from({ length: 21 }, (_, i) => `WEB-${101 + i}`)
    // The first number again at the end does not count as a new one.
    const body = `${numbers.join(' ')} and ${numbers[0]} once more`
    const { queryClient, numbersAsked } = openChat({
      messages: [message(body)],
    })
    // Every number is a card of this project, so only the limit can keep a
    // number from becoming a link.
    server.use(
      http.get('/api/cards/by-number/:number', ({ params }) => {
        numbersAsked.push(String(params.number))
        return HttpResponse.json({ ...login, boardId: sprint.id })
      }),
    )
    numbersAsked.length = 0
    await messageList()

    await screen.findAllByRole('link', { name: 'WEB-101' })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))

    expect(new Set(numbersAsked)).toEqual(new Set(numbers.slice(0, 20)))
    expect(numbersAsked).toHaveLength(20)
    expect(screen.getAllByRole('link', { name: 'WEB-120' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'WEB-121' })).toBeNull()
    expect(messageWith(/WEB-121/)).toHaveTextContent('WEB-121')
  })
})

describe('Former member (criterion 41)', () => {
  // 41
  it('shows "Former member" as the name of an author whose account was deleted', async () => {
    openChat({ messages: [message('Words from long ago', { author: null })] })
    await messageList()
    await screen.findByText('Words from long ago')

    expect(
      within(messageWith('Words from long ago')).getByText('Former member'),
    ).toBeInTheDocument()
  })

  // 41
  it('shows "Deleted by Former member" when the deleter’s account was deleted', async () => {
    openChat({
      messages: [
        message('Gone words', {
          deletedAt: ago(5 * MINUTE),
          deletedBy: null,
          createdAt: ago(20 * MINUTE),
        }),
      ],
    })
    await messageList()
    await screen.findByText('Gone words')

    expect(messageWith('Gone words')).toHaveTextContent(
      'Deleted by Former member, 5 minutes ago',
    )
  })
})
