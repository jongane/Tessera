import type { NewThreadBody, Thread, ThreadLink } from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { boardKey, threadsKey } from './query-keys'

// The general thread first, then the others oldest first. Reloads with the
// board (docs/web-app.md, section 6).
export function useThreads(boardId: string) {
  return useQuery({
    queryKey: threadsKey(boardId),
    queryFn: () => api<Thread[]>(`/boards/${boardId}/threads`),
    refetchInterval: 30_000,
  })
}

export function useCreateThread(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: NewThreadBody) =>
      api<Thread>(`/boards/${boardId}/threads`, { method: 'POST', body }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: threadsKey(boardId) }),
  })
}

// Linking changes the thread list and the cards on the board. Reloading the
// board reloads its threads too.
function useReloadBoard(boardId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: boardKey(boardId) })
}

export function useLinkThread(boardId: string, threadId: string) {
  const reload = useReloadBoard(boardId)
  return useMutation({
    mutationFn: (body: ThreadLink) =>
      api<Thread>(`/threads/${threadId}/card`, { method: 'PUT', body }),
    onSuccess: reload,
  })
}

// The thread and the card are both kept.
export function useUnlinkThread(boardId: string, threadId: string) {
  const reload = useReloadBoard(boardId)
  return useMutation({
    mutationFn: () =>
      api<Thread>(`/threads/${threadId}/card`, { method: 'DELETE' }),
    onSuccess: reload,
  })
}
