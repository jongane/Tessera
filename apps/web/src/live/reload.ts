import type { Message, MessagePage } from '@tessera/shared'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { checklistsBusy } from '../api/checklists'
import {
  boardEditKey,
  boardKey,
  chatsKey,
  messagesKey,
} from '../api/query-keys'
import { ticksBusy } from '../api/subtasks'
import type { LiveSignal } from './live-connection'

// What to reload when the server says something changed. A signal only says
// what changed; each reload goes through the API as usual. Reloading marks
// the data stale, and what is on screen loads again.

type Pages = InfiniteData<MessagePage, string>

// The open card's own data: Time, Activity and the like.
function isCardData(key: readonly unknown[], cardId: string) {
  return key[0] === 'cards' && key[1] === cardId
}

// A card's checklists or subtasks, kept under the board's key.
function inBoardKey(key: readonly unknown[], boardId: string) {
  return key[0] === 'boards' && key[1] === boardId
}

// A reload must not undo a change still being saved (docs/web-app.md,
// section 5): the change reloads when it has settled.
function beingSaved(queryClient: QueryClient, key: readonly unknown[]) {
  const cardId = key[3] as string
  return (
    (key[2] === 'checklists' && checklistsBusy(queryClient, cardId)) ||
    (key[2] === 'subtasks' && ticksBusy(queryClient, cardId))
  )
}

function reloadCard(queryClient: QueryClient, boardId: string, cardId: string) {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      isCardData(queryKey, cardId) ||
      (inBoardKey(queryKey, boardId) &&
        (queryKey[2] === 'checklists' || queryKey[2] === 'subtasks') &&
        queryKey[3] === cardId &&
        !beingSaved(queryClient, queryKey)),
  })
}

// The open card's parents, subtasks and siblings, kept under the board's key.
function reloadRelatives(queryClient: QueryClient, boardId: string) {
  return queryClient.invalidateQueries({
    queryKey: [...boardKey(boardId), 'relatives'],
  })
}

// A signal from someone else. `openCardId` is the card open in the panel,
// if any.
export function reloadForSignal(
  queryClient: QueryClient,
  signal: LiveSignal,
  openCardId: string | null,
) {
  const { boardId } = signal
  switch (signal.type) {
    case 'board':
    case 'card':
      // Our own edit or move is still being saved: it reloads the board
      // when it has settled, with their change too.
      if (queryClient.isMutating({ mutationKey: boardEditKey(boardId) }) > 0) {
        return
      }
      // Only the board: its chats have their own signal.
      void queryClient.invalidateQueries({
        queryKey: boardKey(boardId),
        exact: true,
      })
      void reloadRelatives(queryClient, boardId)
      if (signal.type === 'card' && signal.cardId === openCardId) {
        void reloadCard(queryClient, boardId, signal.cardId)
      }
      return
    case 'chats':
      void queryClient.invalidateQueries({ queryKey: chatsKey(boardId) })
      return
    case 'message':
      if (signal.chatId && signal.messageId) {
        void reloadMessage(queryClient, signal.chatId, signal.messageId)
      }
  }
}

// The connection is back after a break: everything on screen loads once,
// to catch up with what changed meanwhile.
export function reloadEverything(queryClient: QueryClient, boardId: string) {
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      !beingSaved(queryClient, queryKey) &&
      (inBoardKey(queryKey, boardId) ||
        queryKey[0] === 'cards' ||
        queryKey[0] === 'chats'),
  })
}

// A message that is new, or is on the latest page, comes with a reload of the
// chat. An older one kept on screen is fetched on its own and replaced in
// place, so the pages shown stay as they are.
async function reloadMessage(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
) {
  const key = messagesKey(chatId)
  const shown = queryClient.getQueryData<Pages>(key)
  const isOlder =
    shown?.pages
      .slice(1)
      .some((page) => page.messages.some((m) => m.id === messageId)) ?? false
  if (!isOlder) {
    void queryClient.invalidateQueries({ queryKey: key })
    return
  }
  try {
    const fresh = await api<Message>(`/messages/${messageId}`)
    queryClient.setQueryData<Pages>(
      key,
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            messages: page.messages.map((m) => (m.id === fresh.id ? fresh : m)),
          })),
        },
    )
  } catch {
    // The next reload brings it.
  }
}
