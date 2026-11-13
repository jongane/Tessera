import { useSyncExternalStore } from 'react'

// Text for the page's one polite status region (ReconnectingBar), which is
// always on the page, empty at first, so a screen reader announces text put
// into it. Each message has an id, so it can be taken back out.
let messages: readonly (readonly [string, string])[] = []
const watchers = new Set<() => void>()

function change(next: typeof messages) {
  messages = next
  for (const watcher of [...watchers]) watcher()
}

export function announce(id: string, text: string): () => void {
  change([...messages.filter(([other]) => other !== id), [id, text]])
  return () => change(messages.filter(([other]) => other !== id))
}

export function useAnnouncements(): readonly (readonly [string, string])[] {
  return useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher)
      return () => void watchers.delete(watcher)
    },
    () => messages,
  )
}
