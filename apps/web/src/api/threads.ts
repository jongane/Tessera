import type { NewThreadBody, Thread } from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

function threadsKey(boardId: string) {
  return ['boards', boardId, 'threads'] as const
}

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
