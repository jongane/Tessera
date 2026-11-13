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

function openSocketConnection(): LiveConnection {
  const socket = io({ path: '/socket.io' })
  const signalListeners = new Set<(signal: LiveSignal) => void>()
  const statusListeners = new Set<(status: LiveStatus) => void>()
  let status: LiveStatus = 'disconnected'

  function setStatus(next: LiveStatus) {
    if (next !== status) {
      status = next
      for (const listener of [...statusListeners]) listener(next)
    }
  }
  socket.on('connect', () => setStatus('connected'))
  socket.on('disconnect', () => setStatus('disconnected'))
  socket.on('connect_error', () => setStatus('disconnected'))
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

export function openLiveConnection(): LiveConnection {
  return (factory ?? openSocketConnection)()
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
