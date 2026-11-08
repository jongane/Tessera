import { newTimeEntrySchema } from '@tessera/shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { cardPanel, login, openCard, typeInto } from '../test/card-panel'
import { ben, backlogCard } from '../test/fake-board'
import { entry } from '../test/fake-time'
import { boardCard, website } from '../test/fixtures'
import { renderApp } from '../test/render'
import { ana, apiError, server, signedInAs } from '../test/server'

// Web PR 7c: time and the timer in the card panel, and the running-timer
// chip in the top bar (acceptance criteria 25 to 37, 44 and 45; the
// project's time zone dates entries; docs/card-features.md, section 6).
//
// Wording and screen details marked “(agreed 2026-11-07)” were proposed
// by the tester where the plan did not fix them, and the repository
// owner approved them (7c answers).

// Wording the owner decided (criteria file, Status line and plan).
const SAVE_FAILED = 'Couldn’t save, try again'
const UNDER_HALF_MINUTE = 'Under half a minute, nothing saved'
const RUNNING_ELSEWHERE =
  'Your timer is running on WEB-7. Stop it (its time is saved) and start here?'
const NOT_YOURS = 'Only a project admin can change someone else’s time'
const TOO_OLD =
  'You can change your own time for 24 hours. After that, ask a project admin'
const OVER = 'Over by 15m'
const NEEDS_REVIEW = 'Needs review'
const DELETE_REFUSED =
  'This card has 3h 20m logged. A project admin can delete the time entries first.'

// Wording and details proposed by the tester (agreed 2026-11-07).
const TIME = 'Time' // the section's heading, a region
const ENTRIES = 'Entries' // a heading with a list of the same name below it
const START = 'Start timer'
const STOP = 'Stop timer'
const CHIP = 'Running timer' // the top-bar chip, a group
const YES = 'Stop it and start here' // the “running on another card” dialog's confirm button
const LOG_TIME = 'Log time' // opens the form
const SAVE = 'Save' // log and edit forms (with Cancel)
const OF_WHICH = 'of which 45m on this card'
const SEE_ENTRIES = 'See the time entries' // link in the delete refusal
// Labels of the Log time form (the Edit form has the same ones).
const HOURS = 'Hours'
const MINUTES = 'Minutes'
const DATE = 'Date'
const NOTE = 'Note'

const NOW = '2026-11-07T10:00:00.000Z'
const MINUTE = 60_000
const HOUR = 60 * MINUTE

// Every test runs on a fixed clock, so dates, the 24-hour window and the
// running time are the same every time.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString()
}

async function timeSection(panel: HTMLElement) {
  return within(panel).findByRole('region', { name: TIME })
}

// The row of the entry whose text contains `text` (a note, say).
async function entryRow(time: HTMLElement, text: string) {
  let row: HTMLElement | undefined
  await waitFor(() => {
    const list = within(time).getByRole('list', { name: ENTRIES })
    row = within(list)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes(text))
    expect(row, `an entry with “${text}”`).toBeDefined()
  })
  return row!
}

function entryTexts(time: HTMLElement) {
  const list = within(time).getByRole('list', { name: ENTRIES })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

// Turned off, as a button or as a menu item.
function expectTurnedOff(element: HTMLElement) {
  expect(
    element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true',
  ).toBe(true)
}

function expectTurnedOn(element: HTMLElement) {
  expect(
    element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true',
  ).toBe(false)
}

const CLOCK = /^\d+:\d{2}:\d{2}$/

// The running time shown (h:mm:ss) is `seconds`, give or take the moment the
// test itself needs.
async function expectClock(scope: HTMLElement, seconds: number) {
  await waitFor(() => {
    const [h, m, s] = within(scope)
      .getByText(CLOCK)
      .textContent!.split(':')
      .map(Number)
    const shown = h! * 3600 + m! * 60 + s!
    expect(shown).toBeGreaterThanOrEqual(seconds)
    expect(shown).toBeLessThanOrEqual(seconds + 3)
  })
}

function sentTo(
  api: { requests: { request: string; body: unknown }[] },
  pattern: RegExp,
) {
  return api.requests.filter((r) => pattern.test(r.request))
}

// What the shared rule says, so the tests need not repeat its words.
function ruleMessage(fields: { minutes: number; note?: string }) {
  const result = newTimeEntrySchema.safeParse({
    workDate: '2026-11-07',
    ...fields,
  })
  expect(result.success).toBe(false)
  return result.error!.issues[0]!.message
}

async function replaceText(
  user: Parameters<typeof typeInto>[0],
  box: HTMLElement,
  text: string,
) {
  box.focus()
  await user.clear(box)
  if (text !== '') await typeInto(user, box, text)
}

describe('Time: estimate, time spent and what is left', () => {
  // Criteria 25 and 44.
  it('shows the estimate, the time spent and what is left of a card without subtasks', async () => {
    const card = boardCard('12', 'Login page', { estimateMinutes: 120 })
    const { container } = openCard(card, {
      time: {
        entries: {
          [card.id]: [
            entry(ana, 45, '2026-11-02', { note: 'Wireframes' }),
            entry(ben, 30, '2026-11-03', { note: 'Review' }),
          ],
        },
      },
    })
    const time = await timeSection(await cardPanel())

    await waitFor(() => expect(time).toHaveTextContent(/Time spent\s*1h 15m/))
    expect(time).toHaveTextContent(/Estimate\s*2h/)
    expect(time).toHaveTextContent(/Left\s*45m/)
    expect(time).not.toHaveTextContent('Original estimate')
    await expectNoAccessibilityProblems(container)
  })

  // Criterion 25, owner's answer: the overage is shown instead of what is left.
  it('says “Over by 15m” instead of what is left when more time is spent than estimated', async () => {
    const card = boardCard('12', 'Login page', { estimateMinutes: 60 })
    const { container } = openCard(card, {
      time: { entries: { [card.id]: [entry(ana, 75, '2026-11-02')] } },
    })
    const time = await timeSection(await cardPanel())

    await waitFor(() => expect(time).toHaveTextContent(OVER))
    expect(time).not.toHaveTextContent(/Left/)
    await expectNoAccessibilityProblems(container)
  })

  // Criterion 25: this replaces PR 6's “5h from its subtasks” line.
  it('shows the estimate rolled up from the subtasks, the own estimate as the original one, and the time on this card', async () => {
    const parent = boardCard('12', 'Login page', {
      estimateMinutes: 120,
      subtaskProgress: { complete: 0, total: 2 },
    })
    const { container } = openCard(parent, {
      time: {
        entries: { [parent.id]: [entry(ana, 45, '2026-11-02')] },
      },
    })
    server.use(
      http.get(`/api/cards/${parent.id}/time-totals`, () =>
        HttpResponse.json({
          estimateMinutes: 300,
          originalEstimateMinutes: 120,
          timeSpentMinutes: 180,
          ownTimeMinutes: 45,
        }),
      ),
    )
    const panel = await cardPanel()
    const time = await timeSection(panel)

    await waitFor(() => expect(time).toHaveTextContent(/Estimate\s*5h/))
    expect(time).toHaveTextContent(/Original estimate\s*2h/)
    expect(time).toHaveTextContent(/Time spent\s*3h/)
    expect(time).toHaveTextContent(OF_WHICH)
    expect(time).toHaveTextContent(/Left\s*2h/)
    expect(within(panel).queryByText('5h from its subtasks')).toBe(null)
    await expectNoAccessibilityProblems(container)
  })
})

describe('Time: the timer', () => {
  // Criteria 26 and 44.
  it('starts a timer that shows the running time, with a Stop button', async () => {
    const { user, api, container } = openCard()
    const time = await timeSection(await cardPanel())

    await user.click(await within(time).findByRole('button', { name: START }))

    expect(sentTo(api, /\/timer$/)).toEqual([
      { request: `POST /api/cards/${login.id}/timer`, body: {} },
    ])
    expect(
      await within(time).findByRole('button', { name: STOP }),
    ).toBeInTheDocument()
    expect(within(time).queryByRole('button', { name: START })).toBe(null)
    await expectClock(time, 0)
    await vi.advanceTimersByTimeAsync(65 * 1000)
    await expectClock(time, 65)
    await expectNoAccessibilityProblems(container)
  })

  // Criterion 26: the time counts from startedAt, not from when the panel opened.
  it('counts the running time from when the timer was started', async () => {
    openCard(login, {
      time: {
        timer: { cardId: login.id, startedAt: ago(HOUR + 2 * MINUTE + 5000) },
      },
    })
    const time = await timeSection(await cardPanel())

    await expectClock(time, 3725)
    expect(within(time).getByRole('button', { name: STOP })).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    await expectClock(time, 3785)
  })

  // Panel-wide pattern from 7b: a refusal that is not the server's words.
  it('says it could not start when the server fails, and keeps the Start button', async () => {
    const { user } = openCard()
    server.use(
      http.post(`/api/cards/${login.id}/timer`, () => apiError(500, 'Broken')),
    )
    const panel = await cardPanel()
    const time = await timeSection(panel)

    await user.click(await within(time).findByRole('button', { name: START }))

    expect(await within(panel).findByText(SAVE_FAILED)).toBeInTheDocument()
    expect(
      within(time).getByRole('button', { name: START }),
    ).toBeInTheDocument()
  })

  // Criterion 27 and 44.
  it('asks before stopping a timer running on another card, then stops it and starts here', async () => {
    const old = backlogCard('7', 'Old task')
    const { user, api } = openCard(login, {
      elsewhere: [old],
      time: { timer: { cardId: old.id, startedAt: ago(10 * MINUTE) } },
    })
    const time = await timeSection(await cardPanel())

    await user.click(await within(time).findByRole('button', { name: START }))
    const dialog = await screen.findByRole('dialog')
    // The number comes from the card the timer runs on (GET /cards/:id).
    expect(dialog).toHaveTextContent(RUNNING_ELSEWHERE)
    await expectNoAccessibilityProblems(document.body)
    await user.click(within(dialog).getByRole('button', { name: YES }))

    await waitFor(() =>
      expect(sentTo(api, /\/timer$/).at(-1)).toEqual({
        request: `POST /api/cards/${login.id}/timer`,
        body: { stopRunning: true },
      }),
    )
    await expectClock(time, 0)
    expect(
      await within(time).findByRole('button', { name: STOP }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBe(null)
  })

  // Criterion 27.
  it('sends nothing more when the question is cancelled, and gives focus back to Start timer', async () => {
    const old = backlogCard('7', 'Old task')
    const { user, api } = openCard(login, {
      elsewhere: [old],
      time: { timer: { cardId: old.id, startedAt: ago(10 * MINUTE) } },
    })
    const time = await timeSection(await cardPanel())

    await user.click(await within(time).findByRole('button', { name: START }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBe(null))
    expect(
      sentTo(api, /\/timer$/).filter(
        (r) => (r.body as { stopRunning?: boolean } | undefined)?.stopRunning,
      ),
    ).toEqual([])
    expect(sentTo(api, /^DELETE/)).toEqual([])
    expect(within(time).getByRole('button', { name: START })).toHaveFocus()
  })

  // Criterion 28.
  it('says nothing was saved when the timer ran under half a minute', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()
    const time = await timeSection(panel)
    await user.click(await within(time).findByRole('button', { name: START }))

    await user.click(await within(time).findByRole('button', { name: STOP }))

    expect(
      await within(panel).findByText(UNDER_HALF_MINUTE),
    ).toBeInTheDocument()
    expect(sentTo(api, /^DELETE/)).toEqual([
      { request: 'DELETE /api/timer', body: undefined },
    ])
    expect(
      await within(time).findByRole('button', { name: START }),
    ).toBeInTheDocument()
    expect(within(time).queryByText(CLOCK)).toBe(null)
  })

  // Criterion 28 and 44: the saved time shows in the entries and the totals.
  it('reloads the entries and the totals when stopping saves time', async () => {
    const { user, container } = openCard(login, {
      time: { timer: { cardId: login.id, startedAt: ago(5 * MINUTE) } },
    })
    const panel = await cardPanel()
    const time = await timeSection(panel)

    await user.click(await within(time).findByRole('button', { name: STOP }))

    const row = await entryRow(time, 'Timer')
    expect(row).toHaveTextContent('5m')
    expect(row).toHaveTextContent('Ana')
    await waitFor(() => expect(time).toHaveTextContent(/Time spent\s*5m/))
    expect(within(panel).queryByText(UNDER_HALF_MINUTE)).toBe(null)
    expect(within(time).queryByText(CLOCK)).toBe(null)
    await expectNoAccessibilityProblems(container)
  })
})

// The chip in the top bar, on every signed-in screen (criterion 29).
function runningOn(card: ReturnType<typeof boardCard>, startedAt: string) {
  let timer: object | null = {
    userId: ana.id,
    projectId: website.id,
    cardId: card.id,
    startedAt,
    workDate: `${startedAt.slice(0, 10)}T00:00:00.000Z`,
  }
  const stops: string[] = []
  server.use(
    http.get('/api/timer', () => HttpResponse.json({ timer })),
    http.get(`/api/cards/${card.id}`, () =>
      HttpResponse.json({ ...card, chat: null }),
    ),
    http.delete('/api/timer', () => {
      stops.push('DELETE /api/timer')
      timer = null
      return HttpResponse.json({ entry: null })
    }),
  )
  return { stops }
}

function chip() {
  return screen.findByRole('group', { name: CHIP })
}

describe('The running-timer chip in the top bar', () => {
  // Criteria 29 and 44.
  it('shows the card number as a link, the running time and Stop on any screen, and Stop removes it', async () => {
    const old = boardCard('7', 'Old task')
    const { stops } = runningOn(old, ago(125 * 1000))
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
    )
    const { user } = renderApp('/projects')

    const found = await chip()
    const link = within(found).getByRole('link', { name: /WEB-7/ })
    expect(link).toHaveAttribute('href', '/WEB-7')
    await expectClock(found, 125)
    await vi.advanceTimersByTimeAsync(10 * 1000)
    await expectClock(found, 135)
    await expectNoAccessibilityProblems(document.body)

    await user.click(within(found).getByRole('button', { name: STOP }))

    await waitFor(() =>
      expect(screen.queryByRole('group', { name: CHIP })).toBe(null),
    )
    expect(stops).toEqual(['DELETE /api/timer'])
  })

  it('shows no chip when no timer is running', async () => {
    let asked = false
    server.use(
      signedInAs(ana),
      http.get('/api/projects', () => HttpResponse.json([])),
      http.get('/api/timer', () => {
        asked = true
        return HttpResponse.json({ timer: null })
      }),
    )
    renderApp('/projects')

    await screen.findByRole('button', { name: 'Account menu for Ana' })
    await waitFor(() => expect(asked).toBe(true))
    expect(screen.queryByRole('group', { name: CHIP })).toBe(null)
  })

  it('shows a timer started in the card panel without a reload, and takes it away when stopped there', async () => {
    const { user } = openCard()
    const time = await timeSection(await cardPanel())

    await user.click(await within(time).findByRole('button', { name: START }))
    const found = await chip()
    expect(within(found).getByRole('link', { name: /WEB-12/ })).toHaveAttribute(
      'href',
      '/WEB-12',
    )

    await user.click(await within(time).findByRole('button', { name: STOP }))
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: CHIP })).toBe(null),
    )
  })

  it('shows Start in the card panel again when Stop is pressed on the chip', async () => {
    const { user, api } = openCard(login, {
      time: { timer: { cardId: login.id, startedAt: ago(2 * MINUTE) } },
    })
    const time = await timeSection(await cardPanel())
    const found = await chip()
    await expectClock(time, 120)

    await user.click(within(found).getByRole('button', { name: STOP }))

    await waitFor(() =>
      expect(screen.queryByRole('group', { name: CHIP })).toBe(null),
    )
    expect(
      await within(time).findByRole('button', { name: START }),
    ).toBeInTheDocument()
    expect(within(time).queryByText(CLOCK)).toBe(null)
    expect(sentTo(api, /^DELETE/)).toEqual([
      { request: 'DELETE /api/timer', body: undefined },
    ])
  })

  it('looks again when the person comes back to the tab', async () => {
    openCard()
    await cardPanel()
    expect(screen.queryByRole('group', { name: CHIP })).toBe(null)

    // The timer was started on another device.
    runningOn(boardCard('7', 'Old task'), ago(MINUTE))
    window.dispatchEvent(new Event('visibilitychange'))

    expect(await chip()).toHaveTextContent('WEB-7')
  })
})

describe('Log time', () => {
  async function openForm(project = website) {
    const { user, api, container } = openCard(login, { project })
    const panel = await cardPanel()
    const time = await timeSection(panel)
    await user.click(
      await within(time).findByRole('button', { name: LOG_TIME }),
    )
    return { user, api, container, panel, time }
  }

  // Criteria 30 and 44. 20:00 UTC is already 8 November in Auckland.
  it('starts on today in the project’s time zone, names the zone and does not take a later day', async () => {
    vi.setSystemTime(new Date('2026-11-07T20:00:00.000Z'))
    const { time, container } = await openForm({
      ...website,
      timeZone: 'Pacific/Auckland',
    })

    const date = within(time).getByLabelText(DATE)
    expect(date).toHaveValue('2026-11-08')
    expect(date).toHaveAttribute('max', '2026-11-08')
    expect(date).toHaveAccessibleDescription(/Pacific\/Auckland/)
    await expectNoAccessibilityProblems(container)
  })

  it('is still the day before in a zone west of UTC', async () => {
    vi.setSystemTime(new Date('2026-11-07T03:00:00.000Z'))
    const { time } = await openForm({
      ...website,
      timeZone: 'America/Los_Angeles',
    })

    const date = within(time).getByLabelText(DATE)
    expect(date).toHaveValue('2026-11-06')
    expect(date).toHaveAttribute('max', '2026-11-06')
    expect(date).toHaveAccessibleDescription(/America\/Los_Angeles/)
  })

  // Criterion 30.
  it('sends the minutes, the day and the note, and shows the new entry', async () => {
    const { user, api, time } = await openForm()

    await typeInto(user, within(time).getByLabelText(HOURS), '1')
    await typeInto(user, within(time).getByLabelText(MINUTES), '30')
    fireEvent.change(within(time).getByLabelText(DATE), {
      target: { value: '2026-11-05' },
    })
    await typeInto(user, within(time).getByLabelText(NOTE), 'Reviewed the form')
    await user.click(within(time).getByRole('button', { name: SAVE }))

    await waitFor(() =>
      expect(sentTo(api, /time-entries$/)).toEqual([
        {
          request: `POST /api/cards/${login.id}/time-entries`,
          body: {
            minutes: 90,
            workDate: '2026-11-05',
            note: 'Reviewed the form',
          },
        },
      ]),
    )
    const row = await entryRow(time, 'Reviewed the form')
    expect(row).toHaveTextContent('Ana')
    expect(row).toHaveTextContent('5 Nov')
    expect(row).toHaveTextContent('1h 30m')
    await waitFor(() => expect(time).toHaveTextContent(/Time spent\s*1h 30m/))
  })

  it('leaves the note out when there is none, and uses today', async () => {
    const { user, api, time } = await openForm()

    await typeInto(user, within(time).getByLabelText(MINUTES), '45')
    await user.click(within(time).getByRole('button', { name: SAVE }))

    await waitFor(() =>
      expect(sentTo(api, /time-entries$/)).toEqual([
        {
          request: `POST /api/cards/${login.id}/time-entries`,
          body: { minutes: 45, workDate: '2026-11-07' },
        },
      ]),
    )
  })

  // Criterion 30: the shared rule (1 minute to 24 hours) is checked first.
  it('shows the shared rule’s error and sends nothing for no time at all', async () => {
    const { user, api, time } = await openForm()

    await user.click(within(time).getByRole('button', { name: SAVE }))

    expect(
      await within(time).findByText(ruleMessage({ minutes: 0 })),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([])
  })

  it('shows the shared rule’s error and sends nothing for more than 24 hours', async () => {
    const { user, api, time } = await openForm()

    await typeInto(user, within(time).getByLabelText(HOURS), '24')
    await typeInto(user, within(time).getByLabelText(MINUTES), '1')
    await user.click(within(time).getByRole('button', { name: SAVE }))

    expect(
      await within(time).findByText(ruleMessage({ minutes: 24 * 60 + 1 })),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([])
  })

  // Owner's answer in 7b: limits are checked before saving.
  it('shows the shared rule’s error and sends nothing for a note that is too long', async () => {
    const { user, api, time } = await openForm()
    const note = 'x'.repeat(1001)

    await typeInto(user, within(time).getByLabelText(MINUTES), '5')
    fireEvent.change(within(time).getByLabelText(NOTE), {
      target: { value: note },
    })
    await user.click(within(time).getByRole('button', { name: SAVE }))

    expect(
      await within(time).findByText(ruleMessage({ minutes: 5, note })),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([])
  })

  // Criterion 31.
  it('shows the API’s message when it refuses a day that has not started in the project’s zone, and keeps what was typed', async () => {
    const { user, panel, time } = await openForm()
    const message =
      'Time can’t be logged for a day that hasn’t started yet in the project’s time zone (UTC)'
    server.use(
      http.post(`/api/cards/${login.id}/time-entries`, () =>
        apiError(400, message),
      ),
    )

    await typeInto(user, within(time).getByLabelText(HOURS), '1')
    fireEvent.change(within(time).getByLabelText(DATE), {
      target: { value: '2026-11-09' },
    })
    await user.click(within(time).getByRole('button', { name: SAVE }))

    expect(await within(panel).findByText(message)).toBeInTheDocument()
    expect(within(time).getByLabelText(HOURS)).toHaveValue('1')
    expect(within(time).getByLabelText(DATE)).toHaveValue('2026-11-09')
  })

  it('drops the field name the API puts in front of its message', async () => {
    const { user, panel, time } = await openForm()
    server.use(
      http.post(`/api/cards/${login.id}/time-entries`, () =>
        apiError(400, 'minutes: Too small'),
      ),
    )

    await typeInto(user, within(time).getByLabelText(MINUTES), '5')
    await user.click(within(time).getByRole('button', { name: SAVE }))

    expect(await within(panel).findByText('Too small')).toBeInTheDocument()
    expect(within(panel).queryByText(/^minutes:/)).toBe(null)
  })

  it('closes the form on Cancel without sending anything', async () => {
    const { user, api, time } = await openForm()

    await user.click(within(time).getByRole('button', { name: 'Cancel' }))

    expect(within(time).queryByLabelText(HOURS)).toBe(null)
    expect(within(time).getByRole('button', { name: LOG_TIME })).toHaveFocus()
    expect(api.requests).toEqual([])
  })
})

describe('The entries', () => {
  // Criteria 32 and 44.
  it('lists the entries with the latest day first: person, date, duration, note and a Timer tag', async () => {
    const card = boardCard('12', 'Login page')
    const { container } = openCard(card, {
      time: {
        entries: {
          [card.id]: [
            entry(ana, 90, '2026-11-02', {
              note: 'Sign-in form',
              startedAt: '2026-11-02T09:00:00.000Z',
            }),
            entry(ben, 45, '2026-11-03', { note: 'Reviewed' }),
          ],
        },
      },
    })
    const time = await timeSection(await cardPanel())

    const newer = await entryRow(time, 'Reviewed')
    const older = await entryRow(time, 'Sign-in form')
    expect(entryTexts(time)).toEqual([newer.textContent, older.textContent])
    expect(newer).toHaveTextContent('Ben')
    expect(newer).toHaveTextContent('3 Nov')
    expect(newer).toHaveTextContent('45m')
    expect(within(newer).queryByText('Timer')).toBe(null)
    expect(older).toHaveTextContent('Ana')
    expect(older).toHaveTextContent('2 Nov')
    expect(older).toHaveTextContent('1h 30m')
    expect(within(older).getByText('Timer')).toBeInTheDocument()
    await expectNoAccessibilityProblems(container)
  })

  // Criterion 32: a date is a day, not a moment, so no zone moves it.
  it('shows 2 Nov for a day saved as midnight UTC, whatever the browser’s or the project’s zone', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    // The set-up works: here midnight UTC is still the day before.
    expect(new Date('2026-11-02T00:00:00.000Z').getDate()).toBe(1)
    const card = boardCard('12', 'Login page')
    openCard(card, {
      project: { ...website, timeZone: 'America/Los_Angeles' },
      time: {
        entries: {
          [card.id]: [entry(ana, 60, '2026-11-02', { note: 'Wireframes' })],
        },
      },
    })
    const time = await timeSection(await cardPanel())

    const row = await entryRow(time, 'Wireframes')
    expect(row).toHaveTextContent('2 Nov')
    expect(row).not.toHaveTextContent('1 Nov')
  })

  // Criterion 33.
  it('flags an entry that needs review, and Confirm sends an empty change and clears the flag', async () => {
    const card = boardCard('12', 'Login page')
    const flagged = entry(ben, 24 * 60, '2026-11-02', {
      note: 'Left running',
      startedAt: '2026-11-02T09:00:00.000Z',
      needsReview: true,
    })
    const { user, api, container } = openCard(card, {
      time: { entries: { [card.id]: [flagged] } },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'Left running')
    expect(row).toHaveTextContent(NEEDS_REVIEW)
    await expectNoAccessibilityProblems(container)

    await user.click(within(row).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(sentTo(api, /time-entries/)).toEqual([
        { request: `PATCH /api/time-entries/${flagged.id}`, body: {} },
      ]),
    )
    await waitFor(() =>
      expect(within(time).queryByText(NEEDS_REVIEW)).toBe(null),
    )
    expect(within(time).queryByRole('button', { name: 'Confirm' })).toBe(null)
    expect(await entryRow(time, 'Left running')).toBeInTheDocument()
  })

  it('shows no flag and no Confirm on an entry that is fine', async () => {
    const card = boardCard('12', 'Login page')
    openCard(card, {
      time: { entries: { [card.id]: [entry(ana, 30, '2026-11-02')] } },
    })
    const time = await timeSection(await cardPanel())

    await waitFor(() => expect(entryTexts(time)).toHaveLength(1))
    expect(within(time).queryByText(NEEDS_REVIEW)).toBe(null)
    expect(within(time).queryByRole('button', { name: 'Confirm' })).toBe(null)
  })
})

// Entries to change: Ben's own, Ana's (a project admin), by age.
function mine(createdAt: string) {
  return entry(ben, 90, '2026-11-02', { note: 'My work', createdAt })
}

function hers(createdAt: string) {
  return entry(ana, 60, '2026-11-03', { note: 'Her work', createdAt })
}

describe('Changing an entry: your own, within 24 hours', () => {
  // Criterion 34.
  it('opens a form with the entry’s values and sends only what changed', async () => {
    const card = boardCard('12', 'Login page')
    const own = mine(ago(2 * HOUR))
    const { user, api, container } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [own] } },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(within(time).getByLabelText(HOURS)).toHaveValue('1')
    expect(within(time).getByLabelText(MINUTES)).toHaveValue('30')
    expect(within(time).getByLabelText(DATE)).toHaveValue('2026-11-02')
    expect(within(time).getByLabelText(NOTE)).toHaveValue('My work')
    await expectNoAccessibilityProblems(container)

    await replaceText(user, within(time).getByLabelText(MINUTES), '45')
    await user.click(within(time).getByRole('button', { name: SAVE }))

    await waitFor(() =>
      expect(sentTo(api, /time-entries/)).toEqual([
        { request: `PATCH /api/time-entries/${own.id}`, body: { minutes: 105 } },
      ]),
    )
    expect(await entryRow(time, 'My work')).toHaveTextContent('1h 45m')
  })

  it('sends a changed day, and null for a note that was cleared, but not the minutes', async () => {
    const card = boardCard('12', 'Login page')
    const own = mine(ago(2 * HOUR))
    const { user, api } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [own] } },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(time).getByLabelText(DATE), {
      target: { value: '2026-11-01' },
    })
    await replaceText(user, within(time).getByLabelText(NOTE), '')
    await user.click(within(time).getByRole('button', { name: SAVE }))

    await waitFor(() =>
      expect(sentTo(api, /time-entries/)).toEqual([
        {
          request: `PATCH /api/time-entries/${own.id}`,
          body: { workDate: '2026-11-01', note: null },
        },
      ]),
    )
  })

  it('checks the shared rule before saving an edit, and Cancel sends nothing and gives focus back to Edit', async () => {
    const card = boardCard('12', 'Login page')
    const own = mine(ago(2 * HOUR))
    const { user, api } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [own] } },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    await replaceText(user, within(time).getByLabelText(HOURS), '')
    await replaceText(user, within(time).getByLabelText(MINUTES), '')
    await user.click(within(time).getByRole('button', { name: SAVE }))
    expect(
      await within(time).findByText(ruleMessage({ minutes: 0 })),
    ).toBeInTheDocument()
    expect(api.requests).toEqual([])

    await user.click(within(time).getByRole('button', { name: 'Cancel' }))
    expect(within(time).queryByLabelText(HOURS)).toBe(null)
    const again = await entryRow(time, 'My work')
    expect(within(again).getByRole('button', { name: 'Edit' })).toHaveFocus()
    expect(api.requests).toEqual([])
  })

  it('can still change it at 23 hours 59 minutes', async () => {
    const card = boardCard('12', 'Login page')
    openCard(card, {
      me: ben,
      time: {
        entries: { [card.id]: [mine(ago(24 * HOUR - MINUTE))] },
      },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')

    expectTurnedOn(within(row).getByRole('button', { name: 'Edit' }))
    expectTurnedOn(within(row).getByRole('button', { name: 'Delete' }))
  })

  // Criterion 34 and 44.
  it('asks “Are you sure?” before deleting, and Cancel sends nothing and gives focus back to Delete', async () => {
    const card = boardCard('12', 'Login page')
    const own = mine(ago(2 * HOUR))
    const { user, api } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [own] } },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')

    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Are you sure?')
    await expectNoAccessibilityProblems(document.body)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBe(null))
    expect(api.requests).toEqual([])
    const again = await entryRow(time, 'My work')
    expect(within(again).getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('deletes the entry once confirmed, and the totals follow', async () => {
    const card = boardCard('12', 'Login page')
    const own = mine(ago(2 * HOUR))
    const { user, api } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [own] } },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')
    await waitFor(() => expect(time).toHaveTextContent(/Time spent\s*1h 30m/))

    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(sentTo(api, /time-entries/)).toEqual([
        { request: `DELETE /api/time-entries/${own.id}`, body: undefined },
      ]),
    )
    await waitFor(() => expect(within(time).queryByText('My work')).toBe(null))
    expect(time).not.toHaveTextContent(/Time spent\s*1h 30m/)
  })

  // Criterion 36: a refusal from the server still reaches the screen.
  it('shows the API’s message when it still refuses an edit', async () => {
    const card = boardCard('12', 'Login page')
    const { user } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [mine(ago(2 * HOUR))] } },
    })
    const message =
      'Time can be changed for 24 hours after it is logged; after that, ask a project admin'
    server.use(
      http.patch('/api/time-entries/:entryId', () => apiError(403, message)),
    )
    const panel = await cardPanel()
    const time = await timeSection(panel)
    const row = await entryRow(time, 'My work')

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    await replaceText(user, within(time).getByLabelText(MINUTES), '45')
    await user.click(within(time).getByRole('button', { name: SAVE }))

    expect(await within(panel).findByText(message)).toBeInTheDocument()
  })

  it('shows the API’s message when it still refuses a delete', async () => {
    const card = boardCard('12', 'Login page')
    const { user } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [mine(ago(2 * HOUR))] } },
    })
    const message = NOT_YOURS.replace('’', "'")
    server.use(
      http.delete('/api/time-entries/:entryId', () => apiError(403, message)),
    )
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')

    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByText(message)).toBeInTheDocument()
  })
})

describe('Changing an entry: when you may not', () => {
  // Criterion 36 and 44, owner's wording.
  it('turns Edit and Delete off with the reason on your own entry older than 24 hours', async () => {
    const card = boardCard('12', 'Login page')
    const { container } = openCard(card, {
      me: ben,
      time: {
        entries: { [card.id]: [mine(ago(24 * HOUR + MINUTE))] },
      },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')

    for (const name of ['Edit', 'Delete']) {
      const button = within(row).getByRole('button', { name })
      expectTurnedOff(button)
      expect(button).toHaveAccessibleDescription(TOO_OLD)
    }
    await expectNoAccessibilityProblems(container)
  })

  it('turns Edit and Delete off with the reason on someone else’s entry', async () => {
    const card = boardCard('12', 'Login page')
    const { container } = openCard(card, {
      me: ben,
      time: {
        entries: {
          [card.id]: [mine(ago(2 * HOUR)), hers(ago(HOUR))],
        },
      },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'Her work')

    for (const name of ['Edit', 'Delete']) {
      const button = within(row).getByRole('button', { name })
      expectTurnedOff(button)
      expect(button).toHaveAccessibleDescription(NOT_YOURS)
    }
    // His own is still open to him.
    const own = await entryRow(time, 'My work')
    expectTurnedOn(within(own).getByRole('button', { name: 'Edit' }))
    await expectNoAccessibilityProblems(container)
  })
})

describe('Changing an entry: a project admin', () => {
  // Criterion 35.
  it('can edit and delete anyone’s entry of any age', async () => {
    const card = boardCard('12', 'Login page')
    const old = mine(ago(72 * HOUR))
    const anas = hers(ago(48 * HOUR))
    const { user, api } = openCard(card, {
      me: ana,
      time: { entries: { [card.id]: [old, anas] } },
    })
    const time = await timeSection(await cardPanel())
    const row = await entryRow(time, 'My work')
    const hersRow = await entryRow(time, 'Her work')
    expectTurnedOn(within(hersRow).getByRole('button', { name: 'Edit' }))
    expectTurnedOn(within(hersRow).getByRole('button', { name: 'Delete' }))

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    await replaceText(user, within(time).getByLabelText(MINUTES), '15')
    await user.click(within(time).getByRole('button', { name: SAVE }))
    await waitFor(() =>
      expect(sentTo(api, /time-entries/)).toEqual([
        { request: `PATCH /api/time-entries/${old.id}`, body: { minutes: 75 } },
      ]),
    )

    const again = await entryRow(time, 'My work')
    await user.click(within(again).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(sentTo(api, /^DELETE/)).toEqual([
        { request: `DELETE /api/time-entries/${old.id}`, body: undefined },
      ]),
    )
    await waitFor(() => expect(within(time).queryByText('My work')).toBe(null))
  })
})

describe('Deleting a card that has time logged', () => {
  async function refuseDelete(user: ReturnType<typeof renderApp>['user']) {
    server.use(
      http.delete(`/api/cards/:cardId`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Cards with logged time cannot be deleted',
            loggedMinutes: 200,
          },
          { status: 409 },
        ),
      ),
    )
    const panel = await cardPanel()
    await user.click(within(panel).getByRole('button', { name: 'Delete card' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    )
    return { panel, dialog }
  }

  // Criterion 37.
  it('gives a project admin a link from the refusal to the entries', async () => {
    const card = boardCard('12', 'Login page')
    const { user } = openCard(card, {
      me: ana,
      time: { entries: { [card.id]: [entry(ana, 200, '2026-11-02')] } },
    })
    const { panel, dialog } = await refuseDelete(user)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      DELETE_REFUSED,
    )
    await user.click(within(dialog).getByRole('link', { name: SEE_ENTRIES }))

    expect(within(panel).getByRole('heading', { name: ENTRIES })).toHaveFocus()
  })

  it('gives anyone else the message without a link', async () => {
    const card = boardCard('12', 'Login page', { createdById: ben.id })
    const { user } = openCard(card, {
      me: ben,
      time: { entries: { [card.id]: [entry(ben, 200, '2026-11-02')] } },
    })
    // The entries are there to go to, for those who may.
    await timeSection(await cardPanel())
    const { dialog } = await refuseDelete(user)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      DELETE_REFUSED,
    )
    expect(within(dialog).queryByRole('link', { name: SEE_ENTRIES })).toBe(null)
  })
})
