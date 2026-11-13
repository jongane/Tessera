import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { cardPanel, login, openCard, typeInto } from '../test/card-panel'
import { live } from '../test/fake-live'
import { sprint } from '../test/fixtures'
import { recordRequests } from '../test/requests'
import { server } from '../test/server'

// Live updates PR, review and attack fixes round 2 (criteria 46 to 49; the
// first three describes are the antagonist's proofs, kept as regression
// tests).

const NOTE = /Someone changed this while you were editing/

async function pause(ms = 400) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function someoneElseSends(path: string, method: string, body: unknown) {
  const response = await fetch(new URL(path, window.location.origin), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.ok, `${method} ${path}`).toBe(true)
}

// A title save that waits until released; the fake API then saves it.
function holdTitleSaves() {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  server.use(
    http.patch('/api/cards/:cardId', async ({ request }) => {
      const body = (await request.clone().json()) as { title?: string }
      if (body.title !== undefined) await gate
      return undefined
    }),
  )
  return () => release()
}

describe('Round 2: signals skipped during your own save (criterion 47)', () => {
  // 47
  it('still reloads the open card’s time and totals once your save settles, when someone else changed that card meanwhile', async () => {
    const { user } = openCard()
    const release = holdTitleSaves()
    const panel = await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await pause()
    const title = within(panel).getByLabelText('Title')
    await user.clear(title)
    await typeInto(user, title, 'My title{Enter}')

    const requests = recordRequests()
    // Someone else logs time on this card while our title is being saved.
    await live.cardChanged(login.id)
    await pause()
    release()
    await waitFor(() =>
      expect(requests.reads(`/api/boards/${sprint.id}`)).toBeGreaterThan(0),
    )
    await pause()

    // Their time entry must show: the panel's time data reloads.
    expect(
      requests.reads(`/api/cards/${login.id}/time-totals`),
      'time totals reloaded',
    ).toBeGreaterThan(0)
    expect(
      requests.reads(`/api/cards/${login.id}/time-entries`),
      'time entries reloaded',
    ).toBeGreaterThan(0)
  })
})

describe('Round 2: the reload after a reconnect during your own save (criterion 48)', () => {
  // 48
  it('keeps your new title shown while it is being saved when the connection comes back and the join is answered', async () => {
    const { user } = openCard()
    const release = holdTitleSaves()
    const panel = await cardPanel()
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const title = within(panel).getByLabelText('Title')
    await user.clear(title)
    await typeInto(user, title, 'My title{Enter}')

    await live.disconnect()
    await live.reconnect()
    await pause()

    try {
      expect(title).toHaveValue('My title')
    } finally {
      release()
    }
  })
})

describe('Round 2: the description conflict after a failed save (criterion 46)', () => {
  // 46
  it('shows their version when your save failed and they changed the description while it was being sent', async () => {
    const card = { ...login, description: 'Old text' }
    const { user } = openCard(card)
    let fail = () => {}
    const gate = new Promise<void>((resolve) => (fail = resolve))
    server.use(
      http.patch('/api/cards/:cardId', async ({ request }) => {
        const body = (await request.clone().json()) as {
          description?: string
        }
        // Our save waits, then fails; theirs (sent with a marker) goes through.
        if (body.description === 'Old text and mine') {
          await gate
          return HttpResponse.json(
            { statusCode: 500, message: 'Server error' },
            { status: 500 },
          )
        }
        return undefined
      }),
    )
    const panel = await cardPanel()
    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, ' and mine')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    await someoneElseSends(`/api/cards/${login.id}`, 'PATCH', {
      description: 'Their text',
    })
    await live.cardChanged(login.id)
    fail()
    await pause(800)

    // The box still holds our text, the server holds theirs: the panel
    // must show, or the next Save overwrites theirs unseen.
    expect(editor).toHaveTextContent('Old text and mine')
    expect(within(panel).getByText(NOTE)).toBeInTheDocument()
  })
})

// Contract (criterion 49): the page always has one polite status region (the
// one that shows “Reconnecting…”), empty at first. When the “Someone changed
// this” panel opens, its text goes into that same region, which is how screen
// readers announce it; the text on the panel itself is not a second live
// region (a region that arrives with its text is often not announced).
describe('Round 2: the panel’s text in the page’s status region (criterion 49)', () => {
  // 49
  it('puts the panel’s text into the status region that was already there, empty', async () => {
    const { user } = openCard({ ...login, description: 'Old text' })
    const panel = await cardPanel()
    await user.click(
      await within(panel).findByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, ' and mine')
    await waitFor(() => expect(live.rooms).toEqual([sprint.id]))
    const before = screen.getAllByRole('status')
    expect(
      before.filter((region) => region.textContent === '').length,
      'one empty status region before the panel opens',
    ).toBeGreaterThan(0)

    await someoneElseSends(`/api/cards/${login.id}`, 'PATCH', {
      description: 'Their text',
    })
    await live.cardChanged(login.id)
    await within(panel).findByText('Their text')

    const regions = screen
      .getAllByRole('status')
      .filter((region) => NOTE.test(region.textContent ?? ''))
    expect(regions, 'one status region holds the text').toHaveLength(1)
    // The very region that was there before, empty.
    expect(before).toContain(regions[0])
    // No other live region announces it again.
    for (const text of screen.getAllByText(NOTE)) {
      const holder = text.closest(
        '[role="status"], [aria-live], [role="alert"]',
      )
      expect(holder === null || holder === regions[0], text.outerHTML).toBe(
        true,
      )
    }
  })
})
