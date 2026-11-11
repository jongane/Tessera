import type { Chat } from '@tessera/shared'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { fakeBoard, type FakeBoardOptions } from './fake-board'
import { fakeMessages } from './fake-messages'
import { boardCard, boardColumn, boardView, sprint } from './fixtures'
import { renderApp } from './render'
import { ana, apiError, server } from './server'
import type { Message } from '@tessera/shared'

// Helpers for the chat messages' tests: the board opened on a chat.

export const boardPath = `/WEB/boards/${sprint.id}`

export const general: Chat = {
  id: '55555555-5555-4555-8555-000000000001',
  boardId: sprint.id,
  cardId: null,
  kind: 'GENERAL',
  title: 'General',
  createdAt: '2026-10-30T09:00:00.000Z',
}

export const releasePlan: Chat = {
  ...general,
  id: '55555555-5555-4555-8555-000000000002',
  kind: 'TOPIC',
  title: 'Release plan',
}

export const login = boardCard('12', 'Login page', {
  chatId: '55555555-5555-4555-8555-000000000012',
})

// The fixed clock of these tests.
export const NOW = '2026-11-09T22:30:00.000Z'

// ISO text for a moment `ms` before the fixed clock.
export function ago(ms: number) {
  return new Date(Date.parse(NOW) - ms).toISOString()
}
export const MINUTE = 60_000

// Opens the board with the chat panel open on `chat` (the general chat unless
// said otherwise). `messages` are the general chat's; `other` are the Release
// plan chat's. Ana is the project's admin and Ben a plain member.
export function openChat({
  messages = [],
  other = [],
  chat = general,
  ...options
}: FakeBoardOptions & {
  messages?: Message[]
  other?: Message[]
  chat?: Chat
} = {}) {
  const me = options.me ?? ana
  const board = fakeBoard(boardView([boardColumn('To do', [login])]), {
    ...options,
    chats: [general, releasePlan],
  })
  const api = fakeMessages(
    { [general.id]: messages, [releasePlan.id]: other },
    { me },
  )
  server.use(...api.handlers)
  // A card number is found by its number, as the real API does: WEB-12 and
  // its old number OLD-3 are this project's card, WEB-99 does not exist and
  // OTH-3 is a card of another project. `numbersAsked` lists what was looked up.
  const numbersAsked: string[] = []
  server.use(
    http.get('/api/cards/by-number/:number', ({ params }) => {
      const number = String(params.number)
      numbersAsked.push(number)
      if (number === 'WEB-12' || number === 'OLD-3') {
        return HttpResponse.json({ ...login, boardId: sprint.id })
      }
      if (number === 'OTH-3') {
        return HttpResponse.json({
          ...login,
          number: 'OTH-3',
          projectId: '99999999-9999-4999-8999-999999999999',
        })
      }
      return apiError(404, 'Card not found')
    }),
  )
  const app = renderApp(`${boardPath}?chat=${chat.id}`)
  return { ...app, board, api, numbersAsked }
}

export function chatPanel() {
  return screen.getByRole('complementary', { name: /^Chat: / })
}

// The message list, once the messages are loaded.
export async function messageList() {
  return within(
    await screen.findByRole('complementary', { name: /^Chat: / }),
  ).findByRole('log', { name: 'Messages' })
}

// The message that holds `node`: the outermost list item or article inside
// the message list that contains it.
export function messageOf(node: HTMLElement): HTMLElement {
  const list = within(chatPanel()).getByRole('log', { name: 'Messages' })
  let found: HTMLElement | null = null
  for (
    let current: HTMLElement | null = node;
    current && current !== list;
    current = current.parentElement
  ) {
    if (current.matches('li, article')) found = current
  }
  if (!found) throw new Error('That is not inside a message')
  return found
}

// The message that holds `text`.
export function messageWith(text: string | RegExp): HTMLElement {
  const list = within(chatPanel()).getByRole('log', { name: 'Messages' })
  return messageOf(within(list).getByText(text))
}

export function messageBox() {
  return within(chatPanel()).getByRole('textbox', { name: 'Message' })
}

// Types into a rich-text box from the keyboard (in jsdom every element sits
// at 0,0, so a click would not move the focus).
export async function typeInto(
  user: ReturnType<typeof renderApp>['user'],
  box: HTMLElement,
  text: string,
) {
  box.focus()
  await user.type(box, text, { skipClick: true })
}

// Opens a Radix menu from the keyboard, as the other tests do.
export async function openMenu(
  user: ReturnType<typeof renderApp>['user'],
  button: HTMLElement,
) {
  button.focus()
  await user.keyboard('{Enter}')
}
