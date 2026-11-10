import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ago,
  messageList,
  messageWith,
  MINUTE,
  openChat,
} from '../test/chat-panel'
import { ben } from '../test/fake-board'
import { message } from '../test/fake-messages'

// Chat messages PR, criterion 35 (agreed 2026-11-10): each message is drawn
// inside its own error boundary. Whatever makes a message's drawing fail, here
// forced for any body holding BREAKS, only that message falls back to its
// written text.
vi.mock('./message-markdown', async (importOriginal) => {
  const real = await importOriginal<typeof import('./message-markdown')>()
  return {
    ...real,
    MessageBody: (props: Parameters<typeof real.MessageBody>[0]) => {
      if (props.markdown.includes('BREAKS')) {
        throw new Error('This message cannot be drawn')
      }
      return real.MessageBody(props)
    },
  }
})

beforeEach(() => {
  // A fixed clock, so “5 minutes ago” is the same every time.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
  // React logs every error that reaches a boundary.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('A message whose drawing throws (criterion 35)', () => {
  // The forced failure leaves every other message drawn as usual.
  it('still draws an ordinary message as formatted Markdown', async () => {
    openChat({ messages: [message('An **ordinary** message')] })
    await messageList()

    expect((await screen.findByText('ordinary')).tagName).toBe('STRONG')
  })

  // 35
  it('shows its body as plain written text, and the rest of the chat and board keep working', async () => {
    openChat({
      messages: [
        message('Before it', { createdAt: ago(10 * MINUTE) }),
        message('BREAKS with **stars** and `ticks`', {
          author: ben,
          createdAt: ago(5 * MINUTE),
        }),
        message('After it', { createdAt: ago(MINUTE) }),
      ],
    })

    const list = await messageList()

    expect(await within(list).findByText('Before it')).toBeInTheDocument()
    expect(within(list).getByText('After it')).toBeInTheDocument()
    // Written text, Markdown marks and all.
    expect(
      within(messageWith(/BREAKS/)).getByText(
        'BREAKS with **stars** and `ticks`',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Sprint 1', level: 1 }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('complementary', { name: 'Chat: General' }),
    ).toBeInTheDocument()
  })

  // 35
  it('keeps the name and time of the message that fell back', async () => {
    openChat({
      messages: [
        message('BREAKS here', { author: ben, createdAt: ago(5 * MINUTE) }),
      ],
    })
    await messageList()
    await screen.findByText('BREAKS here')

    const item = messageWith('BREAKS here')
    expect(within(item).getByText('Ben')).toBeInTheDocument()
    expect(item).toHaveTextContent('5 minutes ago')
  })
})
