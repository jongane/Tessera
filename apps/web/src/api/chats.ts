import type { NewChatBody, Chat, ChatLink } from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { BOARD_RELOAD_MS, boardKey, chatsKey } from './query-keys'

// The general chat first, then the others oldest first. Reloads with the
// board (docs/web-app.md, section 6).
export function useChats(boardId: string) {
  return useQuery({
    queryKey: chatsKey(boardId),
    queryFn: () => api<Chat[]>(`/boards/${boardId}/chats`),
    refetchInterval: BOARD_RELOAD_MS,
  })
}

export function useCreateChat(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: NewChatBody) =>
      api<Chat>(`/boards/${boardId}/chats`, { method: 'POST', body }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatsKey(boardId) }),
  })
}

// Linking changes the chat list and the cards on the board. Reloading the
// board reloads its chats too.
function useReloadBoard(boardId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: boardKey(boardId) })
}

export function useLinkChat(boardId: string, chatId: string) {
  const reload = useReloadBoard(boardId)
  return useMutation({
    mutationFn: (body: ChatLink) =>
      api<Chat>(`/chats/${chatId}/card`, { method: 'PUT', body }),
    onSuccess: reload,
  })
}

// The chat and the card are both kept.
export function useUnlinkChat(boardId: string, chatId: string) {
  const reload = useReloadBoard(boardId)
  return useMutation({
    mutationFn: () => api<Chat>(`/chats/${chatId}/card`, { method: 'DELETE' }),
    onSuccess: reload,
  })
}
