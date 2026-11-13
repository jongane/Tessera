import type {
  Board,
  BoardColumn,
  BoardView,
  Card,
  CardSearchResults,
  CompleteCardResult,
  NewSubtaskBody,
  SubtaskList,
  SubtaskListItem,
} from '@tessera/shared'
import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { useBoards } from './projects'
import { boardKey } from './query-keys'

// A card's subtasks, in the card panel (docs/card-features.md, section 4).
// The list is kept under the board's key, so it reloads with the board, and
// every change reloads the boards (docs/web-app.md, section 5).

export function subtasksKey(boardId: string, cardId: string) {
  return [...boardKey(boardId), 'subtasks', cardId] as const
}

export function useSubtasks(boardId: string, cardId: string) {
  return useQuery({
    queryKey: subtasksKey(boardId, cardId),
    queryFn: () => api<SubtaskList>(`/cards/${cardId}/subtasks`),
  })
}

// Whether a tick on the card's subtasks is still being saved. A reload the
// server asks for waits then, so it cannot put back what the tick has
// already shown; the last tick reloads when it has settled.
export function ticksBusy(queryClient: QueryClient, cardId: string) {
  return queryClient.isMutating({ mutationKey: tickKey(cardId) }) > 0
}

// Every tick on one card's subtasks, so the reload waits until the last of
// several quick ticks has been saved.
function tickKey(cardId: string) {
  return ['subtasks', cardId, 'tick'] as const
}

type ParentCard = Pick<Card, 'id' | 'boardId'>

// Skipped while a tick is still being saved, so it cannot put back what the
// tick has already shown. The last tick reloads when it has settled.
// `ownTicks` is how many of the pending ticks belong to the caller.
function useReloadBoards(ownTicks = 0) {
  const queryClient = useQueryClient()
  return () => {
    if (queryClient.isMutating({ mutationKey: ['subtasks'] }) <= ownTicks) {
      queryClient.invalidateQueries({ queryKey: ['boards'] })
    }
  }
}

function withDone(
  list: SubtaskList,
  subtaskId: string,
  isComplete: boolean,
): SubtaskList {
  return {
    ...list,
    subtasks: list.subtasks.map((subtask) =>
      subtask.id === subtaskId ? { ...subtask, isComplete } : subtask,
    ),
  }
}

export interface SubtaskTick {
  subtask: SubtaskListItem
  done: boolean
  // Go ahead even though the subtask has open subtasks of its own.
  confirmOpenSubtasks?: boolean
}

// Ticks or unticks a subtask, shown straight away. If saving fails, that
// subtask goes back as it was. Gives the board's done column to offer
// moving the subtask to, or null when unticking.
export function useTickSubtask(parent: ParentCard) {
  const queryClient = useQueryClient()
  const key = subtasksKey(parent.boardId, parent.id)
  // Not waited for, so the tick has ended when the reload finishes and the
  // regular reload starts again.
  const reload = useReloadBoards(1)
  return useMutation({
    mutationKey: tickKey(parent.id),
    mutationFn: ({ subtask, done, confirmOpenSubtasks }: SubtaskTick) =>
      done
        ? api<CompleteCardResult>(`/cards/${subtask.id}/complete`, {
            method: 'POST',
            body: confirmOpenSubtasks ? { confirmOpenSubtasks } : {},
          })
        : api<unknown>(`/cards/${subtask.id}/reopen`, { method: 'POST' }).then(
            () => null,
          ),
    onMutate: async ({ subtask, done }) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      queryClient.setQueryData<SubtaskList>(
        key,
        (list) => list && withDone(list, subtask.id, done),
      )
    },
    onError: (_error, { subtask }) =>
      queryClient.setQueryData<SubtaskList>(
        key,
        (list) => list && withDone(list, subtask.id, subtask.isComplete),
      ),
    onSettled: reload,
  })
}

// Moves a subtask to a column, which may be on another board.
export function useMoveSubtask() {
  const reload = useReloadBoards()
  return useMutation({
    mutationFn: ({ cardId, columnId }: { cardId: string; columnId: string }) =>
      api<Card>(`/cards/${cardId}/move`, {
        method: 'POST',
        body: { columnId },
      }),
    onSettled: reload,
  })
}

export function useAddSubtask(parentId: string) {
  const reload = useReloadBoards()
  return useMutation({
    mutationFn: (body: NewSubtaskBody) =>
      api<Card>(`/cards/${parentId}/subtasks`, { method: 'POST', body }),
    onSettled: reload,
  })
}

// Gives a card another parent, or none (a top-level card of its own).
export function useSetParent() {
  const reload = useReloadBoards()
  return useMutation({
    mutationFn: ({
      cardId,
      parentId,
    }: {
      cardId: string
      parentId: string | null
    }) =>
      api<Card>(`/cards/${cardId}/parent`, {
        method: 'PUT',
        body: { parentId },
      }),
    onSettled: reload,
  })
}

// Cards of the project by number or words from the title. Nothing is asked
// for an empty search.
export function useCardSearch(projectId: string, search: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'card-search', search],
    queryFn: () =>
      api<CardSearchResults>(
        `/projects/${projectId}/cards?q=${encodeURIComponent(search)}`,
      ),
    enabled: search !== '',
  })
}

export interface BoardColumns {
  board: Board
  columns: BoardColumn[]
}

// Every board of the project with its columns, for choosing a column.
// Nothing is loaded until `enabled`. Gives null until all have loaded.
export function useProjectColumns(projectId: string, enabled: boolean) {
  const boards = useBoards(enabled ? projectId : undefined)
  const views = useQueries({
    queries: (boards.data ?? []).map((board) => ({
      queryKey: boardKey(board.id),
      queryFn: () => api<BoardView>(`/boards/${board.id}`),
    })),
  })
  const error = boards.error ?? views.find((view) => view.error)?.error ?? null
  const loaded =
    boards.data !== undefined && views.every((view) => view.data !== undefined)
  return {
    error,
    groups: loaded
      ? (boards.data ?? []).map((board, index) => ({
          board,
          columns: views[index]!.data!.columns,
        }))
      : null,
  }
}
