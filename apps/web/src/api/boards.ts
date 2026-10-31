import type { BoardView, Card, NewCardBody } from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moveCardInView } from '../boards/move-card'
import { api } from './client'

// While a board is open it reloads every 30 seconds, and when you come back
// to the tab (docs/web-app.md, section 6).
const BOARD_RELOAD_MS = 30_000

export function boardKey(boardId: string) {
  return ['boards', boardId] as const
}

export function useBoardView(boardId: string) {
  return useQuery({
    queryKey: boardKey(boardId),
    queryFn: () => api<BoardView>(`/boards/${boardId}`),
    refetchInterval: BOARD_RELOAD_MS,
  })
}

export function useCreateCard(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ columnId, ...body }: NewCardBody & { columnId: string }) =>
      api<Card>(`/columns/${columnId}/cards`, { method: 'POST', body }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: boardKey(boardId) }),
  })
}

export interface CardMove {
  cardId: string
  columnId: string
  // 0 is the top of the column.
  position: number
  // Go ahead even though some of the card's subtasks are still open.
  confirmOpenSubtasks?: boolean
}

// Moves the card on screen straight away. If saving fails it goes back where
// it was (docs/web-app.md, section 5); the caller says so.
export function useMoveCard(boardId: string) {
  const queryClient = useQueryClient()
  const key = boardKey(boardId)
  return useMutation({
    mutationFn: ({ cardId, ...body }: CardMove) =>
      api<Card>(`/cards/${cardId}/move`, { method: 'POST', body }),
    onMutate: async (move) => {
      await queryClient.cancelQueries({ queryKey: key })
      const before = queryClient.getQueryData<BoardView>(key)
      if (before) {
        queryClient.setQueryData(key, moveCardInView(before, move))
      }
      return { before }
    },
    onError: (_error, _move, context) => {
      if (context?.before) {
        queryClient.setQueryData(key, context.before)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
