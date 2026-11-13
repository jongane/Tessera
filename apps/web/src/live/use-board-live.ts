import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { retryWait } from './live-connection'
import type { LiveSignal } from './live-connection'
import { isSavingEdit, reloadEverything, reloadForSignal } from './reload'
import { useLiveConnection } from './use-live-connection'

// While a board is open: the tab is in the board's room, and the signals of
// other people's changes reload what they name (docs/web-app.md, section 6).
// Whenever the server confirms a join (the first time, a new board, after a
// break in the connection) everything on screen loads once, to catch up with
// what changed before the tab was in the room. A join that is refused or not
// answered is tried again, 1, 2, 4, 8, 16 seconds and then every 30. A signal
// that comes while this tab's own edit or move is being saved waits, and is
// made up once the save has settled. `openCardId` is the card in the panel.
export function useBoardLive(boardId: string, openCardId: string | null) {
  const connection = useLiveConnection()
  const queryClient = useQueryClient()
  // Read when a signal comes, so a card opened later still counts.
  const openCard = useRef(openCardId)
  useEffect(() => {
    openCard.current = openCardId
  })

  useEffect(() => {
    if (!connection) {
      return
    }
    let active = true
    let failures = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const skipped = new Map<string, LiveSignal>()

    function join() {
      clearTimeout(retry)
      void connection?.join(boardId).then((ok) => {
        if (!active) {
          return
        }
        if (ok) {
          failures = 0
          reloadEverything(queryClient, boardId)
        } else if (connection?.status === 'connected') {
          retry = setTimeout(join, retryWait(failures))
          failures += 1
        }
      })
    }
    join()

    const stopSignals = connection.onSignal((signal) => {
      // Our own change is already on screen.
      if (signal.by !== null && signal.by === connection.id) {
        return
      }
      if (signal.boardId !== boardId) {
        return
      }
      if (isSavingEdit(queryClient, boardId)) {
        skipped.set(JSON.stringify(signal), signal)
      } else {
        reloadForSignal(queryClient, signal, openCard.current)
      }
    })
    // Once the save has settled, the signals that waited are made up.
    const stopSaves = queryClient.getMutationCache().subscribe((event) => {
      const settled =
        event.type === 'updated' &&
        (event.action.type === 'success' || event.action.type === 'error')
      if (settled && skipped.size > 0 && !isSavingEdit(queryClient, boardId)) {
        const waiting = [...skipped.values()]
        skipped.clear()
        for (const signal of waiting) {
          reloadForSignal(queryClient, signal, openCard.current)
        }
      }
    })
    const stopStatus = connection.onStatus((status) => {
      if (status === 'connected') {
        failures = 0
        join()
      }
    })
    return () => {
      active = false
      clearTimeout(retry)
      stopSignals()
      stopSaves()
      stopStatus()
      connection.leave(boardId)
    }
  }, [connection, boardId, queryClient])
}
