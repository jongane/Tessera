import { act, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardPanel, openCard } from '../test/card-panel'
import { live } from '../test/fake-live'
import { sprint } from '../test/fixtures'
import { recordRequests } from '../test/requests'
import { apiError, server } from '../test/server'

// Live updates PR, review and attack fixes round 2 (criteria 44 and 45): the
// app asks again when a join is refused, and stops asking when the person is
// signed out. The waits of the connection itself are in
// live-reconnect-attack.test.ts.
//
// Contract (criterion 45): a join that does not get an ok (refused, or no
// answer within the connection's 10 seconds, both a false from `join`) is
// asked again 1 second after the failure, then 2, 4, 8, 16 seconds, and never
// more than 30 seconds after, with no random variation. The first ok resets
// the waits, joins the room and reloads what the board shows once.

const BOARD_URL = `/api/boards/${sprint.id}`

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('A join that is refused or times out (criterion 45)', () => {
  // 45
  it('asks again after 1, 2 and 4 seconds, and reloads the board once the join is ok', async () => {
    live.refuseJoins(3)
    openCard()
    await cardPanel()
    await waitFor(() => expect(live.joined).toHaveLength(1))
    const requests = recordRequests()
    expect(live.rooms).toEqual([])

    // Waits of 1, 2 and 4 seconds, with 200 ms to spare either side.
    await advance(800)
    expect(live.joined, 'no second join before 1 s').toHaveLength(1)
    await advance(400)
    expect(live.joined, 'a second join after 1 s').toHaveLength(2)
    await advance(1600)
    expect(live.joined, 'no third join before 2 s more').toHaveLength(2)
    await advance(400)
    expect(live.joined, 'a third join after 2 s more').toHaveLength(3)
    await advance(3600)
    expect(live.joined, 'no fourth join before 4 s more').toHaveLength(3)
    expect(requests.reads(BOARD_URL), 'no reload while refused').toBe(0)
    await advance(400)
    expect(live.joined, 'a fourth join after 4 s more').toHaveLength(4)

    expect(live.rooms).toEqual([sprint.id])
    await waitFor(() => expect(requests.reads(BOARD_URL)).toBe(1))
    // No more joins once it worked.
    await advance(60_000)
    expect(live.joined).toHaveLength(4)
  })

  // 45
  it('waits 30 seconds at most between joins', async () => {
    live.refuseJoins()
    openCard()
    await cardPanel()
    await waitFor(() => expect(live.joined).toHaveLength(1))

    // Joins at 0, 1, 3, 7, 15 and 31 seconds, then every 30 seconds.
    await advance(31_400)
    expect(live.joined, 'six joins after 31 s').toHaveLength(6)
    await advance(29_000)
    expect(live.joined, 'no seventh join before 30 s more').toHaveLength(6)
    await advance(800)
    expect(live.joined, 'a seventh join after 30 s more').toHaveLength(7)
    await advance(29_000)
    expect(live.joined, 'no eighth join before 30 s more').toHaveLength(7)
    await advance(800)
    expect(live.joined, 'an eighth join after 30 s more').toHaveLength(8)
  })

  // 45
  it('stops asking when the person leaves the board', async () => {
    live.refuseJoins()
    const { router } = openCard()
    await cardPanel()
    await waitFor(() => expect(live.joined).toHaveLength(1))

    await act(async () => {
      await router.navigate('/projects')
    })
    await advance(1500)
    const asked = live.joined.length
    await advance(120_000)

    expect(live.joined).toHaveLength(asked)
  })
})

describe('A session that has ended (criterion 44)', () => {
  // 44
  it('stops trying and shows the sign-in page once an API request answers 401', async () => {
    const { router, queryClient } = openCard()
    await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    // The connection is down, and the server no longer knows this session.
    await live.disconnect()
    server.use(
      http.get('/api/auth/me', () => apiError(401, 'Not signed in')),
      http.get(BOARD_URL, () => apiError(401, 'Not signed in')),
    )

    await act(async () => {
      await queryClient.invalidateQueries()
    })

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Tessera' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sign-in')
    // The connection is closed, so it does not go on trying.
    expect(live.closed).toBe(true)
    const opened = live.opened
    await advance(120_000)
    expect(live.opened).toBe(opened)
    expect(live.joined).toHaveLength(1)
  })
})
