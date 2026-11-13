import { type ReactNode, useEffect } from 'react'
import { openLiveConnection, setCurrentConnection } from './live-connection'

// One live connection for a signed-in tab, open while the app shell is on
// screen. Signing out leaves the shell, which closes it.
export function LiveProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const opened = openLiveConnection()
    setCurrentConnection(opened)
    return () => {
      setCurrentConnection(null)
      opened.close()
    }
  }, [])

  return children
}
