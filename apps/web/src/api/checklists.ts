import type {
  ChecklistChangesBody,
  ChecklistItem,
  ChecklistItemChangesBody,
  ChecklistWithItems,
  NewChecklist,
} from '@tessera/shared'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { boardKey } from './query-keys'

// A card's checklists, in the card panel (docs/card-features.md, section 2).
// Ticks, edits, moves and deletes show straight away; if saving fails, only
// what that change touched is put back (docs/web-app.md, section 5).

type Lists = ChecklistWithItems[]
type ListsUpdate = (lists: Lists) => Lists

// Kept under the board's key, so they reload with the board. The board
// shows each card's checklist progress, so changes reload it too.
export function checklistsKey(boardId: string, cardId: string) {
  return [...boardKey(boardId), 'checklists', cardId] as const
}

export function useChecklists(boardId: string, cardId: string) {
  return useQuery({
    queryKey: checklistsKey(boardId, cardId),
    queryFn: () => api<Lists>(`/cards/${cardId}/checklists`),
  })
}

// Whether a change to the card's checklists is still being saved. A reload
// the server asks for waits then, so it cannot put back what the change
// has already shown; the change reloads when it has settled.
export function checklistsBusy(queryClient: QueryClient, cardId: string) {
  return queryClient.isMutating({ mutationKey: mutationKey(cardId) }) > 0
}

// Every change to one card's checklists, so the reload waits until the
// last of several quick changes has been saved.
function mutationKey(cardId: string) {
  return ['checklists', cardId, 'change'] as const
}

function useReload(boardId: string, cardId: string) {
  const queryClient = useQueryClient()
  return () => {
    if (queryClient.isMutating({ mutationKey: mutationKey(cardId) }) <= 1) {
      return queryClient.invalidateQueries({ queryKey: boardKey(boardId) })
    }
  }
}

function setLists(
  queryClient: QueryClient,
  key: ReturnType<typeof checklistsKey>,
  update: ListsUpdate,
) {
  queryClient.setQueryData<Lists>(key, (lists) => lists && update(lists))
}

// A change shown before it is saved. `undo` is worked out from the lists
// as they were, and put back if saving fails.
function useShownChange<Input>(
  boardId: string,
  cardId: string,
  send: (input: Input) => Promise<unknown>,
  apply: (input: Input) => ListsUpdate,
  undo: (input: Input, before: Lists) => ListsUpdate,
) {
  const queryClient = useQueryClient()
  const key = checklistsKey(boardId, cardId)
  const reload = useReload(boardId, cardId)
  return useMutation({
    mutationKey: mutationKey(cardId),
    mutationFn: send,
    onMutate: async (input: Input) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const before = queryClient.getQueryData<Lists>(key) ?? []
      setLists(queryClient, key, apply(input))
      return { undo: undo(input, before) }
    },
    onError: (_error, _input, context) => {
      if (context) {
        setLists(queryClient, key, context.undo)
      }
    },
    onSettled: reload,
  })
}

// A change shown once it is saved.
function useSavedChange<Input, Output>(
  boardId: string,
  cardId: string,
  send: (input: Input) => Promise<Output>,
  apply: (input: Input, output: Output) => ListsUpdate,
) {
  const queryClient = useQueryClient()
  const key = checklistsKey(boardId, cardId)
  const reload = useReload(boardId, cardId)
  return useMutation({
    mutationKey: mutationKey(cardId),
    mutationFn: send,
    onSuccess: (output: Output, input: Input) =>
      setLists(queryClient, key, apply(input, output)),
    onSettled: reload,
  })
}

// The list with its progress counted again.
function withProgress(list: ChecklistWithItems): ChecklistWithItems {
  return {
    ...list,
    progress: {
      done: list.items.filter((item) => item.isDone).length,
      total: list.items.length,
    },
  }
}

function changeList(
  checklistId: string,
  change: (list: ChecklistWithItems) => ChecklistWithItems,
): ListsUpdate {
  return (lists) =>
    lists.map((list) =>
      list.id === checklistId ? withProgress(change(list)) : list,
    )
}

function changeItems(
  checklistId: string,
  change: (items: ChecklistItem[]) => ChecklistItem[],
): ListsUpdate {
  return changeList(checklistId, (list) => ({
    ...list,
    items: change(list.items),
  }))
}

// `moved` taken out and put back at `index` (0 is first), all renumbered.
function moveTo<T extends { id: string; position: number }>(
  all: T[],
  movedId: string,
  index: number,
): T[] {
  const moved = all.find((x) => x.id === movedId)
  if (!moved) {
    return all
  }
  const rest = all.filter((x) => x.id !== movedId)
  rest.splice(Math.min(index, rest.length), 0, moved)
  return rest.map((x, position) => ({ ...x, position }))
}

function indexIn(all: { id: string }[], id: string): number {
  return all.findIndex((x) => x.id === id)
}

function itemIn(lists: Lists, checklistId: string, itemId: string) {
  return lists
    .find((list) => list.id === checklistId)
    ?.items.find((item) => item.id === itemId)
}

// A new checklist goes after the others.
export function useAddChecklist(boardId: string, cardId: string) {
  return useSavedChange(
    boardId,
    cardId,
    (name: string) =>
      api<NewChecklist>(`/cards/${cardId}/checklists`, {
        method: 'POST',
        body: { name },
      }),
    (_name, created) => (lists) => {
      const { suggestNewCard: _suggest, ...checklist } = created
      return [
        ...lists,
        { ...checklist, items: [], progress: { done: 0, total: 0 } },
      ]
    },
  )
}

export type ChecklistChange = { checklistId: string } & ChecklistChangesBody

// Renames and/or moves a checklist among the card's checklists.
export function useChangeChecklist(boardId: string, cardId: string) {
  return useShownChange(
    boardId,
    cardId,
    ({ checklistId, ...body }: ChecklistChange) =>
      api<void>(`/checklists/${checklistId}`, { method: 'PATCH', body }),
    ({ checklistId, name, position }) =>
      (lists) => {
        const renamed =
          name === undefined
            ? lists
            : changeList(checklistId, (list) => ({ ...list, name }))(lists)
        return position === undefined
          ? renamed
          : moveTo(renamed, checklistId, position)
      },
    ({ checklistId, name, position }, before) => {
      const was = before.find((list) => list.id === checklistId)
      const wasAt = indexIn(before, checklistId)
      return (lists) => {
        const named =
          name === undefined || !was
            ? lists
            : changeList(checklistId, (list) => ({
                ...list,
                name: was.name,
              }))(lists)
        return position === undefined
          ? named
          : moveTo(named, checklistId, wasAt)
      }
    },
  )
}

// Asked first, so shown once it is saved. Its items go with it.
export function useDeleteChecklist(boardId: string, cardId: string) {
  return useSavedChange(
    boardId,
    cardId,
    (checklistId: string) =>
      api<void>(`/checklists/${checklistId}`, { method: 'DELETE' }),
    (checklistId) => (lists) => lists.filter((list) => list.id !== checklistId),
  )
}

// To the bottom of the checklist.
export function useAddItem(boardId: string, cardId: string) {
  return useSavedChange(
    boardId,
    cardId,
    ({ checklistId, text }: { checklistId: string; text: string }) =>
      api<ChecklistItem>(`/checklists/${checklistId}/items`, {
        method: 'POST',
        body: { text },
      }),
    ({ checklistId }, item) =>
      changeItems(checklistId, (items) => [...items, item]),
  )
}

export type ItemChange = {
  checklistId: string
  itemId: string
} & ChecklistItemChangesBody

// Edits, ticks and/or moves an item within its checklist.
export function useChangeItem(boardId: string, cardId: string) {
  return useShownChange(
    boardId,
    cardId,
    ({ checklistId: _checklistId, itemId, ...body }: ItemChange) =>
      api<ChecklistItem>(`/checklist-items/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    ({ checklistId, itemId, position, ...fields }) =>
      changeItems(checklistId, (items) => {
        const changed = items.map((item) =>
          item.id === itemId ? { ...item, ...fields } : item,
        )
        return position === undefined
          ? changed
          : moveTo(changed, itemId, position)
      }),
    ({ checklistId, itemId, text, isDone, position }, before) => {
      const was = itemIn(before, checklistId, itemId)
      if (!was) {
        return (lists) => lists
      }
      const list = before.find((l) => l.id === checklistId)!
      const wasAt = indexIn(list.items, itemId)
      return changeItems(checklistId, (items) => {
        const put = items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                ...(text === undefined ? {} : { text: was.text }),
                ...(isDone === undefined ? {} : { isDone: was.isDone }),
              }
            : item,
        )
        return position === undefined ? put : moveTo(put, itemId, wasAt)
      })
    },
  )
}

export function useDeleteItem(boardId: string, cardId: string) {
  return useShownChange(
    boardId,
    cardId,
    ({ itemId }: { checklistId: string; itemId: string }) =>
      api<void>(`/checklist-items/${itemId}`, { method: 'DELETE' }),
    ({ checklistId, itemId }) =>
      changeItems(checklistId, (items) =>
        items
          .filter((item) => item.id !== itemId)
          .map((item, position) => ({ ...item, position })),
      ),
    ({ checklistId, itemId }, before) => {
      const was = itemIn(before, checklistId, itemId)
      const list = before.find((l) => l.id === checklistId)
      if (!was || !list) {
        return (lists) => lists
      }
      const wasAt = indexIn(list.items, itemId)
      return changeItems(checklistId, (items) =>
        moveTo([...items, was], itemId, wasAt),
      )
    },
  )
}

// Replaces the item with a subtask of the card in the card's column. The
// board reloads, so the subtask shows there.
export function useTurnItemIntoSubtask(boardId: string, cardId: string) {
  return useSavedChange(
    boardId,
    cardId,
    ({ itemId }: { checklistId: string; itemId: string }) =>
      api<unknown>(`/checklist-items/${itemId}/subtask`, { method: 'POST' }),
    ({ checklistId, itemId }) =>
      changeItems(checklistId, (items) =>
        items
          .filter((item) => item.id !== itemId)
          .map((item, position) => ({ ...item, position })),
      ),
  )
}
