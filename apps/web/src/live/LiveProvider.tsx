import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { meKey } from '../api/auth'
import { openLiveConnection, setCurrentConnection } from './live-connection'

// One live connection for a signed-in tab, open while the app shell is on
// screen. Signing out leaves the shell, which closes it.
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  useEffect(() => {
    // Lost or refused: ask who is signed in, once. If the session has ended
    // the API answers 401, and the normal sign-in page takes over (which
    // leaves this shell and closes the connection for good).
    const opened = openLiveConnection(() => {
      void queryClient.invalidateQueries({ queryKey: meKey })
    })
    setCurrentConnection(opened)
    return () => {
      setCurrentConnection(null)
      opened.close()
    }
  }, [queryClient])

  return children
}
