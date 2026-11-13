import { useEffect, useState } from 'react'
import { useLiveConnection } from './use-live-connection'

// How long the connection may be down before the bar shows.
const SHOW_AFTER_MS = 3000

// "Reconnecting…" at the top of the app, once the live connection has been
// down for more than 3 seconds. It goes away when the connection is back,
// with no message (docs/web-app.md, section 6). The status region is always
// on the page, and only its text comes and goes, so screen readers announce
// it.
export function ReconnectingBar() {
  const connection = useLiveConnection()
  const [down, setDown] = useState(false)

  useEffect(() => {
    if (!connection) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    function update(status: string) {
      clearTimeout(timer)
      if (status === 'connected') {
        setDown(false)
      } else {
        timer = setTimeout(() => setDown(true), SHOW_AFTER_MS)
      }
    }
    update(connection.status)
    const stop = connection.onStatus(update)
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [connection])

  return (
    <div role="status">
      {down && (
        <p className="bg-subtle px-4 py-1.5 text-center text-sm font-semibold">
          Reconnecting…
        </p>
      )}
    </div>
  )
}
