import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { cardPanel, login, openCard, typeInto } from '../test/card-panel'
import { activityLine, fakeActivity } from '../test/fake-activity'
import { ben } from '../test/fake-board'
import { apiError, server } from '../test/server'

// Web PR 7d: the Details and Activity tabs, and the Activity tab (acceptance
// criteria 1, 2, 38 and 40 to 44; docs/card-features.md, section 9;
// docs/web-app.md, section 1). The sentences themselves are tested in
// activity-sentence.test.ts.

// Wording the owner decided (plan and criteria).
const DETAILS = 'Details'
const ACTIVITY = 'Activity'
const SHOW_OLDER = 'Show older' // criterion 40
const SHOW_CHANGES = 'Show changes' // criterion 42
const DELETED_ACCOUNT = 'A deleted account'

// Wording and details agreed 2026-11-08 (“(agreed 2026-11-08)”, to approve).
const TABS = 'Card sections' // the tab list's name (agreed 2026-11-08)
const BEFORE = 'Before' // criterion 42, agreed 2026-11-08; a group with the old text
const AFTER = 'After' // a group with the new text
const EMPTY_TEXT = '(empty)' // an empty old or new description
const NO_ACTIVITY = 'No activity yet' // a card with no history (agreed 2026-11-08)
const LOAD_FAILED = 'Couldn’t load the activity' // (agreed 2026-11-08)
const TRY_AGAIN = 'Try again' // retries the failed load (agreed 2026-11-08)

const NOW = '2026-11-07T10:00:00.000Z'
const HOUR = 3_600_000

// A fixed clock, so “3 hours ago” is the same every time.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString()
}

const moved = (to = 'In progress') => ({
  from: { columnId: 'c1', name: 'To do' },
  to: { columnId: 'c2', name: to },
})

// Opens the card with the given history and switches to the Activity tab.
async function openActivity(lines = [activityLine('MOVED', moved())]) {
  const activity = fakeActivity(lines)
  server.use(activity.handler)
  const app = openCard()
  const panel = await cardPanel()
  await app.user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
  const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
  return { ...app, activity, panel, tab }
}

function lines(tab: HTMLElement) {
  return within(within(tab).getByRole('list', { name: ACTIVITY })).getAllByRole(
    'listitem',
  )
}

describe('The panel’s tabs', () => {
  // 1
  it('has Details and Activity tabs, and opens on Details', async () => {
    openCard()
    const panel = await cardPanel()

    const tabs = within(panel).getByRole('tablist', { name: TABS })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual([DETAILS, ACTIVITY])
    expect(within(tabs).getByRole('tab', { name: DETAILS })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(tabs).getByRole('tab', { name: ACTIVITY })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    // Details holds the card's fields; Activity is not shown yet.
    expect(
      within(panel).getByRole('tabpanel', { name: DETAILS }),
    ).toContainElement(within(panel).getByLabelText('Title'))
    expect(
      within(panel).queryByRole('tabpanel', { name: ACTIVITY }),
    ).not.toBeInTheDocument()
  })

  // 1
  it('shows only Activity when it is chosen, and Details again when it is chosen back', async () => {
    const { user } = openCard()
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    expect(
      await within(panel).findByRole('tabpanel', { name: ACTIVITY }),
    ).toBeVisible()
    expect(
      within(panel).queryByRole('textbox', { name: 'Title' }),
    ).not.toBeInTheDocument()
    // The card's header stays: closing is possible from either tab.
    expect(
      within(panel).getByRole('button', { name: 'Close card' }),
    ).toBeVisible()

    await user.click(within(panel).getByRole('tab', { name: DETAILS }))
    expect(within(panel).getByRole('textbox', { name: 'Title' })).toBeVisible()
    expect(
      within(panel).queryByRole('tabpanel', { name: ACTIVITY }),
    ).not.toBeInTheDocument()
  })

  // 1
  it('moves between the tabs with the arrow keys', async () => {
    const { user } = openCard()
    const panel = await cardPanel()

    within(panel).getByRole('tab', { name: DETAILS }).focus()
    await user.keyboard('{ArrowRight}')

    expect(within(panel).getByRole('tab', { name: ACTIVITY })).toHaveFocus()
    expect(
      await within(panel).findByRole('tabpanel', { name: ACTIVITY }),
    ).toBeVisible()
  })

  // 2
  it('keeps what is typed in an open box while Activity is shown', async () => {
    const { user } = openCard()
    const panel = await cardPanel()
    await user.click(
      within(panel).getByRole('button', { name: 'Add checklist' }),
    )
    await typeInto(
      user,
      within(panel).getByLabelText('Checklist name'),
      'Testi',
    )

    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    await user.click(within(panel).getByRole('tab', { name: DETAILS }))

    expect(within(panel).getByLabelText('Checklist name')).toHaveValue('Testi')
  })

  // 2
  it('keeps an unsaved description while Activity is shown, and still asks before the card is left', async () => {
    const { user, api } = openCard()
    const panel = await cardPanel()
    await user.click(
      within(panel).getByRole('button', { name: 'Edit description' }),
    )
    const editor = await within(panel).findByRole('textbox', {
      name: 'Description',
    })
    await typeInto(user, editor, 'Half written')

    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    // Leaving the card from the Activity tab asks the same question.
    await user.click(within(panel).getByRole('button', { name: 'Close card' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Discard your changes?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.click(within(panel).getByRole('tab', { name: DETAILS }))
    expect(
      within(panel).getByRole('textbox', { name: 'Description' }),
    ).toHaveTextContent('Half written')
    expect(api.requests).toEqual([])
  })

  // 2
  it('keeps the Details fields in the page while Activity is shown', async () => {
    const { user } = openCard()
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))

    // Hidden, not taken away (the description editor must not be thrown
    // away with its unsaved text).
    expect(within(panel).getByLabelText('Title')).toBeInTheDocument()
    expect(within(panel).getByLabelText('Title')).not.toBeVisible()
  })

  // 44
  it('has no accessibility problems', async () => {
    const { container, user } = openCard()
    const panel = await cardPanel()
    await expectNoAccessibilityProblems(container)
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await expectNoAccessibilityProblems(container)
  })
})

describe('The Activity tab', () => {
  // 38
  it('asks for the history only when it is opened, 50 lines at a time', async () => {
    const activity = fakeActivity([activityLine('MOVED', moved())])
    server.use(activity.handler)
    const { user } = openCard()
    const panel = await cardPanel()
    await within(panel).findByLabelText('Title')
    expect(activity.requests).toHaveLength(0)

    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))

    await waitFor(() => expect(activity.requests).toHaveLength(1))
    const url = activity.requests[0]!
    expect(url.pathname).toBe(`/api/cards/${login.id}/activity`)
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.has('before')).toBe(false)
  })

  // 38
  it('lists the lines newest first, each with the person, the sentence and when', async () => {
    const { tab } = await openActivity([
      activityLine('MOVED', moved(), { createdAt: ago(3 * HOUR) }),
      activityLine(
        'TITLE_CHANGED',
        { from: 'Login', to: 'Login page' },
        { actor: ben, createdAt: ago(50 * HOUR) },
      ),
    ])

    await waitFor(() => expect(lines(tab)).toHaveLength(2))
    const [first, second] = lines(tab)
    expect(first).toHaveTextContent(
      /^Ana\s*moved this from To do to In progress\s*3 hours ago/,
    )
    expect(second).toHaveTextContent(
      /^Ben\s*renamed this from .Login. to .Login page.\s*2 days ago/,
    )
  })

  // 38
  it('shows when as a time element: “3 hours ago”, with the exact time in the viewer’s zone on hover and for screen readers', async () => {
    vi.stubEnv('TZ', 'Pacific/Auckland') // the viewer's zone, not the project's
    const createdAt = ago(3 * HOUR)
    const { tab } = await openActivity([
      activityLine('MOVED', moved(), { createdAt }),
    ])

    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    const time = lines(tab)[0]!.querySelector('time')!
    expect(time).toHaveAttribute('datetime', createdAt)
    expect(time).toHaveTextContent('3 hours ago')
    // 07:00 UTC on 7 Nov is 20:00 in Auckland. (Format agreed 2026-11-08.)
    expect(time).toHaveAttribute('title', '7 Nov 2026, 20:00')
    // Not only a hover tip: the exact time is in the line's text too, for
    // a screen reader.
    expect(lines(tab)[0]).toHaveTextContent('7 Nov 2026, 20:00')
  })

  // 38
  it('uses the names saved in the line', async () => {
    const { tab } = await openActivity([
      activityLine('MOVED', moved(), {
        actor: { id: ben.id, displayName: 'Ben (old name)' },
      }),
    ])

    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    expect(lines(tab)[0]).toHaveTextContent(/^Ben \(old name\)\s*moved this/)
  })

  // 41
  it('shows a deleted person as “A deleted account”', async () => {
    const { tab } = await openActivity([
      activityLine('MOVED', moved(), { actor: null }),
    ])

    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    expect(lines(tab)[0]).toHaveTextContent(
      `${DELETED_ACCOUNT} moved this from To do to In progress`,
    )
  })

  it('says so when the card has no history yet (agreed 2026-11-08)', async () => {
    const { tab } = await openActivity([])

    expect(await within(tab).findByText(NO_ACTIVITY)).toBeInTheDocument()
    expect(within(tab).queryByRole('list')).not.toBeInTheDocument()
  })

  it('says so when the history cannot be loaded, and tries again on request (agreed 2026-11-08)', async () => {
    server.use(
      http.get('/api/cards/:cardId/activity', () =>
        apiError(500, 'Something went wrong'),
      ),
    )
    const { user } = openCard()
    await user.click(
      within(await cardPanel()).getByRole('tab', { name: ACTIVITY }),
    )
    const tab = await screen.findByRole('tabpanel', { name: ACTIVITY })
    expect(await within(tab).findByRole('alert')).toHaveTextContent(LOAD_FAILED)

    const activity = fakeActivity([activityLine('MOVED', moved())])
    server.use(activity.handler)
    await user.click(within(tab).getByRole('button', { name: TRY_AGAIN }))

    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    expect(within(tab).queryByRole('alert')).not.toBeInTheDocument()
  })

  // 43
  it('has nothing to edit or delete', async () => {
    const { tab } = await openActivity([
      activityLine('MOVED', moved()),
      activityLine('DESCRIPTION_CHANGED', { from: 'Old', to: 'New' }),
    ])

    await waitFor(() => expect(lines(tab)).toHaveLength(2))
    expect(within(tab).queryAllByRole('textbox')).toEqual([])
    expect(within(tab).queryAllByRole('checkbox')).toEqual([])
    expect(within(tab).queryAllByRole('combobox')).toEqual([])
    // The only buttons are for reading more.
    for (const button of within(tab).queryAllByRole('button')) {
      expect(button.textContent).toMatch(
        new RegExp(`^(${SHOW_CHANGES}|${SHOW_OLDER}|${TRY_AGAIN})$`),
      )
    }
  })
})

describe('Paging', () => {
  function manyLines(count: number) {
    // Newest first: “Title 60” is the newest.
    return Array.from({ length: count }, (_, i) =>
      activityLine('TITLE_CHANGED', {
        from: `Title ${count - i - 1}`,
        to: `Title ${count - i}`,
      }),
    )
  }

  // 40
  it('loads 50 and shows older ones on request, then no more button', async () => {
    const { user, tab, activity } = await openActivity(manyLines(60))

    await waitFor(() => expect(lines(tab)).toHaveLength(50))
    expect(lines(tab)[0]).toHaveTextContent(/to .Title 60./)
    const older = within(tab).getByRole('button', { name: SHOW_OLDER })
    // The button is at the bottom, after the lines.
    expect(
      lines(tab)[49]!.compareDocumentPosition(older) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await user.click(older)

    await waitFor(() => expect(lines(tab)).toHaveLength(60))
    expect(activity.requests).toHaveLength(2)
    // “before” is the first page's nextBefore, which is the last line's
    // sequence number (the oldest of the 60 lines is 1).
    expect(activity.requests[1]!.searchParams.get('before')).toBe('11')
    expect(activity.requests[1]!.searchParams.get('limit')).toBe('50')
    // Older lines are added below; the newest stays first.
    expect(lines(tab)[0]).toHaveTextContent(/to .Title 60./)
    expect(lines(tab)[59]).toHaveTextContent(/to .Title 1./)
    expect(
      within(tab).queryByRole('button', { name: SHOW_OLDER }),
    ).not.toBeInTheDocument()
  })

  // 40
  it('has no Show older button when everything fits on one page', async () => {
    const { tab } = await openActivity(manyLines(3))

    await waitFor(() => expect(lines(tab)).toHaveLength(3))
    expect(
      within(tab).queryByRole('button', { name: SHOW_OLDER }),
    ).not.toBeInTheDocument()
  })

  // 40
  it('has no Show older button when the history is exactly one full page', async () => {
    const { tab } = await openActivity(manyLines(50))

    await waitFor(() => expect(lines(tab)).toHaveLength(50))
    expect(
      within(tab).queryByRole('button', { name: SHOW_OLDER }),
    ).not.toBeInTheDocument()
  })

  it('keeps the lines already shown when older ones cannot be loaded (agreed 2026-11-08)', async () => {
    const { user, tab } = await openActivity(manyLines(60))
    await waitFor(() => expect(lines(tab)).toHaveLength(50))
    server.use(
      http.get('/api/cards/:cardId/activity', () =>
        apiError(500, 'Something went wrong'),
      ),
    )

    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))

    expect(await within(tab).findByRole('alert')).toHaveTextContent(LOAD_FAILED)
    expect(lines(tab)).toHaveLength(50)
    expect(
      within(tab).getByRole('button', { name: SHOW_OLDER }),
    ).toBeInTheDocument()
  })

  // Show older is off while the history reloads after a save (agreed
  // 2026-11-08, 7d answers, round 3). A save finishes while Activity is shown
  // and its reload of the newest page is held until `releaseReload` is called.
  async function saveFinishesWhileActivityIsShown() {
    const activity = fakeActivity(manyLines(60))
    server.use(activity.handler)
    const { user } = openCard()
    const panel = await cardPanel()
    let releaseSave!: () => void
    const saveGate = new Promise<void>((r) => (releaseSave = r))
    server.use(
      http.patch(`/api/cards/${login.id}`, async () => {
        await saveGate
        return HttpResponse.json({ ...login, priority: 'HIGH' })
      }),
    )
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await waitFor(() => expect(lines(tab)).toHaveLength(50))

    // Holds the newest-page request, then lets the fake API answer it.
    let reloadHeld = false
    let releaseReload!: () => void
    const reloadGate = new Promise<void>((r) => (releaseReload = r))
    server.use(
      http.get('/api/cards/:cardId/activity', async ({ request }) => {
        if (new URL(request.url).searchParams.has('before')) return
        reloadHeld = true
        await reloadGate
      }),
    )
    activity.lines.unshift(
      activityLine('PRIORITY_CHANGED', { from: 'NONE', to: 'HIGH' }),
    )
    releaseSave()
    await waitFor(() => expect(reloadHeld).toBe(true))
    return { user, tab, activity, releaseReload }
  }

  it('turns Show older off while the history reloads after a save, and on again after (agreed 2026-11-08)', async () => {
    const { tab, releaseReload } = await saveFinishesWhileActivityIsShown()

    expect(within(tab).getByRole('button', { name: SHOW_OLDER })).toBeDisabled()

    releaseReload()

    await waitFor(() =>
      expect(
        within(tab).getByRole('button', { name: SHOW_OLDER }),
      ).toBeEnabled(),
    )
    expect(lines(tab)[0]).toHaveTextContent('changed the priority')
  })

  it('loads nothing older when Show older is tried during the reload, and the saved change is not lost (agreed 2026-11-08)', async () => {
    const { user, tab, activity, releaseReload } =
      await saveFinishesWhileActivityIsShown()

    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))
    expect(activity.requests.some((u) => u.searchParams.has('before'))).toBe(
      false,
    )

    releaseReload()
    await waitFor(() =>
      expect(
        within(tab).getByRole('button', { name: SHOW_OLDER }),
      ).toBeEnabled(),
    )
    expect(lines(tab)[0]).toHaveTextContent('changed the priority')

    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))

    await waitFor(() => expect(lines(tab)).toHaveLength(61))
    expect(lines(tab)[0]).toHaveTextContent('changed the priority')
    expect(
      within(tab).queryByRole('button', { name: SHOW_OLDER }),
    ).not.toBeInTheDocument()
  })

  it('shows both newest changes and the older lines when two saves finish while older lines are loading (agreed 2026-11-08)', async () => {
    const activity = fakeActivity(manyLines(60))
    server.use(activity.handler)
    const { user } = openCard()
    const panel = await cardPanel()
    const saves: Array<() => void> = []
    server.use(
      http.patch(`/api/cards/${login.id}`, async () => {
        await new Promise<void>((r) => saves.push(r))
        return HttpResponse.json({ ...login, priority: 'HIGH' })
      }),
    )
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await waitFor(() => expect(lines(tab)).toHaveLength(50))

    // The older page is held while both saves finish.
    let olderHeld = false
    let releaseOlder!: () => void
    const olderGate = new Promise<void>((r) => (releaseOlder = r))
    server.use(
      http.get('/api/cards/:cardId/activity', async ({ request }) => {
        if (!new URL(request.url).searchParams.has('before')) return
        olderHeld = true
        await olderGate
      }),
    )
    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))
    await waitFor(() => expect(olderHeld).toBe(true))

    await waitFor(() => expect(saves).toHaveLength(1))
    activity.lines.unshift(
      activityLine('PRIORITY_CHANGED', { from: 'NONE', to: 'HIGH' }),
    )
    saves.shift()!()
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'LOW')
    await waitFor(() => expect(saves).toHaveLength(1))
    activity.lines.unshift(
      activityLine('PRIORITY_CHANGED', { from: 'HIGH', to: 'LOW' }),
    )
    saves.shift()!()
    releaseOlder()

    await waitFor(() => expect(lines(tab)).toHaveLength(62))
    expect(lines(tab)[0]).toHaveTextContent('changed the priority')
    expect(lines(tab)[1]).toHaveTextContent('changed the priority')
    expect(lines(tab)[61]).toHaveTextContent(/to .Title 1./)
  })

  it('keeps the older lines when Show older is pressed just as a save finishes (agreed 2026-11-08)', async () => {
    const all = Array.from({ length: 51 }, (_, i) =>
      activityLine('MOVED', moved(`Column ${i + 1}`)),
    )
    server.use(
      http.get('/api/cards/:cardId/activity', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.has('before')) {
          return HttpResponse.json({ items: all.slice(50), nextBefore: null })
        }
        return HttpResponse.json({
          items: all.slice(0, 50),
          nextBefore: all[49]!.id,
        })
      }),
    )
    const { user, queryClient } = openCard()
    const panel = await cardPanel()
    // Presses Show older the moment the save's answer arrives, before the
    // page has drawn again (this listener runs before the Activity tab's).
    let pressAtSave: (() => void) | undefined
    queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') {
        pressAtSave?.()
      }
    })
    let releaseSave!: () => void
    const saveGate = new Promise<void>((r) => (releaseSave = r))
    server.use(
      http.patch(`/api/cards/${login.id}`, async () => {
        await saveGate
        return HttpResponse.json({ ...login, priority: 'HIGH' })
      }),
    )
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    const showOlder = await within(tab).findByRole('button', {
      name: SHOW_OLDER,
    })

    // The person presses Show older and the save's answer arrives in the same
    // moment, before the page has drawn again.
    pressAtSave = () => showOlder.click()
    await act(async () => {
      releaseSave()
      await new Promise((r) => setTimeout(r, 200))
    })

    // The older page must not be dropped; once it is in, everything has
    // loaded and Show older is gone.
    await waitFor(() =>
      expect(screen.getByText(/to Column 51/)).toBeInTheDocument(),
    )
    expect(
      within(tab).queryByRole('button', { name: SHOW_OLDER }),
    ).not.toBeInTheDocument()
  })

  // Older lines load only when Show older (or its retry) is pressed (agreed
  // 2026-11-08, round 4): a save never loads an extra older page and never
  // retries a failed older page by itself. Opens Activity with a save held.
  async function openWithHeldSave(count: number) {
    const activity = fakeActivity(manyLines(count))
    server.use(activity.handler)
    const { user } = openCard()
    const panel = await cardPanel()
    let releaseSave!: () => void
    const saveGate = new Promise<void>((r) => (releaseSave = r))
    server.use(
      http.patch(`/api/cards/${login.id}`, async () => {
        await saveGate
        return HttpResponse.json({ ...login, priority: 'HIGH' })
      }),
    )
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await waitFor(() => expect(lines(tab)).toHaveLength(50))
    return { user, tab, activity, releaseSave }
  }

  it('loads no older page nobody asked for when a save finishes after Show older finished (agreed 2026-11-08)', async () => {
    const { user, tab, activity, releaseSave } = await openWithHeldSave(150)

    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))
    await waitFor(() => expect(lines(tab)).toHaveLength(100))

    activity.lines.unshift(
      activityLine('PRIORITY_CHANGED', { from: 'NONE', to: 'HIGH' }),
    )
    await act(async () => {
      releaseSave()
      await new Promise((r) => setTimeout(r, 300))
    })

    // The new line plus the 100 already shown; not a third page.
    await waitFor(() => expect(lines(tab)).toHaveLength(101))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })
    expect(lines(tab)).toHaveLength(101)
  })

  it('does not try the failed older page again by itself when a save finishes (agreed 2026-11-08)', async () => {
    const { user, tab, activity, releaseSave } = await openWithHeldSave(60)
    server.use(
      http.get('/api/cards/:cardId/activity', ({ request }) =>
        new URL(request.url).searchParams.has('before')
          ? apiError(500, 'Something went wrong')
          : undefined,
      ),
    )
    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))
    await within(tab).findByRole('alert')
    server.resetHandlers(activity.handler)
    const before = activity.requests.length

    await act(async () => {
      releaseSave()
      await new Promise((r) => setTimeout(r, 300))
    })

    await waitFor(() =>
      expect(activity.requests.length).toBeGreaterThan(before),
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })
    const olderAsked = activity.requests
      .slice(before)
      .filter((u) => u.searchParams.has('before'))
    expect(olderAsked).toHaveLength(0)
    expect(lines(tab)).toHaveLength(50)
  })
})

describe('Description changes', () => {
  // 42
  it('shows the old and new description side by side on request', async () => {
    const { user, tab } = await openActivity([
      activityLine('DESCRIPTION_CHANGED', {
        from: 'The old text',
        to: 'The new text',
      }),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    const line = lines(tab)[0]!
    expect(line).toHaveTextContent('Ana changed the description')
    // The text is not there until it is asked for.
    expect(line).not.toHaveTextContent('The old text')
    expect(line).not.toHaveTextContent('The new text')

    await user.click(within(line).getByRole('button', { name: SHOW_CHANGES }))

    expect(within(line).getByRole('group', { name: BEFORE })).toHaveTextContent(
      'The old text',
    )
    expect(
      within(line).getByRole('group', { name: BEFORE }),
    ).not.toHaveTextContent('The new text')
    expect(within(line).getByRole('group', { name: AFTER })).toHaveTextContent(
      'The new text',
    )
    expect(
      within(line).getByRole('group', { name: AFTER }),
    ).not.toHaveTextContent('The old text')
    // Before comes first, then After.
    expect(
      within(line)
        .getByRole('group', { name: BEFORE })
        .compareDocumentPosition(
          within(line).getByRole('group', { name: AFTER }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  // 42
  it('shows “(empty)” for a description that was empty before or after', async () => {
    const { user, tab } = await openActivity([
      activityLine('DESCRIPTION_CHANGED', { from: 'Now gone', to: null }),
      activityLine('DESCRIPTION_CHANGED', { from: null, to: 'First text' }),
      activityLine('DESCRIPTION_CHANGED', { from: '', to: 'Other text' }),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(3))
    const [removed, added, fromBlank] = lines(tab)

    for (const line of [removed!, added!, fromBlank!]) {
      await user.click(within(line).getByRole('button', { name: SHOW_CHANGES }))
    }

    expect(
      within(removed!).getByRole('group', { name: BEFORE }),
    ).toHaveTextContent('Now gone')
    expect(
      within(removed!).getByRole('group', { name: AFTER }),
    ).toHaveTextContent(EMPTY_TEXT)
    expect(
      within(added!).getByRole('group', { name: BEFORE }),
    ).toHaveTextContent(EMPTY_TEXT)
    expect(
      within(added!).getByRole('group', { name: AFTER }),
    ).toHaveTextContent('First text')
    expect(
      within(fromBlank!).getByRole('group', { name: BEFORE }),
    ).toHaveTextContent(EMPTY_TEXT)
  })

  // 42: only that line opens
  it('opens the changes of the line it was pressed on only', async () => {
    const { user, tab } = await openActivity([
      activityLine('DESCRIPTION_CHANGED', { from: 'B1', to: 'B2' }),
      activityLine('DESCRIPTION_CHANGED', { from: 'A1', to: 'A2' }),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(2))

    await user.click(
      within(lines(tab)[1]!).getByRole('button', { name: SHOW_CHANGES }),
    )

    expect(lines(tab)[0]).not.toHaveTextContent('B1')
    expect(lines(tab)[1]).toHaveTextContent('A1')
    expect(lines(tab)[1]).toHaveTextContent('A2')
  })

  // 42: shows text as written, not as formatting
  it('shows the text as it was saved, not as a web page', async () => {
    const { user, tab } = await openActivity([
      activityLine('DESCRIPTION_CHANGED', {
        from: null,
        to: '<b>bold</b> **stars**',
      }),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(1))

    await user.click(
      within(lines(tab)[0]!).getByRole('button', { name: SHOW_CHANGES }),
    )

    expect(
      within(lines(tab)[0]!).getByRole('group', { name: AFTER }),
    ).toHaveTextContent('<b>bold</b> **stars**')
  })
})

describe('Reloading', () => {
  // 43
  it('asks again each time the tab is opened', async () => {
    const { user, panel, activity } = await openActivity([
      activityLine('MOVED', moved()),
    ])
    await waitFor(() => expect(activity.requests).toHaveLength(1))

    await user.click(within(panel).getByRole('tab', { name: DETAILS }))
    activity.lines.unshift(
      activityLine('COMPLETED', {}, { createdAt: ago(60_000) }),
    )
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))

    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await waitFor(() => expect(lines(tab)).toHaveLength(2))
    expect(lines(tab)[0]).toHaveTextContent('Ana completed this')
    expect(activity.requests.length).toBeGreaterThanOrEqual(2)
  })

  // 43
  it('shows a change made in Details when Activity is opened afterwards', async () => {
    const { user, panel, activity, api } = await openActivity([
      activityLine('MOVED', moved()),
    ])
    await user.click(within(panel).getByRole('tab', { name: DETAILS }))

    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await waitFor(() => expect(api.requests).toHaveLength(1))
    // The server wrote a line for the change.
    activity.lines.unshift(
      activityLine('PRIORITY_CHANGED', { from: 'NONE', to: 'HIGH' }),
    )
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))

    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await waitFor(() => expect(lines(tab)).toHaveLength(2))
    expect(lines(tab)[0]).toHaveTextContent(
      'Ana changed the priority from None to High',
    )
  })

  // 43: a save still on its way when Activity is opened
  it('reloads the history when a change finishes saving while Activity is shown', async () => {
    const { user, panel, activity } = await openActivity([
      activityLine('MOVED', moved()),
    ])
    await user.click(within(panel).getByRole('tab', { name: DETAILS }))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.patch(`/api/cards/${login.id}`, async () => {
        await gate
        return HttpResponse.json({ ...login, priority: 'HIGH' })
      }),
    )
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await waitFor(() => expect(lines(tab)).toHaveLength(1))

    activity.lines.unshift(
      activityLine('PRIORITY_CHANGED', { from: 'NONE', to: 'HIGH' }),
    )
    release()

    await waitFor(() => expect(lines(tab)).toHaveLength(2))
    expect(lines(tab)[0]).toHaveTextContent('changed the priority')
  })
})

describe('Accessibility', () => {
  // 44
  it('has no problems with lines, opened changes and the Show older button', async () => {
    const { user, tab, container } = await openActivity([
      ...Array.from({ length: 51 }, () =>
        activityLine('MOVED', moved(), { actor: null }),
      ),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(50))
    await expectNoAccessibilityProblems(container)
    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))
    await waitFor(() => expect(lines(tab)).toHaveLength(51))
    await expectNoAccessibilityProblems(container)
  })

  // 44
  it('has no problems with an opened description change', async () => {
    const { user, tab, container } = await openActivity([
      activityLine('DESCRIPTION_CHANGED', { from: null, to: 'New text' }),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    await user.click(
      within(lines(tab)[0]!).getByRole('button', { name: SHOW_CHANGES }),
    )
    await expectNoAccessibilityProblems(container)
  })

  // 44
  it('has no problems when empty or when loading failed', async () => {
    const empty = await openActivity([])
    await within(empty.tab).findByText(NO_ACTIVITY)
    await expectNoAccessibilityProblems(empty.container)
  })

  // 44
  it('has no problems when loading failed', async () => {
    server.use(
      http.get('/api/cards/:cardId/activity', () =>
        apiError(500, 'Something went wrong'),
      ),
    )
    const { user, container } = openCard()
    await user.click(
      within(await cardPanel()).getByRole('tab', { name: ACTIVITY }),
    )
    const tab = await screen.findByRole('tabpanel', { name: ACTIVITY })
    await within(tab).findByRole('alert')
    await expectNoAccessibilityProblems(container)
  })
})

// Decisions of 2026-11-08 (“7d answers, round 2”), kept from the
// antagonist's proofs where they showed a break.
describe('Unknown kinds (agreed 2026-11-08)', () => {
  it('still shows the panel and the known lines when a line is of a kind this page does not know', async () => {
    const known = activityLine('MOVED', moved())
    const unknown = {
      ...activityLine('COMPLETED', {}),
      kind: 'CARD_ARCHIVED',
    } as unknown as typeof known
    const { tab } = await openActivity([unknown, known])

    await waitFor(() => expect(lines(tab)).toHaveLength(2))
    expect(lines(tab)[0]).toHaveTextContent(
      'Ana made a change this page can’t show yet',
    )
    expect(lines(tab)[1]).toHaveTextContent(
      'Ana moved this from To do to In progress',
    )
    expect(
      screen.getByRole('button', { name: 'Close card' }),
    ).toBeInTheDocument()
  })
})

describe('A refusal of a change (agreed 2026-11-08)', () => {
  // The refusal is panel-wide (7b answers, 2026-11-07 07:41) and shows above
  // the tabs, so it is seen from either tab.
  async function refusedJustBeforeActivity() {
    const activity = fakeActivity([activityLine('MOVED', moved())])
    server.use(activity.handler)
    const { user } = openCard()
    const panel = await cardPanel()
    server.use(
      http.patch(`/api/cards/${login.id}`, async () => {
        await new Promise((r) => setTimeout(r, 50))
        return apiError(409, 'Someone else changed this card')
      }),
    )
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    return { user, panel }
  }

  it('is visible while Activity is shown, above the tabs', async () => {
    const { panel } = await refusedJustBeforeActivity()

    const refusal = await within(panel).findByText(
      'Someone else changed this card',
    )
    expect(refusal).toBeVisible()
    const tabs = within(panel).getByRole('tablist', { name: TABS })
    expect(
      refusal.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('is still visible on Details', async () => {
    const { user, panel } = await refusedJustBeforeActivity()
    await within(panel).findByText('Someone else changed this card')

    await user.click(within(panel).getByRole('tab', { name: DETAILS }))

    expect(
      within(panel).getByText('Someone else changed this card'),
    ).toBeVisible()
  })
})

describe('Show older while a change is saved (agreed 2026-11-08)', () => {
  it('keeps the older lines when a save finishes while they are loading', async () => {
    const all = Array.from({ length: 51 }, (_, i) =>
      activityLine('MOVED', moved(`Column ${i + 1}`)),
    )
    const requests: URL[] = []
    let releaseOlder!: () => void
    const olderGate = new Promise<void>((r) => (releaseOlder = r))
    server.use(
      http.get('/api/cards/:cardId/activity', async ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        if (url.searchParams.has('before')) {
          await olderGate
          return HttpResponse.json({ items: all.slice(50), nextBefore: null })
        }
        return HttpResponse.json({
          items: all.slice(0, 50),
          nextBefore: all[49]!.id,
        })
      }),
    )
    const { user } = openCard()
    const panel = await cardPanel()
    let releaseSave!: () => void
    const saveGate = new Promise<void>((r) => (releaseSave = r))
    server.use(
      http.patch(`/api/cards/${login.id}`, async () => {
        await saveGate
        return HttpResponse.json({ ...login, priority: 'HIGH' })
      }),
    )
    // A change is still saving when the person opens Activity.
    await user.selectOptions(within(panel).getByLabelText('Priority'), 'HIGH')
    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))
    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    await user.click(
      await within(tab).findByRole('button', { name: SHOW_OLDER }),
    )

    // The save finishes while the older page is on its way.
    releaseSave()
    await waitFor(() =>
      expect(
        requests.filter((u) => !u.searchParams.has('before')),
      ).toHaveLength(2),
    )
    releaseOlder()

    expect(await within(tab).findByText(/to Column 51/)).toBeInTheDocument()
    expect(lines(tab).length).toBeGreaterThanOrEqual(51)
  })
})

describe('Times keep up while Activity is open (agreed 2026-11-08)', () => {
  it('changes “just now” to “1 minute ago” after a minute', async () => {
    const { tab } = await openActivity([
      activityLine('MOVED', moved(), { createdAt: ago(10_000) }),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    expect(lines(tab)[0]).toHaveTextContent('just now')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(lines(tab)[0]).toHaveTextContent('1 minute ago')
    expect(lines(tab)[0]).not.toHaveTextContent('just now')
  })

  it('changes “3 hours ago” to “4 hours ago” after an hour', async () => {
    const { tab } = await openActivity([
      activityLine('MOVED', moved(), { createdAt: ago(3 * HOUR) }),
    ])
    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    expect(lines(tab)[0]).toHaveTextContent('3 hours ago')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR)
    })

    expect(lines(tab)[0]).toHaveTextContent('4 hours ago')
  })
})

describe('Approved wording (agreed 2026-11-08)', () => {
  it('says “just now” for a line under a minute old', async () => {
    const { tab } = await openActivity([
      activityLine('MOVED', moved(), { createdAt: ago(20_000) }),
    ])

    await waitFor(() => expect(lines(tab)).toHaveLength(1))
    expect(lines(tab)[0]).toHaveTextContent('just now')
  })

  it('says “Loading…” while the history loads', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.get('/api/cards/:cardId/activity', async () => {
        await gate
        return HttpResponse.json({ items: [], nextBefore: null })
      }),
    )
    const { user } = openCard()
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('tab', { name: ACTIVITY }))

    const tab = await within(panel).findByRole('tabpanel', { name: ACTIVITY })
    expect(within(tab).getByRole('status')).toHaveTextContent('Loading…')
    release()
    expect(await within(tab).findByText(NO_ACTIVITY)).toBeInTheDocument()
    expect(within(tab).queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a failed Show older above the lines, and the button stays to try again', async () => {
    const all = Array.from({ length: 60 }, (_, i) =>
      activityLine('MOVED', moved(`Column ${60 - i}`)),
    )
    const { user, tab } = await openActivity(all)
    await waitFor(() => expect(lines(tab)).toHaveLength(50))
    // The next request fails once; after that the fake history answers.
    server.use(
      http.get(
        '/api/cards/:cardId/activity',
        () => apiError(500, 'Something went wrong'),
        { once: true },
      ),
    )

    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))

    const alert = await within(tab).findByRole('alert')
    expect(alert).toHaveTextContent(LOAD_FAILED)
    const list = within(tab).getByRole('list', { name: ACTIVITY })
    expect(
      alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await user.click(within(tab).getByRole('button', { name: SHOW_OLDER }))
    await waitFor(() => expect(lines(tab)).toHaveLength(60))
    expect(within(tab).queryByRole('alert')).not.toBeInTheDocument()
  })
})
