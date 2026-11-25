import type {
  FileInfo,
  Message,
  MessageBodyRequest,
  MessagePage,
  NewMessageBody,
} from '@tessera/shared'
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  replaceEqualDeep,
  useQueryClient,
} from '@tanstack/react-query'
import { cardFilesKey } from './files'
import { api } from './client'
import { messagesKey } from './query-keys'

type Pages = InfiniteData<MessagePage, string>

// A chat's messages: the newest page first; `fetchNextPage` adds the next,
// older one. A reload (when the server says a message changed, on coming
// back to the tab, after your own change) loads every page that is shown
// again, from the newest.
export function useMessages(chatId: string) {
  return useInfiniteQuery({
    queryKey: messagesKey(chatId),
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        `/chats/${chatId}/messages${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    // The next page is the one just before the oldest message shown.
    getNextPageParam: (oldest) =>
      oldest.hasOlder ? oldest.messages[0]?.id : undefined,
    // A reload never takes away a message already shown.
    structuralSharing: keepShown,
  })
}

// Shows a message the server just answered with, until the reload brings it.
// Returns whether a list was shown to change.
function updateShown(
  queryClient: QueryClient,
  chatId: string,
  change: (page: MessagePage, index: number) => MessagePage,
): boolean {
  const shown =
    queryClient.getQueryData<Pages>(messagesKey(chatId)) !== undefined
  queryClient.setQueryData<Pages>(
    messagesKey(chatId),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page, index) => change(page, index)),
      },
  )
  return shown
}

function reload(queryClient: QueryClient, chatId: string) {
  return queryClient.invalidateQueries({ queryKey: messagesKey(chatId) })
}

// The files of the card whose chat this is change with its messages.
function reloadCardFiles(queryClient: QueryClient, cardId: string | null) {
  if (cardId) {
    void queryClient.invalidateQueries({ queryKey: cardFilesKey(cardId) })
  }
}

// Sends a message, with the pending files it names (none when `files` is
// undefined). `onSaved` runs together with the cache update, so a message
// shown as "sending" can be swapped for the saved one in one step.
export function useSendMessage(chatId: string, cardId: string | null) {
  const queryClient = useQueryClient()
  return (
    id: string,
    body: string,
    files: FileInfo[] | undefined,
    onSaved: (shown: boolean) => void,
  ) =>
    api<Message>(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: {
        id,
        body,
        ...(files && { fileIds: files.map((file) => file.id) }),
      } satisfies NewMessageBody,
    }).then((saved) => {
      if (files?.length) reloadCardFiles(queryClient, cardId)
      const shown = updateShown(queryClient, chatId, (page, index) =>
        index === 0 && !page.messages.some((m) => m.id === saved.id)
          ? { ...page, messages: [...page.messages, saved] }
          : page,
      )
      onSaved(shown)
      void reload(queryClient, chatId)
    })
}

function useChangeMessage<V>(
  chatId: string,
  send: (variables: V) => Promise<Message>,
  cardId: string | null = null,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (saved) => {
      updateShown(queryClient, chatId, (page) => ({
        ...page,
        messages: page.messages.map((m) => (m.id === saved.id ? saved : m)),
      }))
      if (saved.deletedAt) reloadCardFiles(queryClient, cardId)
      void reload(queryClient, chatId)
    },
  })
}

export function useEditMessage(chatId: string) {
  return useChangeMessage(
    chatId,
    ({ id, body }: { id: string; body: string }) =>
      api<Message>(`/messages/${id}`, {
        method: 'PATCH',
        body: { body } satisfies MessageBodyRequest,
      }),
  )
}

export function useDeleteMessage(chatId: string, cardId: string | null) {
  return useChangeMessage(
    chatId,
    (id: string) => api<Message>(`/messages/${id}`, { method: 'DELETE' }),
    cardId,
  )
}

// Removes one file of a message. The message's files change, and so do the
// files the chat's card lists.
export function useRemoveMessageFile(chatId: string, cardId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: FileInfo) =>
      api<void>(`/files/${file.id}`, { method: 'DELETE' }),
    onSuccess: (_, file) => {
      updateShown(queryClient, chatId, (page) => ({
        ...page,
        messages: page.messages.map((m) =>
          m.id === file.messageId
            ? { ...m, files: m.files.filter((f) => f.id !== file.id) }
            : m,
        ),
      }))
      reloadCardFiles(queryClient, cardId)
      void reload(queryClient, chatId)
    },
  })
}

// A reload loads the newest pages again, and the pages further back would start
// from a different message when new ones arrived, so one at the far end could
// fall out of the window. Keeps every message already shown: the ones older
// than the reload's oldest go back in front of it.
function keepShown(shown: unknown, reloaded: unknown): unknown {
  const before = shown as Pages | undefined
  const after = reloaded as Pages
  const oldestBefore = before?.pages.at(-1)
  const oldestAfter = after.pages.at(-1)
  const firstAfter = oldestAfter?.messages[0]
  if (!before || !oldestAfter || !firstAfter) {
    return replaceEqualDeep(shown, reloaded)
  }
  const dropped = before.pages
    .flatMap((page) => page.messages)
    .filter((m) => before && isOlder(m, firstAfter))
  if (dropped.length === 0) {
    return replaceEqualDeep(shown, reloaded)
  }
  const ids = new Set(oldestAfter.messages.map((m) => m.id))
  const extra = dropped.filter((m) => !ids.has(m.id))
  const wasFirst = extra[0]?.id === before.pages.at(-1)?.messages[0]?.id
  return replaceEqualDeep(shown, {
    ...after,
    pages: after.pages.map((page, index) =>
      index === after.pages.length - 1
        ? {
            messages: [...extra, ...page.messages],
            hasOlder: wasFirst
              ? (oldestBefore?.hasOlder ?? false)
              : page.hasOlder,
          }
        : page,
    ),
  })
}

function isOlder(a: Message, b: Message): boolean {
  return (
    a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)
  )
}
