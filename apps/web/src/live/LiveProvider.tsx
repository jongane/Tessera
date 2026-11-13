import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { meKey } from '../api/auth'
import { openLiveConnection, setCurrentConnection } from './live-connection'

// One live connection for a signed-in tab, open while the app shell is on
// screen. Signing out leaves the shell, which closes it.
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  useEffect(() => {
    // Refused: ask who is signed in. If the session has ended
    // the API answers 401, and the normal sign-in page takes over (which
    // leaves this shell and closes the connection for good).
    // The answer is true for a 200, and false when there was none (a 503, no
    // network), so the connection asks again at the next refusal.
    const opened = openLiveConnection(async () => {
      await queryClient.invalidateQueries({ queryKey: meKey })
      const state = queryClient.getQueryState(meKey)
      return state?.status === 'success' && state.data != null
    })
    setCurrentConnection(opened)
    return () => {
      setCurrentConnection(null)
      opened.close()
    }
  }, [queryClient])

  return children
}
