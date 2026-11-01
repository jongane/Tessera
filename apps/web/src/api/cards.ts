import type {
  BoardCard,
  BoardView,
  CardChangesBody,
  CardTotals,
  CardView,
  CompleteCardResult,
  DeleteCardBody,
  Label,
  NewLabelBody,
  SubtaskList,
} from '@tessera/shared'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { boardKey } from './query-keys'

// Changes to one card, made from the card panel. Each shows on screen
// straight away, on the board's copy of the card, which the panel reads
// too. If saving fails, only what this change touched is put back, and the
// board reloads either way (docs/web-app.md, section 5).

type CardUpdate = (card: BoardCard) => BoardCard

function useCardMutation<Input, Output>(
  boardId: string,
  cardId: string,
  send: (input: Input) => Promise<Output>,
  // What the card looks like once the change is saved.
  apply: (input: Input) => CardUpdate,
  // Which of the card's fields the change touches, to put them back.
  touched: (keyof BoardCard)[],
) {
  const queryClient = useQueryClient()
  const key = boardKey(boardId)
  return useMutation({
    mutationFn: send,
    onMutate: async (input: Input) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const before = findInView(queryClient.getQueryData(key), cardId)
      updateInView(queryClient, key, cardId, apply(input))
      return { before }
    },
    onError: (_error, _input, context) => {
      const before = context?.before
      if (before) {
        const restore = Object.fromEntries(
          touched.map((field) => [field, before[field]]),
        ) as Partial<BoardCard>
        updateInView(queryClient, key, cardId, (card) => ({
          ...card,
          ...restore,
        }))
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

function findInView(
  view: BoardView | undefined,
  cardId: string,
): BoardCard | undefined {
  return view?.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === cardId)
}

function updateInView(
  queryClient: ReturnType<typeof useQueryClient>,
  key: ReturnType<typeof boardKey>,
  cardId: string,
  update: CardUpdate,
) {
  queryClient.setQueryData<BoardView>(key, (view) =>
    view
      ? {
          ...view,
          columns: view.columns.map((column) => ({
            ...column,
            cards: column.cards.map((card) =>
              card.id === cardId ? update(card) : card,
            ),
          })),
        }
      : view,
  )
}

// Title, description, priority, due date and estimate.
export function useChangeCard(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    (body: CardChangesBody) =>
      api<CardView>(`/cards/${cardId}`, { method: 'PATCH', body }),
    (body) => (card) => ({ ...card, ...cardFields(body) }),
    ['title', 'description', 'priority', 'estimateMinutes', 'dueAt', 'dueHasTime'],
  )
}

// The card's fields after `body` is saved, as the API stores them.
export function cardFields(body: CardChangesBody): Partial<BoardCard> {
  const { due, description, ...rest } = body
  const fields: Partial<BoardCard> = { ...rest }
  if (description !== undefined) {
    fields.description = description === '' ? null : description
  }
  if (due === null) {
    fields.dueAt = null
    fields.dueHasTime = false
  } else if (due && 'date' in due) {
    // A day alone is stored as midnight UTC of that day.
    fields.dueAt = `${due.date}T00:00:00.000Z`
    fields.dueHasTime = false
  } else if (due) {
    fields.dueAt = new Date(due.at).toISOString()
    fields.dueHasTime = true
  }
  return fields
}

export interface Person {
  id: string
  displayName: string
}

// The first person assigned becomes the owner.
export function useAssign(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    (person: Person) =>
      api<unknown>(`/cards/${cardId}/assignees/${person.id}`, {
        method: 'PUT',
      }),
    (person) => (card) =>
      card.assignees.some((a) => a.id === person.id)
        ? card
        : {
            ...card,
            assignees: [
              ...card.assignees,
              { ...person, isOwner: card.assignees.length === 0 },
            ],
          },
    ['assignees'],
  )
}

// Unassigning the owner hands ownership to the person assigned longest,
// who is next in the list.
export function useUnassign(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    (userId: string) =>
      api<unknown>(`/cards/${cardId}/assignees/${userId}`, {
        method: 'DELETE',
      }),
    (userId) => (card) => {
      const rest = card.assignees.filter((a) => a.id !== userId)
      const hasOwner = rest.some((a) => a.isOwner)
      return {
        ...card,
        assignees: rest.map((a, index) => ({
          ...a,
          isOwner: a.isOwner || (!hasOwner && index === 0),
        })),
      }
    },
    ['assignees'],
  )
}

// The owner is listed first.
export function useMakeOwner(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    (userId: string) =>
      api<unknown>(`/cards/${cardId}/owner`, {
        method: 'PUT',
        body: { userId },
      }),
    (userId) => (card) => ({
      ...card,
      assignees: [
        ...card.assignees.filter((a) => a.id === userId),
        ...card.assignees.filter((a) => a.id !== userId),
      ].map((a) => ({ ...a, isOwner: a.id === userId })),
    }),
    ['assignees'],
  )
}

type CardLabel = BoardCard['labels'][number]

export function useAddLabelToCard(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    (label: CardLabel) =>
      api<void>(`/cards/${cardId}/labels/${label.id}`, { method: 'PUT' }),
    (label) => (card) =>
      card.labels.some((l) => l.id === label.id)
        ? card
        : {
            ...card,
            // In name order, as the board lists them.
            labels: [
              ...card.labels,
              { id: label.id, name: label.name, colour: label.colour },
            ].sort((a, b) => a.name.localeCompare(b.name)),
          },
    ['labels'],
  )
}

export function useRemoveLabelFromCard(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    (labelId: string) =>
      api<void>(`/cards/${cardId}/labels/${labelId}`, { method: 'DELETE' }),
    (labelId) => (card) => ({
      ...card,
      labels: card.labels.filter((l) => l.id !== labelId),
    }),
    ['labels'],
  )
}

// Makes a project label, then puts it on the card.
export function useCreateLabelForCard(
  projectId: string,
  boardId: string,
  cardId: string,
) {
  const queryClient = useQueryClient()
  const add = useAddLabelToCard(boardId, cardId)
  return useMutation({
    mutationFn: async (body: NewLabelBody) => {
      const label = await api<Label>(`/projects/${projectId}/labels`, {
        method: 'POST',
        body,
      })
      await add.mutateAsync(label)
      return label
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'labels'],
      }),
  })
}

export function useCompleteCard(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    (confirmOpenSubtasks: boolean) =>
      api<CompleteCardResult>(`/cards/${cardId}/complete`, {
        method: 'POST',
        body: confirmOpenSubtasks ? { confirmOpenSubtasks } : {},
      }),
    () => (card) => ({ ...card, isComplete: true }),
    ['isComplete'],
  )
}

// The card stays where it is (docs/card-features.md, section 5).
export function useReopenCard(boardId: string, cardId: string) {
  return useCardMutation(
    boardId,
    cardId,
    () => api<unknown>(`/cards/${cardId}/reopen`, { method: 'POST' }),
    () => (card) => ({ ...card, isComplete: false }),
    ['isComplete'],
  )
}

// Not shown before it is saved: deleting asks first, and can be refused.
export function useDeleteCard(boardId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DeleteCardBody) =>
      api<void>(`/cards/${cardId}`, { method: 'DELETE', body }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: boardKey(boardId) }),
  })
}

// The estimate rolled up from the card's subtasks.
export function useCardTotals(cardId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['cards', cardId, 'time-totals'],
    queryFn: () => api<CardTotals>(`/cards/${cardId}/time-totals`),
    enabled,
  })
}

// The card's direct subtasks, and for each whether it has subtasks of its
// own, for the delete choices.
export function useSubtasksForDelete(cardId: string, enabled: boolean) {
  const list = useQuery({
    queryKey: ['cards', cardId, 'subtasks'],
    queryFn: () => api<SubtaskList>(`/cards/${cardId}/subtasks`),
    enabled,
  })
  const subtasks = list.data?.subtasks ?? []
  const own = useQueries({
    queries: subtasks.map((subtask) => ({
      queryKey: ['cards', subtask.id, 'subtasks'],
      queryFn: () => api<SubtaskList>(`/cards/${subtask.id}/subtasks`),
    })),
  })
  const pending = list.isPending || own.some((query) => query.isPending)
  const error = list.error ?? own.find((query) => query.error)?.error ?? null
  return {
    pending: enabled && pending,
    error,
    subtasks: subtasks.map((subtask, index) => ({
      subtask,
      hasSubtasks: (own[index]?.data?.progress.total ?? 0) > 0,
    })),
  }
}
