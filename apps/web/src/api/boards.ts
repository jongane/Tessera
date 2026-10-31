import type { BoardView, Card, NewCardBody } from '@tessera/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { findCard, moveCardInView } from '../boards/move-card'
import { api } from './client'
import { boardKey } from './query-keys'

// While a board is open it reloads every 30 seconds, and when you come back
// to the tab (docs/web-app.md, section 6).
const BOARD_RELOAD_MS = 30_000

export function useBoardView(boardId: string) {
  return useQuery({
    queryKey: boardKey(boardId),
    queryFn: () => api<BoardView>(`/boards/${boardId}`),
    refetchInterval: BOARD_RELOAD_MS,
  })
}

// Reloads the board and, as its key starts the same, the board's threads:
// with a threadId the card takes that thread instead of a new one.
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
      // Only the board: its chats can go on loading.
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const before = queryClient.getQueryData<BoardView>(key)
      const from = before && findCard(before, move.cardId)
      if (before) {
        queryClient.setQueryData(key, moveCardInView(before, move))
      }
      return { from }
    },
    // Puts back only this card, so another move made meanwhile stays.
    onError: (_error, move, context) => {
      const from = context?.from
      if (from) {
        queryClient.setQueryData<BoardView>(key, (now) =>
          now
            ? moveCardInView(now, {
                cardId: move.cardId,
                columnId: from.column.id,
                position: from.index,
              })
            : now,
        )
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

// A card found by its number, such as WEB-12. Old numbers and project codes
// work too; `number` is always the current one.
export function useCardByNumber(reference: string) {
  return useQuery({
    queryKey: ['cards', 'by-number', reference.toUpperCase()],
    queryFn: () =>
      api<Card & { number: string }>(
        `/cards/by-number/${encodeURIComponent(reference)}`,
      ),
  })
}
