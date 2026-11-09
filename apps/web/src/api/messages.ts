import type { Message, MessageBodyRequest, MessagePage } from '@tessera/shared'
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { BOARD_RELOAD_MS, messagesKey } from './query-keys'

type Pages = InfiniteData<MessagePage, string>

// A chat's messages: the newest page first; `fetchNextPage` adds the next,
// older one. A reload (every 30 seconds, on coming back to the tab, after
// your own change) loads every page that is shown again, from the newest.
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
    refetchInterval: BOARD_RELOAD_MS,
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

// Sends a message. `onSaved` runs together with the cache update, so a
// message shown as "sending" can be swapped for the saved one in one step.
export function useSendMessage(chatId: string) {
  const queryClient = useQueryClient()
  return (body: string, onSaved: (shown: boolean) => void) =>
    api<Message>(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: { body } satisfies MessageBodyRequest,
    }).then((saved) => {
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
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (saved) => {
      updateShown(queryClient, chatId, (page) => ({
        ...page,
        messages: page.messages.map((m) => (m.id === saved.id ? saved : m)),
      }))
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

export function useDeleteMessage(chatId: string) {
  return useChangeMessage(chatId, (id: string) =>
    api<Message>(`/messages/${id}`, { method: 'DELETE' }),
  )
}
