import type {
  CardTotals,
  CardView,
  NewTimeEntryBody,
  StartTimerResult,
  StopTimerResult,
  TimeEntry,
  TimeEntryChangesBody,
  TimeEntryWithPerson,
  TimerState,
} from '@tessera/shared'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'

// Time entries and the timer, in the card panel and the top bar
// (docs/card-features.md, section 6). Everything is shown once the server
// has saved it; the lists and the timer then load again.

// One timer per person, shared by the card panel and the top-bar chip.
export const timerKey = ['timer'] as const

function entriesKey(cardId: string) {
  return ['cards', cardId, 'time-entries'] as const
}

function totalsKey(cardId: string) {
  return ['cards', cardId, 'time-totals'] as const
}

// The card's entries and totals, and the timer, load again. Some other
// card's too, when a timer was stopped to start this one.
function reloadTime(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'timer' ||
      (queryKey[0] === 'cards' &&
        (queryKey[2] === 'time-entries' || queryKey[2] === 'time-totals')),
  })
}

// Your running timer, if any. It loads again when you come back to the tab.
export function useTimer() {
  return useQuery({
    queryKey: timerKey,
    queryFn: () => api<TimerState>('/timer'),
    // The top-bar chip keeps it up to date, so opening a card does not ask again.
    refetchOnMount: false,
  })
}

export function useTimeEntries(cardId: string) {
  return useQuery({
    queryKey: entriesKey(cardId),
    queryFn: () => api<TimeEntryWithPerson[]>(`/cards/${cardId}/time-entries`),
  })
}

// Estimate, time spent and what the card's subtasks add.
export function useCardTotals(cardId: string) {
  return useQuery({
    queryKey: totalsKey(cardId),
    queryFn: () => api<CardTotals>(`/cards/${cardId}/time-totals`),
  })
}

// The card with its number, for naming the card a timer runs on.
export function cardQuery(cardId: string) {
  return {
    queryKey: ['cards', cardId, 'card'] as const,
    queryFn: () => api<CardView>(`/cards/${cardId}`),
  }
}

export function useTimerCard(cardId: string | undefined) {
  return useQuery({
    ...cardQuery(cardId ?? ''),
    enabled: cardId !== undefined,
  })
}

export function useStartTimer(cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (stopRunning: boolean) =>
      api<StartTimerResult>(`/cards/${cardId}/timer`, {
        method: 'POST',
        body: stopRunning ? { stopRunning } : {},
      }),
    onSettled: () => reloadTime(queryClient),
  })
}

export function useStopTimer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<StopTimerResult>('/timer', { method: 'DELETE' }),
    onSettled: () => reloadTime(queryClient),
  })
}

export function useLogTime(cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: NewTimeEntryBody) =>
      api<TimeEntry>(`/cards/${cardId}/time-entries`, {
        method: 'POST',
        body,
      }),
    onSettled: () => reloadTime(queryClient),
  })
}

export function useChangeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      entryId,
      ...body
    }: TimeEntryChangesBody & { entryId: string }) =>
      api<TimeEntry>(`/time-entries/${entryId}`, { method: 'PATCH', body }),
    onSettled: () => reloadTime(queryClient),
  })
}

export function useDeleteEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (entryId: string) =>
      api<void>(`/time-entries/${entryId}`, { method: 'DELETE' }),
    onSettled: () => reloadTime(queryClient),
  })
}
