import type { Chat, Message } from '@tessera/shared'
import { useLayoutEffect, useRef, useState, type UIEvent } from 'react'
import { useMe } from '../api/auth'
import { useMembers } from '../api/members'
import { useMessages, useSendMessage } from '../api/messages'
import { useEveryMinute } from '../cards/clock'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { MessageComposer } from './MessageComposer'
import { MessageItem, type Outgoing } from './MessageItem'
import {
  type MessageOutbox,
  type OutgoingMessage,
  useOutgoing,
} from './message-outbox'
import { COULDNT_SEND, followsOnFrom, refusalOr } from './message-text'

const LOAD_FAILED = 'Couldn’t load the messages'

// How close to the end counts as being at the bottom, in pixels.
const NEAR_BOTTOM = 40
// How close to the top starts loading older messages, in pixels.
const NEAR_TOP = 8

interface Row {
  message: Message
  outgoing?: Outgoing
}

// A chat's messages, oldest at the top and newest at the bottom, with the
// message box under them (docs/web-app.md, section 3).
export default function ChatMessages({
  chat,
  projectId,
  outbox,
}: {
  chat: Chat
  projectId: string
  outbox: MessageOutbox
}) {
  const me = useMe().data ?? null
  const members = useMembers(projectId)
  const messages = useMessages(chat.id)
  const outgoing = useOutgoing(outbox, chat.id)
  const saveNew = useSendMessage(chat.id)
  const now = useEveryMinute()
  const scroller = useRef<HTMLDivElement>(null)
  // Whether the person is reading the newest messages.
  const atBottom = useRef(true)
  const [newBelow, setNewBelow] = useState(false)
  // Where the list was when older messages were asked for.
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const seen = useRef<{ first?: string; last?: string } | null>(null)

  function post(entry: OutgoingMessage) {
    outbox.update(entry, { status: 'sending', error: undefined })
    saveNew(entry.body, (shown) =>
      // Without a loaded list the saved message stays here until a reload.
      shown ? outbox.remove(entry) : outbox.update(entry, { status: 'saved' }),
    ).catch((error: unknown) =>
      outbox.update(entry, {
        status: 'failed',
        error: refusalOr(error, COULDNT_SEND),
      }),
    )
  }

  function send(body: string) {
    atBottom.current = true
    post(outbox.add(chat.id, body))
  }

  const isAdmin =
    members.data?.find((member) => member.userId === me?.id)?.role === 'ADMIN'
  const rows: Row[] = [
    ...[...(messages.data?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.messages)
      .map((message) => ({ message })),
    ...outgoing.map((entry) => ({
      message: {
        id: entry.id,
        chatId: entry.chatId,
        body: entry.body,
        createdAt: entry.createdAt,
        editedAt: null,
        deletedAt: null,
        author: me && { id: me.id, displayName: me.displayName },
        deletedBy: null,
      },
      outgoing: {
        status: entry.status,
        error: entry.error,
        onRetry: () => post(entry),
      },
    })),
  ]
  // The list appears once the messages and the members are loaded.
  const listShown = messages.data !== undefined && !members.isPending
  const firstId = rows[0]?.message.id
  const lastRow = rows[rows.length - 1]?.message

  function scrollToBottom() {
    const list = scroller.current
    if (list) {
      list.scrollTop = list.scrollHeight
    }
    atBottom.current = true
    setNewBelow(false)
  }

  // Keeps the place being read: the bottom stays in view, older messages
  // added above leave the same text on screen, and new messages out of view
  // are offered with a button instead.
  useLayoutEffect(() => {
    const list = scroller.current
    const before = seen.current
    if (!list) {
      return
    }
    seen.current = { first: firstId, last: lastRow?.id }
    if (before === null) {
      scrollToBottom()
      return
    }
    if (anchor.current && firstId !== before.first) {
      list.scrollTop =
        anchor.current.top + list.scrollHeight - anchor.current.height
      anchor.current = null
    }
    if (lastRow && lastRow.id !== before.last) {
      if (atBottom.current || lastRow.author?.id === me?.id) {
        scrollToBottom()
      } else {
        setNewBelow(true)
      }
    }
    // scrollToBottom only uses refs and a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId, lastRow?.id, listShown])

  function loadOlder() {
    const list = scroller.current
    if (list) {
      anchor.current = { height: list.scrollHeight, top: list.scrollTop }
    }
    void messages.fetchNextPage()
  }

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const list = event.currentTarget
    atBottom.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM
    if (atBottom.current) {
      setNewBelow(false)
    }
    if (
      list.scrollTop < NEAR_TOP &&
      messages.hasNextPage &&
      !messages.isFetchingNextPage
    ) {
      loadOlder()
    }
  }

  const log = (
    <div role="log" aria-label="Messages">
      {rows.length === 0 ? (
        <p className="text-muted">No messages yet</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {rows.map((row, index) => {
            const { message } = row
            const mine = me != null && message.author?.id === me.id
            return (
              <MessageItem
                key={message.id}
                message={message}
                projectId={projectId}
                now={now}
                showHeader={!followsOnFrom(message, rows[index - 1]?.message)}
                canEdit={mine && !row.outgoing}
                canDelete={(mine || isAdmin) && !row.outgoing}
                outgoing={row.outgoing}
              />
            )
          })}
        </ol>
      )}
    </div>
  )

  let body
  if (messages.data === undefined || members.isPending) {
    body = messages.isError ? (
      <div className="flex flex-col items-start gap-2 p-3">
        <Alert>{LOAD_FAILED}</Alert>
        <Button variant="secondary" onClick={() => void messages.refetch()}>
          Try again
        </Button>
        {rows.length > 0 && log}
      </div>
    ) : (
      <Loading />
    )
  } else {
    body = (
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          tabIndex={0}
          onScroll={onScroll}
          className="flex h-full flex-col gap-2 overflow-y-auto p-3"
        >
          {messages.isError && <Alert>{LOAD_FAILED}</Alert>}
          {messages.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              disabled={messages.isFetchingNextPage}
              onClick={loadOlder}
            >
              Show older messages
            </Button>
          )}
          {log}
        </div>
        {newBelow && (
          <Button
            className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-lg"
            onClick={scrollToBottom}
          >
            New messages ↓
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {body}
      <div className="border-t border-line p-3">
        <MessageComposer chatId={chat.id} outbox={outbox} onSend={send} />
      </div>
    </div>
  )
}
