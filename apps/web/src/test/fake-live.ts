import { act } from '@testing-library/react'
import { sprint } from './fixtures'

// A fake live connection for component tests (plan "live updates"). The web
// app opens its connection through apps/web/src/live/live-connection.ts,
// which must export this seam (the tests install the fake with it):
//
//   export type LiveStatus = 'connected' | 'disconnected'
//   export interface LiveSignal {
//     type: 'card' | 'board' | 'chats' | 'message'
//     boardId: string
//     cardId?: string
//     chatId?: string
//     messageId?: string
//     by: string | null
//   }
//   export interface LiveConnection {
//     // This tab's connection id, sent with every save in the
//     // X-Live-Connection header; null while there is none.
//     readonly id: string | null
//     readonly status: LiveStatus
//     // Asks to be in a board's room; resolves to whether the server said
//     // ok. The app reloads what the board shows once it has (criterion 38).
//     join(boardId: string): Promise<boolean>
//     leave(boardId: string): void
//     onSignal(listener: (signal: LiveSignal) => void): () => void
//     onStatus(listener: (status: LiveStatus) => void): () => void
//     close(): void
//   }
//   // The app opens its connection with this factory (the real one by
//   // default); tests replace it. null puts the real one back.
//   export function setLiveConnectionFactory(
//     factory: (() => LiveConnection) | null,
//   ): void
//
// The app calls the factory once per signed-in tab, calls `close` when the
// person signs out, and joins the open board's room (again after a
// reconnect: the server forgets rooms when a connection drops).

export interface FakeSignal {
  type: 'card' | 'board' | 'chats' | 'message'
  boardId?: string
  cardId?: string
  chatId?: string
  messageId?: string
  // The connection that made the change; by default someone else's.
  by?: string | null
}

type Status = 'connected' | 'disconnected'

class FakeLive {
  // This tab's connection id.
  id: string | null = 'connection-of-this-tab'
  status: Status = 'connected'
  // How many times the app asked for a connection, and whether it has
  // closed the one it has.
  opened = 0
  closed = true
  // The rooms joined on the current connection, and every room ever joined.
  rooms: string[] = []
  joined: string[] = []
  private signalListeners = new Set<(signal: unknown) => void>()
  private statusListeners = new Set<(status: Status) => void>()
  private reconnects = 0
  // While set, joins are not answered yet.
  private gate: Promise<void> | null = null
  private openGate: () => void = () => {}

  reset() {
    this.id = 'connection-of-this-tab'
    this.status = 'connected'
    this.opened = 0
    this.closed = true
    this.rooms = []
    this.joined = []
    this.signalListeners.clear()
    this.statusListeners.clear()
    this.reconnects = 0
    this.gate = null
  }

  // The server does not answer join requests until `answerJoins` is called,
  // so a test can change things "before the join".
  holdJoins() {
    this.gate = new Promise<void>((resolve) => (this.openGate = resolve))
  }

  async answerJoins() {
    this.gate = null
    await act(async () => {
      this.openGate()
      await Promise.resolve()
    })
  }

  // What the app gets from the factory.
  open() {
    this.opened += 1
    this.closed = false
    return {
      get id() {
        return fake.id
      },
      get status() {
        return fake.status
      },
      join(boardId: string) {
        fake.joined.push(boardId)
        const enter = () => {
          if (fake.status !== 'connected') return false
          if (!fake.rooms.includes(boardId)) fake.rooms.push(boardId)
          return true
        }
        if (fake.gate) return fake.gate.then(enter)
        return Promise.resolve(enter())
      },
      leave(boardId: string) {
        fake.rooms = fake.rooms.filter((room) => room !== boardId)
      },
      onSignal(listener: (signal: unknown) => void) {
        fake.signalListeners.add(listener)
        return () => void fake.signalListeners.delete(listener)
      },
      onStatus(listener: (status: Status) => void) {
        fake.statusListeners.add(listener)
        return () => void fake.statusListeners.delete(listener)
      },
      close() {
        fake.closed = true
        fake.rooms = []
        fake.signalListeners.clear()
        fake.statusListeners.clear()
      },
    }
  }

  // Someone else changed something. The signal goes to the app only if the
  // app is in that board's room, as the real server would.
  async signal(signal: FakeSignal) {
    const boardId = signal.boardId ?? sprint.id
    // The app joins a board's room as the board opens; give it a moment.
    for (let i = 0; i < 50 && !this.rooms.includes(boardId); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }
    if (!this.rooms.includes(boardId)) {
      throw new Error(`The app has not joined the room of board ${boardId}`)
    }
    const full = { by: 'someone-else', ...signal, boardId }
    await act(async () => {
      for (const listener of [...this.signalListeners]) listener(full)
    })
  }

  // Shorthands for the signals the server sends.
  cardChanged(cardId: string, boardId = sprint.id) {
    return this.signal({ type: 'card', cardId, boardId })
  }
  boardChanged(boardId = sprint.id) {
    return this.signal({ type: 'board', boardId })
  }
  chatsChanged(boardId = sprint.id) {
    return this.signal({ type: 'chats', boardId })
  }
  messageChanged(chatId: string, messageId: string, boardId = sprint.id) {
    return this.signal({ type: 'message', chatId, messageId, boardId })
  }

  // The connection drops: the server forgets the rooms.
  async disconnect() {
    this.status = 'disconnected'
    this.rooms = []
    this.id = null
    await act(async () => {
      for (const listener of [...this.statusListeners]) listener('disconnected')
    })
  }

  // The connection is back, with a new id and no rooms joined yet.
  async reconnect() {
    this.reconnects += 1
    this.id = `connection-of-this-tab-${this.reconnects + 1}`
    this.status = 'connected'
    await act(async () => {
      for (const listener of [...this.statusListeners]) listener('connected')
    })
  }
}

export const live = new FakeLive()
// The same object, as the connection handed to the app sees it.
const fake = live

// The app's live connection module, once it exists (a glob finds nothing,
// instead of failing, while the file is missing).
interface Seam {
  setLiveConnectionFactory?: (factory: (() => unknown) | null) => void
}
const modules = import.meta.glob<Seam>('../live/live-connection.ts', {
  eager: true,
})

export function installFakeLive() {
  live.reset()
  for (const module of Object.values(modules)) {
    module.setLiveConnectionFactory?.(() => live.open())
  }
}

export function removeFakeLive() {
  for (const module of Object.values(modules)) {
    module.setLiveConnectionFactory?.(null)
  }
}
