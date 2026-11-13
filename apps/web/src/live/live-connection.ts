import { io } from 'socket.io-client'

// The live connection to the API (docs/api.md, "Live updates"): the server
// sends small "something changed" signals, and the app reloads what they
// name. Tests replace the connection with a fake (setLiveConnectionFactory).

export type LiveStatus = 'connected' | 'disconnected'

export interface LiveSignal {
  type: 'card' | 'board' | 'chats' | 'message'
  boardId: string
  cardId?: string
  chatId?: string
  messageId?: string
  // The connection that made the change, so a tab can ignore its own.
  by: string | null
}

export interface LiveConnection {
  // This tab's connection id, sent with every save in the X-Live-Connection
  // header; null while there is none.
  readonly id: string | null
  readonly status: LiveStatus
  // Asks to be in a board's room; resolves to whether the server said ok.
  // The server forgets rooms when a connection drops, so the app asks again
  // once it is back. The app reloads what the board shows after an ok.
  join(boardId: string): Promise<boolean>
  leave(boardId: string): void
  onSignal(listener: (signal: LiveSignal) => void): () => void
  onStatus(listener: (status: LiveStatus) => void): () => void
  close(): void
}

// How long to wait before trying again: 1, 2, 4, 8, 16 seconds, then 30 at
// most, with no random variation. `failures` is how many tries failed in a
// row.
export function retryWait(failures: number): number {
  return Math.min(1000 * 2 ** failures, 30_000)
}

function openSocketConnection(onLost?: () => Promise<boolean>): LiveConnection {
  // Trying again is done here, as the library does not try again after the
  // server closed the connection or refused the handshake.
  const socket = io({ path: '/socket.io', reconnection: false })
  let failures = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let closed = false
  // Whether the session check of this outage was answered with a 200, and
  // whether a check is running. A refused handshake asks again until then.
  let sessionConfirmed = false
  let checking = false

  function tryAgain(refused = false) {
    if (closed || retry !== undefined) {
      return
    }
    // Asked after a refused handshake, not at the close itself: the close
    // alone says nothing, the refusal is what a ended session looks like.
    if (refused && !sessionConfirmed && !checking && onLost) {
      checking = true
      void onLost().then(
        (confirmed) => {
          checking = false
          sessionConfirmed = confirmed
        },
        () => {
          checking = false
        },
      )
    }
    retry = setTimeout(() => {
      retry = undefined
      socket.connect()
    }, retryWait(failures))
    failures += 1
  }
  const signalListeners = new Set<(signal: LiveSignal) => void>()
  const statusListeners = new Set<(status: LiveStatus) => void>()
  let status: LiveStatus = 'disconnected'

  function setStatus(next: LiveStatus) {
    if (next !== status) {
      status = next
      for (const listener of [...statusListeners]) listener(next)
    }
  }
  socket.on('connect', () => {
    failures = 0
    sessionConfirmed = false
    setStatus('connected')
  })
  socket.on('disconnect', () => {
    setStatus('disconnected')
    tryAgain()
  })
  socket.on('connect_error', () => {
    setStatus('disconnected')
    tryAgain(true)
  })
  socket.on('signal', (signal: LiveSignal) => {
    for (const listener of [...signalListeners]) listener(signal)
  })

  return {
    get id() {
      return socket.id ?? null
    },
    get status() {
      return status
    },
    async join(boardId) {
      if (!socket.connected) {
        return false
      }
      try {
        const reply = (await socket
          .timeout(10_000)
          .emitWithAck('join-board', { boardId })) as { ok?: boolean }
        return reply.ok === true
      } catch {
        return false
      }
    },
    leave(boardId) {
      if (socket.connected) {
        socket.emit('leave-board', { boardId })
      }
    },
    onSignal(listener) {
      signalListeners.add(listener)
      return () => void signalListeners.delete(listener)
    },
    onStatus(listener) {
      statusListeners.add(listener)
      return () => void statusListeners.delete(listener)
    },
    close() {
      closed = true
      clearTimeout(retry)
      signalListeners.clear()
      statusListeners.clear()
      socket.close()
    },
  }
}

let factory: (() => LiveConnection) | null = null

// The app opens its connection with this factory (the real one by default);
// tests replace it. null puts the real one back.
export function setLiveConnectionFactory(
  next: (() => LiveConnection) | null,
): void {
  factory = next
}

// `onLost` is called on a refused handshake (not on a plain close), for the
// real connection (the fake in tests ignores it). It runs the session check
// and answers true for a 200. It runs again at every later refusal of the
// outage until it has answered true, and never while a check is running; a
// successful connect starts the count again.
export function openLiveConnection(
  onLost?: () => Promise<boolean>,
): LiveConnection {
  return factory ? factory() : openSocketConnection(onLost)
}

// The connection of this tab, if one is open: its id goes with every save.
let current: LiveConnection | null = null
const watchers = new Set<() => void>()

export function setCurrentConnection(connection: LiveConnection | null): void {
  current = connection
  for (const watcher of [...watchers]) watcher()
}

export function getCurrentConnection(): LiveConnection | null {
  return current
}

export function watchCurrentConnection(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => void watchers.delete(watcher)
}

export function currentConnectionId(): string | null {
  return current?.id ?? null
}
