import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardFile, Me } from '@tessera/shared'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { cardPanel, login, openCard } from '../test/card-panel'
import { activityLine, fakeActivity } from '../test/fake-activity'
import { backlogCard, ben } from '../test/fake-board'
import {
  cardFile,
  fakeFiles,
  type FakeFilesOptions,
  installFakeUploads,
  pickedFile,
  uploadOf,
  uploads,
} from '../test/fake-files'
import { live } from '../test/fake-live'
import { recordRequests } from '../test/requests'
import { server } from '../test/server'

// Files on cards, PR A (plan "file storage and files on cards"): the Files
// section of the card panel, its dialogs, uploading, removing, and the
// Delete card dialog's choice for a card that has files (acceptance criteria
// 31 and 33 to 46). What a person sees, by role and visible text.
//
// Names the tests assume where the plan does not give them: the section is a
// region named "Files" (a <section> labelled by its heading, like the
// Description and Subtasks), its files are a list named "Files", the file
// chooser is an <input type="file" multiple>, and an upload in progress is a
// list item with the file's name, a progressbar and a "Cancel" button.

const NOW = '2026-11-07T10:00:00.000Z'
const HOUR = 3_600_000
const MB = 1024 * 1024

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
  installFakeUploads()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString()
}

// Opens the card with these files (newest first, as the API lists them).
function openFiles(
  files: CardFile[],
  options: FakeFilesOptions & {
    me?: Me
    elsewhere?: ReturnType<typeof backlogCard>[]
  } = {},
) {
  const api = fakeFiles(login.id, files, options)
  const app = openCard(login, { me: options.me, elsewhere: options.elsewhere })
  return { ...app, files: api }
}

async function filesSection() {
  return within(await cardPanel()).findByRole('region', { name: 'Files' })
}

// The row of the file called `name` (a list item holding its name).
function rowOf(section: HTMLElement, name: string) {
  const row = within(section)
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(name))
  if (!row) throw new Error(`No row for ${name}`)
  return row
}

function chooser(panel: HTMLElement) {
  return panel.querySelector<HTMLInputElement>('input[type="file"]')!
}

function dropOn(target: HTMLElement, files: File[]) {
  fireEvent.drop(target, {
    dataTransfer: {
      files,
      types: ['Files'],
      items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
    },
  })
}

const dragging = {
  dataTransfer: { files: [], types: ['Files'], items: [{ kind: 'file' }] },
}

describe('The Files section (criterion 34)', () => {
  // 34
  it('has a "Files" heading on the Details tab, under the description and before Subtasks', async () => {
    openFiles([])
    const panel = await cardPanel()
    await within(panel).findByRole('heading', { name: 'Files' })

    const headings = within(panel)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)

    expect(headings).toContain('Description')
    expect(headings).toContain('Subtasks')
    expect(headings.indexOf('Files')).toBeGreaterThan(
      headings.indexOf('Description'),
    )
    expect(headings.indexOf('Files')).toBeLessThan(headings.indexOf('Subtasks'))
  })

  // 34
  it('says "No files yet" when the card has none', async () => {
    openFiles([])

    expect(await filesSection()).toHaveTextContent('No files yet')
  })

  // 34
  it('says "Loading…" while the files load', async () => {
    let answer: () => void = () => {}
    const gate = new Promise<void>((resolve) => (answer = resolve))
    server.use(
      http.get(`/api/cards/${login.id}/files`, async () => {
        await gate
        return HttpResponse.json({ files: [] })
      }),
    )
    openCard(login)

    const section = await filesSection()
    expect(within(section).getByText('Loading…')).toBeInTheDocument()
    answer()
    expect(await within(section).findByText('No files yet')).toBeInTheDocument()
  })

  // 34
  it('says "Couldn’t load the files" with "Try again" when loading fails, and tries again', async () => {
    const { user, files } = openFiles([cardFile('plan.pdf')], {
      listFails: true,
    })
    const section = await filesSection()

    expect(
      await within(section).findByText('Couldn’t load the files'),
    ).toBeInTheDocument()
    files.state.failList = false
    await user.click(within(section).getByRole('button', { name: 'Try again' }))

    expect(await within(section).findByText('plan.pdf')).toBeInTheDocument()
    expect(within(section).queryByText('Couldn’t load the files')).toBe(null)
  })
})

describe('What each file shows (criteria 35 to 37)', () => {
  // 35
  it('shows the name, size, who added it and when, newest first', async () => {
    const newer = cardFile('newer.pdf', {
      size: 340 * 1024,
      uploader: { id: ben.id, displayName: 'Sam' },
      createdAt: ago(3 * HOUR),
    })
    const older = cardFile('older.pdf', {
      size: 12,
      createdAt: ago(30 * HOUR),
    })
    openFiles([newer, older])
    const section = await filesSection()
    await within(section).findByText('newer.pdf')

    const rows = within(section).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('newer.pdf'),
      expect.stringContaining('older.pdf'),
    ])
    expect(rows[0]).toHaveTextContent('340 KB')
    expect(rows[0]).toHaveTextContent('Added by Sam')
    expect(rows[0]).toHaveTextContent('3 hours ago')
    expect(rows[1]).toHaveTextContent('12 bytes')
    expect(rows[1]).toHaveTextContent('Added by Ana')
    expect(rows[1]).toHaveTextContent('1 day ago')
  })

  // 35
  it('writes sizes of 2.4 MB', async () => {
    openFiles([cardFile('big.zip', { size: Math.round(2.4 * MB) })])
    const section = await filesSection()

    expect(await within(section).findByText(/2\.4 MB/)).toBeInTheDocument()
  })

  // 35
  it('gives the exact time on hover and for screen readers', async () => {
    const created = ago(3 * HOUR)
    openFiles([cardFile('plan.pdf', { createdAt: created })])
    const section = await filesSection()

    const time = (await within(section).findByText('3 hours ago')).closest(
      'time',
    )!
    expect(time).toHaveAttribute('datetime', created)
    expect(time.getAttribute('title')).toMatch(/2026/)
  })

  // 35
  it('says "Added by Former member" for a deleted account', async () => {
    openFiles([cardFile('plan.pdf', { uploader: null })])
    const section = await filesSection()

    expect(
      await within(section).findByText(/Added by Former member/),
    ).toBeInTheDocument()
  })

  // 36
  it('shows a small preview of an image, with the file name as its text alternative', async () => {
    const photo = cardFile('photo.png', { isImage: true, size: 5000 })
    openFiles([photo])
    const section = await filesSection()

    const image = await within(section).findByRole('img', {
      name: 'photo.png',
    })

    expect(image).toHaveAttribute('src', `/api/files/${photo.id}/preview`)
    // Loaded only when it is on screen.
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  // 36
  it('opens the full-size image in a dialog on a click, with the name, Download and Close', async () => {
    const photo = cardFile('photo.png', { isImage: true })
    const { user } = openFiles([photo])
    const section = await filesSection()

    await user.click(
      await within(section).findByRole('button', { name: 'photo.png' }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    expect(
      within(dialog).getByRole('img', { name: 'photo.png' }),
    ).toHaveAttribute('src', `/api/files/${photo.id}/preview`)
    const download = within(dialog).getByRole('link', { name: /^Download/ })
    expect(download).toHaveAttribute('href', `/api/files/${photo.id}/download`)
    expect(
      within(dialog).getByRole('button', { name: 'Close' }),
    ).toBeInTheDocument()
  })

  // 36
  it('opens the full-size image on Enter, and Escape closes it and returns focus to the preview', async () => {
    const photo = cardFile('photo.png', { isImage: true })
    const { user } = openFiles([photo])
    const section = await filesSection()
    const preview = await within(section).findByRole('button', {
      name: 'photo.png',
    })

    preview.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'photo.png' })
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'photo.png' })).toBe(null),
    )
    expect(preview).toHaveFocus()
  })

  // 36
  it('closes the image dialog with its Close button', async () => {
    const photo = cardFile('photo.png', { isImage: true })
    const { user } = openFiles([photo])
    const section = await filesSection()
    await user.click(
      await within(section).findByRole('button', { name: 'photo.png' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'photo.png' })).toBe(null),
    )
  })

  // 37
  it('gives every file, images included, a Download link to /download', async () => {
    const photo = cardFile('photo.png', { isImage: true })
    const pdf = cardFile('plan.pdf')
    openFiles([photo, pdf])
    const section = await filesSection()
    await within(section).findByText('plan.pdf')

    for (const file of [photo, pdf]) {
      const link = within(rowOf(section, file.name)).getByRole('link', {
        name: /^Download/,
      })
      expect(link).toHaveAttribute('href', `/api/files/${file.id}/download`)
    }
  })

  // 37
  it('shows an SVG and any other file that is not an image with no preview, only name, size and Download', async () => {
    openFiles([
      cardFile('logo.svg', { isImage: false, size: 2048 }),
      cardFile('plan.pdf'),
    ])
    const section = await filesSection()
    await within(section).findByText('logo.svg')

    expect(within(section).queryByRole('img')).toBe(null)
    expect(section.querySelector('img')).toBe(null)
    const row = rowOf(section, 'logo.svg')
    expect(row).toHaveTextContent('2 KB')
    expect(
      within(row).getByRole('link', { name: /^Download/ }),
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'logo.svg' })).toBe(null)
  })

  // 42
  it('lists only the card’s own files, with no "from chat" label in this release', async () => {
    openFiles([cardFile('plan.pdf')])
    const section = await filesSection()
    await within(section).findByText('plan.pdf')

    expect(section).not.toHaveTextContent(/from chat/i)
  })
})

describe('Attaching files (criteria 38 to 40, 43)', () => {
  // 38
  it('has an "Attach file" button that opens the computer’s file chooser, for several files', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { user } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()

    await user.click(
      within(section).getByRole('button', { name: 'Attach file' }),
    )

    expect(chooser(panel)).toHaveAttribute('multiple')
    expect(
      click.mock.instances.some(
        (el) => (el as HTMLInputElement).type === 'file',
      ),
    ).toBe(true)
  })

  // 38
  it('sends each file picked in the chooser as its own upload to the card', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    await filesSection()

    await user.upload(chooser(panel), [
      pickedFile('a.pdf'),
      pickedFile('b.png', 5, 'image/png'),
    ])

    await waitFor(() => expect(uploads()).toHaveLength(2))
    expect(uploads().map((x) => [x.method, x.url])).toEqual([
      ['POST', `/api/cards/${login.id}/files`],
      ['POST', `/api/cards/${login.id}/files`],
    ])
    expect(
      uploads()
        .map((x) => x.fileName)
        .sort(),
    ).toEqual(['a.pdf', 'b.png'])
  })

  // 38
  it('attaches files dropped anywhere on the card panel, each as its own upload', async () => {
    openFiles([])
    const panel = await cardPanel()
    await filesSection()

    dropOn(panel, [pickedFile('one.pdf'), pickedFile('two.pdf')])

    await waitFor(() => expect(uploads()).toHaveLength(2))
    expect(
      uploads()
        .map((x) => x.fileName)
        .sort(),
    ).toEqual(['one.pdf', 'two.pdf'])
  })

  // 38
  it('shows "Drop files to attach" while files are dragged over the panel, and not after they leave or drop', async () => {
    openFiles([])
    const panel = await cardPanel()
    await filesSection()
    expect(within(panel).queryByText('Drop files to attach')).toBe(null)

    fireEvent.dragEnter(panel, dragging)
    fireEvent.dragOver(panel, dragging)
    expect(
      await within(panel).findByText('Drop files to attach'),
    ).toBeInTheDocument()
    fireEvent.dragLeave(panel, dragging)
    await waitFor(() =>
      expect(within(panel).queryByText('Drop files to attach')).toBe(null),
    )

    fireEvent.dragEnter(panel, dragging)
    await within(panel).findByText('Drop files to attach')
    dropOn(panel, [pickedFile('one.pdf')])
    await waitFor(() =>
      expect(within(panel).queryByText('Drop files to attach')).toBe(null),
    )
  })

  // 38
  it('does not show the drop outline for something dragged that is not a file', async () => {
    openFiles([])
    const panel = await cardPanel()
    await filesSection()

    fireEvent.dragEnter(panel, {
      dataTransfer: { files: [], types: ['text/plain'], items: [] },
    })

    expect(within(panel).queryByText('Drop files to attach')).toBe(null)
  })

  // 39
  it('refuses a file bigger than the limit before sending it, and still uploads the others', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()
    // Once the server's limit is known.
    await within(section).findByText('No files yet')

    await user.upload(chooser(panel), [
      pickedFile('plan.mov', 101 * MB, 'video/quicktime'),
      pickedFile('small.pdf'),
    ])

    expect(
      await within(section).findByText('plan.mov is bigger than 100 MB'),
    ).toBeInTheDocument()
    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.fileName).toBe('small.pdf')
  })

  // 39
  it('accepts a file exactly at the limit, and names the limit from the server’s setting', async () => {
    const { user } = openFiles([], { limit: 25 * MB })
    const panel = await cardPanel()
    const section = await filesSection()
    await within(section).findByText('No files yet')

    await user.upload(chooser(panel), [
      pickedFile('exact.bin', 25 * MB),
      pickedFile('over.bin', 25 * MB + 1),
    ])

    expect(
      await within(section).findByText('over.bin is bigger than 25 MB'),
    ).toBeInTheDocument()
    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.fileName).toBe('exact.bin')
  })

  // 40
  it('shows an upload as a row with its name, a progress bar with the percentage, and Cancel', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()

    await user.upload(chooser(panel), [pickedFile('plan.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(1))
    uploads()[0]!.progress(0.4)

    const row = await waitFor(() => rowOf(section, 'plan.pdf'))
    await waitFor(() =>
      expect(within(row).getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '40',
      ),
    )
    expect(row).toHaveTextContent('40%')
    expect(
      within(row).getByRole('button', { name: 'Cancel' }),
    ).toBeInTheDocument()
  })

  // 40
  it('stops an upload with Cancel', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()
    await user.upload(chooser(panel), [pickedFile('plan.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(1))

    await user.click(
      within(await waitFor(() => rowOf(section, 'plan.pdf'))).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    )

    expect(uploads()[0]!.aborted).toBe(true)
  })

  // 40
  it('shows the new file in the list when the upload has finished', async () => {
    const { user, files } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()
    await user.upload(chooser(panel), [pickedFile('plan.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(1))

    files.stored(cardFile('plan.pdf', { createdAt: ago(1000) }), uploads()[0]!)

    expect(
      await within(section).findByRole('link', { name: /^Download/ }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(within(section).queryByRole('progressbar')).toBe(null),
    )
    expect(within(section).queryByText('No files yet')).toBe(null)
  })

  // 40
  it('keeps a failed upload with the server’s own words for a 4xx answer, and "Try again" and "Dismiss"', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()
    await user.upload(chooser(panel), [pickedFile('plan.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(1))

    uploads()[0]!.respond(413, {
      statusCode: 413,
      message: 'Files can be at most 100 MB',
    })

    const row = await waitFor(() => rowOf(section, 'plan.pdf'))
    expect(
      await within(row).findByText('Files can be at most 100 MB'),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'Dismiss' }),
    ).toBeInTheDocument()
  })

  // 40
  it('says "Couldn’t upload, try again" when the network fails or the server breaks', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()
    await user.upload(chooser(panel), [
      pickedFile('a.pdf'),
      pickedFile('b.pdf'),
    ])
    await waitFor(() => expect(uploads()).toHaveLength(2))

    uploadOf('a.pdf').networkError()
    uploadOf('b.pdf').respond(500, {
      statusCode: 500,
      message: 'Internal server error',
    })

    for (const name of ['a.pdf', 'b.pdf']) {
      const row = await waitFor(() => rowOf(section, name))
      expect(
        await within(row).findByText('Couldn’t upload, try again'),
      ).toBeInTheDocument()
    }
    expect(within(section).queryByText('Internal server error')).toBe(null)
  })

  // 40
  it('sends the same file again with "Try again", and drops the row with "Dismiss"', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    const section = await filesSection()
    await user.upload(chooser(panel), [
      pickedFile('a.pdf'),
      pickedFile('b.pdf'),
    ])
    await waitFor(() => expect(uploads()).toHaveLength(2))
    uploadOf('a.pdf').networkError()
    uploadOf('b.pdf').networkError()

    await user.click(
      within(await waitFor(() => rowOf(section, 'a.pdf'))).getByRole('button', {
        name: 'Try again',
      }),
    )
    await user.click(
      within(await waitFor(() => rowOf(section, 'b.pdf'))).getByRole('button', {
        name: 'Dismiss',
      }),
    )

    await waitFor(() => expect(uploads()).toHaveLength(3))
    expect(uploads()[2]!.fileName).toBe('a.pdf')
    expect(uploads()[2]!.url).toBe(`/api/cards/${login.id}/files`)
    await waitFor(() => expect(within(section).queryByText('b.pdf')).toBe(null))
  })

  // 43
  it('sends the X-Live-Connection header with an upload, so this tab ignores its own signal', async () => {
    const { user } = openFiles([])
    const panel = await cardPanel()
    await filesSection()
    await waitFor(() => expect(live.id).not.toBeNull())

    await user.upload(chooser(panel), [pickedFile('plan.pdf')])

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.headers['x-live-connection']).toBe(live.id)
  })
})

describe('Removing a file (criterion 41)', () => {
  const mine = () =>
    cardFile('mine.pdf', { uploader: { id: ben.id, displayName: 'Ben' } })
  const hers = () => cardFile('hers.pdf')

  // 41
  it('shows Remove to the uploader and not on other people’s files, for a member who is not an admin', async () => {
    openFiles([mine(), hers()], { me: ben })
    const section = await filesSection()
    await within(section).findByText('hers.pdf')

    expect(
      within(rowOf(section, 'mine.pdf')).getByRole('button', {
        name: /^Remove/,
      }),
    ).toBeInTheDocument()
    expect(
      within(rowOf(section, 'hers.pdf')).queryByRole('button', {
        name: /^Remove/,
      }),
    ).toBe(null)
  })

  // 41
  it('shows Remove on every file to a project admin, even for a deleted account', async () => {
    openFiles([mine(), hers(), cardFile('gone.pdf', { uploader: null })])
    const section = await filesSection()
    await within(section).findByText('gone.pdf')

    // Once the members have loaded (the admin check needs them).
    for (const name of ['mine.pdf', 'hers.pdf', 'gone.pdf']) {
      await waitFor(() =>
        expect(
          within(rowOf(section, name)).getByRole('button', { name: /^Remove/ }),
        ).toBeInTheDocument(),
      )
    }
  })

  // 41
  it('asks "Remove ‘plan.pdf’?" with its warning, and Remove and Cancel', async () => {
    const plan = cardFile('plan.pdf')
    const { user } = openFiles([plan])
    const section = await filesSection()
    await user.click(
      await within(await waitFor(() => rowOf(section, 'plan.pdf'))).findByRole(
        'button',
        { name: /^Remove/ },
      ),
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })

    expect(dialog).toHaveTextContent(
      'This deletes the file for everyone. It can’t be undone.',
    )
    expect(
      within(dialog).getByRole('button', { name: 'Remove' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeInTheDocument()
  })

  // 41
  it('returns focus to the Remove button on Cancel', async () => {
    const { user, files } = openFiles([cardFile('plan.pdf')])
    const section = await filesSection()
    const remove = await within(
      await waitFor(() => rowOf(section, 'plan.pdf')),
    ).findByRole('button', {
      name: /^Remove/,
    })
    await user.click(remove)
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Remove ‘plan.pdf’?' })).toBe(
        null,
      ),
    )
    expect(remove).toHaveFocus()
    expect(files.requests.filter((r) => r.startsWith('DELETE'))).toEqual([])
  })

  // 41
  it('removes the file, then puts focus on the "Files" heading', async () => {
    const plan = cardFile('plan.pdf')
    const { user, files } = openFiles([plan, cardFile('other.pdf')])
    const section = await filesSection()
    const row = await waitFor(() => rowOf(section, 'plan.pdf'))
    await user.click(
      await within(row).findByRole('button', { name: /^Remove/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(within(section).queryByText('plan.pdf')).toBe(null),
    )
    expect(files.requests).toContain(`DELETE /api/files/${plan.id}`)
    expect(within(section).getByText('other.pdf')).toBeInTheDocument()
    expect(
      within(section).getByRole('heading', { name: 'Files' }),
    ).toHaveFocus()
  })

  // 41
  it('shows the error on that file and keeps it when removing fails', async () => {
    const { user } = openFiles([cardFile('plan.pdf'), cardFile('other.pdf')], {
      removeFails: {
        status: 403,
        message:
          'Only the person who added a file or a project admin can remove it',
      },
    })
    const section = await filesSection()
    const row = await waitFor(() => rowOf(section, 'plan.pdf'))
    await user.click(
      await within(row).findByRole('button', { name: /^Remove/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(rowOf(section, 'plan.pdf')).toHaveTextContent(
        'Only the person who added a file or a project admin can remove it',
      ),
    )
    expect(rowOf(section, 'other.pdf')).not.toHaveTextContent('Only the person')
  })

  // 43
  it('sends the X-Live-Connection header when removing', async () => {
    const requests = recordRequests()
    const plan = cardFile('plan.pdf')
    const { user } = openFiles([plan])
    const section = await filesSection()
    await waitFor(() => expect(live.id).not.toBeNull())
    await user.click(
      await within(await waitFor(() => rowOf(section, 'plan.pdf'))).findByRole(
        'button',
        { name: /^Remove/ },
      ),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(requests.saves().some((r) => r.method === 'DELETE')).toBe(true),
    )
    const removal = requests.saves().find((r) => r.method === 'DELETE')!
    expect(removal.path).toBe(`/api/files/${plan.id}`)
    expect(removal.headers.get('x-live-connection')).toBe(live.id)
  })
})

describe('Live (criteria 44 and 45)', () => {
  // 44
  it('shows a file someone else attached, and drops one they removed, after a card signal', async () => {
    const first = cardFile('first.pdf')
    const { files } = openFiles([first])
    const section = await filesSection()
    await within(section).findByText('first.pdf')

    const second = cardFile('second.pdf', {
      uploader: { id: ben.id, displayName: 'Ben' },
    })
    files.serverNowHas([second, first])
    await live.cardChanged(login.id)

    expect(await within(section).findByText('second.pdf')).toBeInTheDocument()
    expect(within(section).getByText(/Added by Ben/)).toBeInTheDocument()

    files.serverNowHas([second])
    await live.cardChanged(login.id)

    await waitFor(() =>
      expect(within(section).queryByText('first.pdf')).toBe(null),
    )
  })

  // 44
  it('does not ask for the files again for another card’s signal', async () => {
    const { files } = openFiles([cardFile('first.pdf')])
    const section = await filesSection()
    await within(section).findByText('first.pdf')
    const before = files.requests.filter((r) => r.startsWith('GET')).length

    await live.cardChanged('99999999-9999-4999-8999-999999999999')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(files.requests.filter((r) => r.startsWith('GET')).length).toBe(
      before,
    )
  })

  // 45
  it('reloads the files after the connection comes back', async () => {
    const first = cardFile('first.pdf')
    const { files } = openFiles([first])
    const section = await filesSection()
    await within(section).findByText('first.pdf')
    await waitFor(() => expect(live.rooms.length).toBe(1))
    const requests = recordRequests()
    await live.disconnect()
    files.serverNowHas([cardFile('missed.pdf'), first])

    await live.reconnect()

    await waitFor(() =>
      expect(requests.reads(`/api/cards/${login.id}/files`)).toBeGreaterThan(0),
    )
    expect(await within(section).findByText('missed.pdf')).toBeInTheDocument()
  })
})

describe('Activity lines for files (criterion 33)', () => {
  // 33
  it('shows who attached and removed a file in the Activity tab, newest first', async () => {
    const lines = fakeActivity([
      activityLine(
        'FILE_REMOVED',
        { fileId: 'f1', name: 'plan.pdf', size: 12 },
        { actor: null, createdAt: '2026-11-07T09:00:00.000Z' },
      ),
      activityLine(
        'FILE_ADDED',
        { fileId: 'f1', name: 'plan.pdf', size: 12 },
        { createdAt: '2026-11-07T08:00:00.000Z' },
      ),
    ])
    server.use(lines.handler)
    const { user } = openFiles([])
    const panel = await cardPanel()

    await user.click(within(panel).getByRole('tab', { name: 'Activity' }))

    const list = await within(panel).findByRole('list', { name: 'Activity' })
    const items = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    const plain = (text: string) => text.replace(/[‘’]/g, "'")
    expect(plain(items[0]!)).toContain(
      "Former member removed the file 'plan.pdf'",
    )
    expect(plain(items[1]!)).toContain("Ana attached the file 'plan.pdf'")
  })
})

describe('Accessibility (criterion 46)', () => {
  // 46
  it('passes the axe checks with files, an upload and a failed upload on show', async () => {
    const { user, container } = openFiles([
      cardFile('photo.png', { isImage: true }),
      cardFile('plan.pdf'),
    ])
    const panel = await cardPanel()
    const section = await filesSection()
    await within(section).findByText('plan.pdf')
    await user.upload(chooser(panel), [
      pickedFile('a.pdf'),
      pickedFile('b.pdf'),
    ])
    await waitFor(() => expect(uploads()).toHaveLength(2))
    uploadOf('a.pdf').progress(0.5)
    uploadOf('b.pdf').networkError()
    await within(await waitFor(() => rowOf(section, 'b.pdf'))).findByText(
      'Couldn’t upload, try again',
    )

    await expectNoAccessibilityProblems(container)
  })

  // 46
  it('passes the axe checks with the drop outline showing', async () => {
    const { container } = openFiles([cardFile('plan.pdf')])
    const panel = await cardPanel()
    await filesSection()

    fireEvent.dragEnter(panel, dragging)
    await within(panel).findByText('Drop files to attach')

    await expectNoAccessibilityProblems(container)
  })

  // 46
  it('passes the axe checks with the image dialog open', async () => {
    const { user } = openFiles([cardFile('photo.png', { isImage: true })])
    const section = await filesSection()
    await user.click(
      await within(section).findByRole('button', { name: 'photo.png' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })

    await expectNoAccessibilityProblems(dialog)
  })

  // 46
  it('passes the axe checks with the remove dialog open', async () => {
    const { user } = openFiles([cardFile('plan.pdf')])
    const section = await filesSection()
    await user.click(
      await within(await waitFor(() => rowOf(section, 'plan.pdf'))).findByRole(
        'button',
        { name: /^Remove/ },
      ),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })

    await expectNoAccessibilityProblems(dialog)
  })

  // 46
  it('works by keyboard: the file chooser opens from the Attach file button with Enter', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { user } = openFiles([])
    const section = await filesSection()

    within(section).getByRole('button', { name: 'Attach file' }).focus()
    await user.keyboard('{Enter}')

    expect(
      click.mock.instances.some(
        (el) => (el as HTMLInputElement).type === 'file',
      ),
    ).toBe(true)
  })
})

describe('Deleting a card that has files (criterion 31)', () => {
  const threeFiles = () => [
    cardFile('a.pdf'),
    cardFile('b.pdf'),
    cardFile('c.pdf'),
  ]
  const iconSet = backlogCard('14', 'Icon set')

  async function openDeleteDialog(files: CardFile[] = threeFiles()) {
    const app = openFiles(files, { elsewhere: [iconSet] })
    const urls: string[] = []
    server.use(
      http.delete(`/api/cards/${login.id}`, ({ request }) => {
        urls.push(request.url)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const panel = await cardPanel()
    await within(await filesSection())
      .findByText('a.pdf')
      .catch(() => {})
    await app.user.click(
      within(panel).getByRole('button', { name: 'Delete card' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete WEB-12?' })
    return { ...app, urls, dialog }
  }

  // 31
  it('says how many files the card has and offers "Delete the files too" or "Move them to another card"', async () => {
    const { dialog } = await openDeleteDialog()

    expect(await within(dialog).findByText(/3 files/)).toBeInTheDocument()
    expect(
      within(dialog).getByRole('radio', { name: 'Delete the files too' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('radio', { name: 'Move them to another card' }),
    ).toBeInTheDocument()
  })

  // 31
  it('says nothing about files, and offers no choice, for a card with none', async () => {
    const { dialog } = await openDeleteDialog([])
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(dialog).not.toHaveTextContent(/files/i)
    expect(
      within(dialog).queryByRole('radio', { name: 'Delete the files too' }),
    ).toBe(null)
  })

  // 31
  it('deletes the card and its files when "Delete the files too" is chosen: no moveFilesTo', async () => {
    const { user, dialog, urls } = await openDeleteDialog()
    await within(dialog).findByText(/3 files/)

    await user.click(
      within(dialog).getByRole('radio', { name: 'Delete the files too' }),
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    )

    await waitFor(() => expect(urls).toHaveLength(1))
    expect(new URL(urls[0]!).pathname).toBe(`/api/cards/${login.id}`)
    expect(new URL(urls[0]!).searchParams.has('moveFilesTo')).toBe(false)
  })

  // 31
  it('moves the files to the card picked from a search, sending moveFilesTo', async () => {
    const { user, dialog, urls } = await openDeleteDialog()
    await within(dialog).findByText(/3 files/)

    await user.click(
      within(dialog).getByRole('radio', { name: 'Move them to another card' }),
    )
    const box = await screen.findByLabelText('Find a card')
    box.focus()
    await user.type(box, 'icon', { skipClick: true })
    await user.click(
      await screen.findByRole('button', { name: /WEB-14 Icon set/ }),
    )
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Delete card' }),
      ).toBeEnabled(),
    )
    expect(dialog).toHaveTextContent('WEB-14')
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    )

    await waitFor(() => expect(urls).toHaveLength(1))
    const url = new URL(urls[0]!)
    expect(url.pathname).toBe(`/api/cards/${login.id}`)
    expect(url.searchParams.get('moveFilesTo')).toBe(iconSet.id)
  })

  // 31
  it('turns Delete card off until a card is picked for the files to move to', async () => {
    const { user, dialog } = await openDeleteDialog()
    await within(dialog).findByText(/3 files/)

    await user.click(
      within(dialog).getByRole('radio', { name: 'Move them to another card' }),
    )
    await screen.findByLabelText('Find a card')

    expect(
      within(dialog).getByRole('button', { name: 'Delete card' }),
    ).toBeDisabled()
  })

  // 31
  it('does not offer the card being deleted as the place to move the files', async () => {
    const { user, dialog, api } = await openDeleteDialog()
    await within(dialog).findByText(/3 files/)

    await user.click(
      within(dialog).getByRole('radio', { name: 'Move them to another card' }),
    )
    const box = await screen.findByLabelText('Find a card')
    box.focus()
    await user.type(box, 'login', { skipClick: true })
    await waitFor(() => expect(api.searches).toContain('login'))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(screen.queryByRole('button', { name: /WEB-12 Login page/ })).toBe(
      null,
    )
  })

  // 31 / 46
  it('passes the axe checks with the choice and the card search open', async () => {
    const { user, dialog, container } = await openDeleteDialog()
    await within(dialog).findByText(/3 files/)

    await user.click(
      within(dialog).getByRole('radio', { name: 'Move them to another card' }),
    )
    await screen.findByLabelText('Find a card')

    await expectNoAccessibilityProblems(container)
  })
})
