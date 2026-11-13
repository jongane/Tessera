import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { http as mswHttp, passthrough } from 'msw'
import { Server } from 'socket.io'
import { setTimeout as realSleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type LiveConnection,
  openLiveConnection,
  setLiveConnectionFactory,
} from './live-connection'
import { server as msw } from '../test/server'

// Live updates PR, review and attack fixes round 2, criterion 44 (the first
// describe is the antagonist's proof, kept as a regression test): the app's
// real Socket.IO connection against a real Socket.IO server. "Reconnecting…" shows while
// the status is 'disconnected' (ReconnectingBar), so a connection that never
// tries again leaves the bar up, and live updates off, until a page reload.

let http: HttpServer | undefined
let io: Server | undefined
let connection: LiveConnection | undefined

async function startServer(setUp: (io: Server) => void) {
  http = createServer()
  io = new Server(http, { path: '/socket.io', cors: { origin: true } })
  setUp(io)
  // Real requests to the real Socket.IO server, not the fake API.
  msw.use(mswHttp.all(/127\.0\.0\.1/, () => passthrough()))
  await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve))
  const { port } = http.address() as AddressInfo
  // The app connects to its own origin.
  vi.stubGlobal('location', new URL(`http://127.0.0.1:${port}/`))
}

async function becomesConnected(c: LiveConnection, ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (c.status === 'connected') return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

afterEach(async () => {
  connection?.close()
  io?.close()
  await new Promise((resolve) => setTimeout(resolve, 50))
  vi.unstubAllGlobals()
})

describe('Round 2: the live connection tries again (criterion 44)', () => {
  // 44
  it('connects once the server lets it in, after one refused handshake (for example a database blip)', async () => {
    let handshakes = 0
    await startServer((server) =>
      server.use((_socket, next) => {
        handshakes += 1
        next(handshakes === 1 ? new Error('Please sign in') : undefined)
      }),
    )
    setLiveConnectionFactory(null)
    connection = openLiveConnection()

    expect(
      await becomesConnected(connection, 8000),
      `connected (handshakes tried: ${handshakes})`,
    ).toBe(true)
  }, 15_000)

  // 44
  it('connects again after the server closed it (as for the tab that just changed its password)', async () => {
    let connections = 0
    await startServer((server) =>
      server.on('connection', (socket) => {
        connections += 1
        if (connections === 1) {
          // LiveService.endEndedSessions closes the old session's sockets,
          // the changing tab's own included (it got a new session cookie).
          setTimeout(() => socket.disconnect(true), 100)
        }
      }),
    )
    setLiveConnectionFactory(null)
    connection = openLiveConnection()
    expect(await becomesConnected(connection, 3000)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(connection.status).toBe('disconnected')

    expect(
      await becomesConnected(connection, 8000),
      `connected again (connections made: ${connections})`,
    ).toBe(true)
  }, 15_000)
})

// Contract (criterion 44): after the server closed the connection or refused
// a handshake, the app tries again 1 second after the failure, then waits
// twice as long after each failed try (2, 4, 8, 16 seconds), and never more
// than 30 seconds, with no random variation. Closing the connection stops
// the tries. The tests fake the clock (setTimeout and Date); the network
// itself is real, so the clock moves in small steps with a little real time
// in between, and the server notes the fake time of every try.
describe('Round 2: the waits between tries (criterion 44)', () => {
  let tries: number[] = []

  async function refuseEverything() {
    tries = []
    await startServer((server) =>
      server.use((_socket, next) => {
        tries.push(Date.now())
        next(new Error('Please sign in'))
      }),
    )
  }

  // Moves the fake clock on, 100 ms at a time, until the server has seen
  // `count` tries (or `limit` fake milliseconds have passed).
  async function untilTries(count: number, limit: number) {
    for (let t = 0; t < limit && tries.length < count; t += 100) {
      await vi.advanceTimersByTimeAsync(100)
      await realSleep(5)
    }
    // Real time for the client to take in the refusal.
    await realSleep(100)
  }

  // 44
  it('waits 1, 2, 4, 8 and 16 seconds, then 30 seconds at most', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      await refuseEverything()
      setLiveConnectionFactory(null)
      connection = openLiveConnection()
      await untilTries(1, 2000)

      const waits = [1000, 2000, 4000, 8000, 16000, 30000, 30000]
      for (const [index, wait] of waits.entries()) {
        await untilTries(index + 2, wait + 5000)
        const gap = tries[index + 1]! - tries[index]!
        expect(gap, `wait before try ${index + 2}`).toBeGreaterThanOrEqual(wait)
        expect(gap, `wait before try ${index + 2}`).toBeLessThan(wait + 400)
      }
    } finally {
      vi.useRealTimers()
    }
  }, 120_000)

  // 44
  it('does not try again once the connection is closed (the person signed out)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      await refuseEverything()
      setLiveConnectionFactory(null)
      connection = openLiveConnection()
      await untilTries(2, 5000)
      expect(tries.length, 'a second try after 1 second').toBe(2)

      connection.close()
      await vi.advanceTimersByTimeAsync(120_000)
      await realSleep(200)

      expect(tries.length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)
})
