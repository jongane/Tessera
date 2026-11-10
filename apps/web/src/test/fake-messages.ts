import type { Me, Message } from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { ana, apiError } from './server'

// The fake API's chat messages, for the chat panel's tests. The shapes follow
// the plan "chat messages" (API section): GET answers `{ messages, hasOlder }`
// with the newest 50, oldest first, and `?before=<messageId>` the 50 before
// that message. A chat's messages are listed oldest first.

const PAGE = 50

let nextId = 1
function id(): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${String(nextId++).padStart(12, '0')}`
}

type Person = Pick<Me, 'id' | 'displayName'>

function who(person: Person): Person {
  return { id: person.id, displayName: person.displayName }
}

// A message by Ana unless a test says otherwise (null is a deleted account).
// `chatId` is filled in when the fake API takes it.
export function message(
  body: string,
  fields: Partial<Omit<Message, 'author' | 'deletedBy' | 'body'>> & {
    author?: Person | null
    deletedBy?: Person | null
  } = {},
): Message {
  const { author, deletedBy, ...rest } = fields
  return {
    id: id(),
    chatId: '',
    body,
    createdAt: '2026-11-09T22:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    ...rest,
    author: author === undefined ? who(ana) : author && who(author),
    deletedBy: deletedBy ? who(deletedBy) : null,
  }
}

// Answers the messages of the chats in `start` (by chat id, each oldest
// first) and remembers changes: a sent message is added, an edit or a delete
// is kept, so a reload shows what was saved. `gets` lists the address of every
// list request; `changes` every change sent, as "METHOD /path" with its body.
export function fakeMessages(
  start: Record<string, Message[]>,
  { me = ana }: { me?: Person } = {},
) {
  const chats: Record<string, Message[]> = Object.fromEntries(
    Object.entries(start).map(([chatId, list]) => [
      chatId,
      list.map((m) => ({ ...structuredClone(m), chatId })),
    ]),
  )
  // Sending waits for this before the server answers, so a test can look at a
  // message that is still being sent.
  let gate: Promise<void> = Promise.resolve()
  const gets: URL[] = []
  const changes: { request: string; body: unknown }[] = []

  function find(messageId: string) {
    return Object.values(chats)
      .flat()
      .find((m) => m.id === messageId)
  }

  const handlers = [
    http.get('/api/chats/:chatId/messages', ({ request, params }) => {
      const url = new URL(request.url)
      gets.push(url)
      const all = chats[String(params.chatId)] ?? []
      const before = url.searchParams.get('before')
      const end =
        before === null ? all.length : all.findIndex((m) => m.id === before)
      if (end === -1) return apiError(404, 'Message not found')
      const from = Math.max(0, end - PAGE)
      return HttpResponse.json({
        messages: all.slice(from, end),
        hasOlder: from > 0,
      })
    }),
    http.post('/api/chats/:chatId/messages', async ({ request, params }) => {
      const body = (await request.json()) as { body: string; id?: string }
      changes.push({
        request: `POST /api/chats/${String(params.chatId)}/messages`,
        body,
      })
      await gate
      // The same id from the same author is answered with the message again.
      const same = body.id ? find(body.id) : undefined
      if (same) return HttpResponse.json(same, { status: 200 })
      const created = message(body.body.trim(), {
        createdAt: new Date().toISOString(),
        author: me,
      })
      if (body.id) created.id = body.id
      created.chatId = String(params.chatId)
      ;(chats[created.chatId] ??= []).push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch('/api/messages/:messageId', async ({ request, params }) => {
      const body = (await request.json()) as { body: string }
      changes.push({
        request: `PATCH /api/messages/${String(params.messageId)}`,
        body,
      })
      const found = find(String(params.messageId))
      if (!found) return apiError(404, 'Message not found')
      found.body = body.body.trim()
      found.editedAt = new Date().toISOString()
      return HttpResponse.json(found)
    }),
    http.delete('/api/messages/:messageId', ({ params }) => {
      changes.push({
        request: `DELETE /api/messages/${String(params.messageId)}`,
        body: undefined,
      })
      const found = find(String(params.messageId))
      if (!found) return apiError(404, 'Message not found')
      found.deletedAt = new Date().toISOString()
      found.deletedBy = who(me)
      return HttpResponse.json(found)
    }),
  ]

  return {
    handlers,
    gets,
    changes,
    // Makes sending wait until the returned function is called.
    hold: () => {
      let release!: () => void
      gate = new Promise<void>((resolve) => (release = resolve))
      return release
    },
    // What the server holds for a chat, oldest first.
    messagesOf: (chatId: string) => chats[chatId] ?? [],
    // A message that arrived from someone else, seen at the next reload.
    arrive: (chatId: string, sent: Message) => {
      ;(chats[chatId] ??= []).push({ ...sent, chatId })
    },
  }
}
