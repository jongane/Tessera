import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useLiveConnection } from './use-live-connection'
import { reloadEverything, reloadForSignal } from './reload'

// While a board is open: the tab is in the board's room, and the signals of
// other people's changes reload what they name (docs/web-app.md, section 6).
// After a break in the connection the room is joined again, and everything
// on screen loads once to catch up. `openCardId` is the card in the panel.
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
    let wasDown = false
    connection.join(boardId)
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
      if (status === 'disconnected') {
        wasDown = true
        return
      }
      connection.join(boardId)
      if (wasDown) {
        wasDown = false
        reloadEverything(queryClient, boardId)
      }
    })
    return () => {
      stopSignals()
      stopStatus()
      connection.leave(boardId)
    }
  }, [connection, boardId, queryClient])
}
