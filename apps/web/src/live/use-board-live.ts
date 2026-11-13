import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { reloadEverything, reloadForSignal } from './reload'
import { useLiveConnection } from './use-live-connection'

// While a board is open: the tab is in the board's room, and the signals of
// other people's changes reload what they name (docs/web-app.md, section 6).
// Whenever the server confirms a join (the first time, a new board, after a
// break in the connection) everything on screen loads once, to catch up with
// what changed before the tab was in the room. `openCardId` is the card in
// the panel.
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
    function join() {
      void connection?.join(boardId).then((ok) => {
        if (ok && active) {
          reloadEverything(queryClient, boardId)
        }
      })
    }
    join()
    const stopSignals = connection.onSignal((signal) => {
      // Our own change is already on screen.
      if (signal.by !== null && signal.by === connection.id) {
        return
      }
      if (signal.boardId === boardId) {
        reloadForSignal(queryClient, signal, openCard.current)
      }
    })
    const stopStatus = connection.onStatus((status) => {
      if (status === 'connected') {
        join()
      }
    })
    return () => {
      active = false
      stopSignals()
      stopStatus()
      connection.leave(boardId)
    }
  }, [connection, boardId, queryClient])
}
