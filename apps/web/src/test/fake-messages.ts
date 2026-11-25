import type { FileInfo, Me, Message } from '@tessera/shared'
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
    files: [],
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
  {
    me = ana,
    pendingFiles = [],
    holdPendingList = false,
  }: {
    me?: Person
    pendingFiles?: FileInfo[]
    holdPendingList?: boolean
  } = {},
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
  // While set, the list of the person's pending files is not answered yet.
  let releaseList: () => void = () => {}
  let listGate: Promise<void> | null = holdPendingList
    ? new Promise<void>((resolve) => (releaseList = resolve))
    : null
  const gets: URL[] = []
  // Every request for the person's pending files of a chat.
  const fileGets: URL[] = []
  // The id of every message asked for on its own (GET /api/messages/:id).
  const fetched: string[] = []
  const changes: { request: string; body: unknown }[] = []
  // Pending files the server holds (uploaded from the message box, not sent
  // yet), by id. A test adds one when it answers a fake upload with 201.
  const pending = new Map<string, FileInfo>(
    pendingFiles.map((file) => [file.id, file]),
  )
  // What removing a message's file answers instead of 204.
  const fileRemoval: { fails: { status: number; message: string } | null } = {
    fails: null,
  }

  function find(messageId: string) {
    return Object.values(chats)
      .flat()
      .find((m) => m.id === messageId)
  }

  const handlers = [
    // The person's own pending files in a chat, oldest first (the order they
    // were uploaded in, which is the order they were added here).
    http.get('/api/chats/:chatId/files', async ({ request, params }) => {
      fileGets.push(new URL(request.url))
      if (listGate) await listGate
      return HttpResponse.json({
        files: [...pending.values()].filter(
          (file) => file.chatId === String(params.chatId),
        ),
      })
    }),
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
    http.get('/api/messages/:messageId', ({ params }) => {
      fetched.push(String(params.messageId))
      const found = find(String(params.messageId))
      return found
        ? HttpResponse.json(found)
        : apiError(404, 'Message not found')
    }),
    http.post('/api/chats/:chatId/messages', async ({ request, params }) => {
      const body = (await request.json()) as {
        body: string
        id?: string
        fileIds?: string[]
      }
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
      created.files = (body.fileIds ?? []).map((fileId) => ({
        ...pending.get(fileId)!,
        messageId: created.id,
        chatId: created.chatId,
        pending: false,
      }))
      for (const fileId of body.fileIds ?? []) pending.delete(fileId)
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
      found.files = []
      return HttpResponse.json(found)
    }),
    // A chip's Remove: only the person's own pending file of that chat is
    // deleted. A file already sent answers 409 and stays; anything else is
    // "File not found".
    http.delete('/api/chats/:chatId/files/:fileId', ({ params }) => {
      const fileId = String(params.fileId)
      changes.push({
        request: `DELETE /api/chats/${String(params.chatId)}/files/${fileId}`,
        body: undefined,
      })
      const sent = Object.values(chats)
        .flat()
        .some((m) => m.files.some((f) => f.id === fileId))
      if (sent) return apiError(409, 'This file was already sent')
      if (!pending.has(fileId)) return apiError(404, 'File not found')
      pending.delete(fileId)
      return new HttpResponse(null, { status: 204 })
    }),
    // Removing one file of a message, or a pending file. Any other file is
    // left to the next handler (a card's file).
    http.delete('/api/files/:fileId', ({ params }) => {
      const fileId = String(params.fileId)
      const holder = Object.values(chats)
        .flat()
        .find((m) => m.files.some((f) => f.id === fileId))
      if (!holder && !pending.has(fileId)) return undefined
      changes.push({ request: `DELETE /api/files/${fileId}`, body: undefined })
      if (fileRemoval.fails) {
        return apiError(fileRemoval.fails.status, fileRemoval.fails.message)
      }
      if (holder) holder.files = holder.files.filter((f) => f.id !== fileId)
      pending.delete(fileId)
      return new HttpResponse(null, { status: 204 })
    }),
  ]

  return {
    handlers,
    gets,
    fileGets,
    // The list of pending files is answered from now on.
    releasePendingList: () => {
      releaseList()
      listGate = null
    },
    fetched,
    changes,
    // Makes sending wait until the returned function is called.
    hold: () => {
      let release!: () => void
      gate = new Promise<void>((resolve) => (release = resolve))
      return release
    },
    // The server now holds this pending file (its upload was answered).
    hasPending: (file: FileInfo) => void pending.set(file.id, file),
    pending,
    // Removing a file of a message fails with this answer, until null.
    failFileRemoval: (answer: { status: number; message: string } | null) => {
      fileRemoval.fails = answer
    },
    // What the server holds for a chat, oldest first.
    messagesOf: (chatId: string) => chats[chatId] ?? [],
    // Someone else edited a message, seen at the next reload.
    edit: (messageId: string, body: string) => {
      const found = find(messageId)!
      found.body = body
      found.editedAt = new Date().toISOString()
    },
    // Someone else deleted a message, seen at the next reload.
    remove: (messageId: string, by: Person) => {
      const found = find(messageId)!
      found.deletedAt = new Date().toISOString()
      found.deletedBy = who(by)
    },
    // A message that arrived from someone else, seen at the next reload.
    arrive: (chatId: string, sent: Message) => {
      ;(chats[chatId] ??= []).push({ ...sent, chatId })
    },
  }
}
