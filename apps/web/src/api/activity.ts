import type { ActivityPage } from '@tessera/shared'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './client'

// A card's history, for the Activity tab (docs/web-app.md, section 1).

const PAGE_SIZE = 50

function activityKey(cardId: string) {
  return ['cards', cardId, 'activity'] as const
}

// The newest lines first; `fetchNextPage` adds the next, older page. The
// history is not kept once the tab is closed, so it loads fresh each time
// the tab is opened. While the tab is open it loads again whenever any
// change finishes saving.
export function useActivity(cardId: string) {
  const queryClient = useQueryClient()
  const key = activityKey(cardId)

  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        const finished =
          event.type === 'updated' &&
          (event.action.type === 'success' || event.action.type === 'error')
        if (finished) {
          void queryClient.invalidateQueries({ queryKey: key })
        }
      }),
    // `key` is rebuilt on every render; the card decides it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, cardId],
  )

  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => {
      const before = pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''
      return api<ActivityPage>(
        `/cards/${cardId}/activity?limit=${PAGE_SIZE}${before}`,
      )
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    gcTime: 0,
  })
}
