import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAccessibilityProblems } from '../test/a11y'
import { ben } from '../test/fake-board'
import {
  chatPanel,
  boardPath,
  general,
  login,
  messageList,
  messageWith,
  openChat,
  openMenu,
  typeInto,
} from '../test/chat-panel'
import {
  fakeFiles,
  installFakeUploads,
  messageFile,
  pendingFile,
  pickedFile,
  uploadOf,
  uploads,
} from '../test/fake-files'
import { live } from '../test/fake-live'
import { message } from '../test/fake-messages'
import { recordRequests } from '../test/requests'
import { apiError, server } from '../test/server'

// Files on messages, PR B (plan "files on messages, and screenshots in the
// message box"): the message box and the message list, in the web app
// (acceptance criteria 21, 26 to 37). What a person sees, by role and visible
// text.
//
// Names the tests assume where the plan gives only the words: the chooser is
// an <input type="file" multiple> inside the chat panel; each file in the box
// is a list item (a "chip") outside the message list, holding the file's
// name, its size and, while it uploads, "Uploading… 45%"; the chip's buttons
// are "Remove ‘name’", "Try again" and "Dismiss"; the waiting note is the
// text "Sends when the files finish uploading" with a "Cancel" button; the
// drop outline is the text "Drop files to attach". A file in a message is
// shown inside that message: an image as an <img> named after the file (its
// source is /api/files/:id/preview), another file as a row with its name,
// its size and a "Download" link (/api/files/:id/download), and a "Remove"
// button whose name starts with "Remove".

const UUID = /^[0-9a-f-]{36}$/
const MB = 1024 * 1024
const WAITING = 'Sends when the files finish uploading'
const NEEDS_TEXT_OR_FILE =
  'A message needs text or at least one file. Delete the message instead.'

beforeEach(() => {
  installFakeUploads()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// The board opened on the general chat, with the message box ready.
async function openBox(options: Parameters<typeof openChat>[0] = {}) {
  const app = openChat(options)
  const box = await within(
    await screen.findByRole('complementary', { name: /^Chat: / }),
  ).findByRole('textbox', { name: 'Message' })
  return { ...app, box }
}

function chooser() {
  const input =
    chatPanel().querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('The message box has no file chooser yet')
  return input
}

// The chip of the file called `name`: a list item of the message box, not of
// the message list.
function chipOf(name: string): HTMLElement {
  const log = within(chatPanel()).queryByRole('log', { name: 'Messages' })
  const found = within(chatPanel())
    .queryAllByRole('listitem')
    .find((item) => !log?.contains(item) && item.textContent?.includes(name))
  if (!found) throw new Error(`No chip for ${name}`)
  return found
}

function noChip(name: string) {
  expect(() => chipOf(name)).toThrow()
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

function pasteInto(box: HTMLElement, files: File[], text = '') {
  fireEvent.paste(box, {
    clipboardData: {
      files,
      types: [
        ...(files.length ? ['Files'] : []),
        ...(text ? ['text/plain'] : []),
      ],
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  })
}

// Picks files in the chooser and waits until each has started uploading.
async function pick(
  user: Awaited<ReturnType<typeof openBox>>['user'],
  ...files: File[]
) {
  const before = uploads().length
  await user.upload(chooser(), files)
  await waitFor(() => expect(uploads()).toHaveLength(before + files.length))
}

// The server stored what `xhr` sent: answers 201 and remembers the file.
function stored(
  api: Awaited<ReturnType<typeof openBox>>['api'],
  name: string,
  fields: Parameters<typeof pendingFile>[2] = {},
) {
  const file = pendingFile(name, general.id, fields)
  api.hasPending(file)
  act(() => uploadOf(name).respond(201, file))
  return file
}

function sendButton() {
  return within(chatPanel()).getByRole('button', { name: 'Send' })
}

describe('Attaching files to the message box (criterion 26)', () => {
  // 26
  it('has an "Attach file" button that opens the computer’s file chooser, for several files', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { user } = await openBox()

    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Attach file' }),
    )

    expect(chooser()).toHaveAttribute('multiple')
    expect(
      click.mock.instances.some(
        (el) => (el as HTMLInputElement).type === 'file',
      ),
    ).toBe(true)
  })

  // 26, 37
  it('opens the chooser from the keyboard, as the alternative to dropping and pasting', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { user } = await openBox()
    const button = within(chatPanel()).getByRole('button', {
      name: 'Attach file',
    })

    button.focus()
    await user.keyboard('{Enter}')

    expect(
      click.mock.instances.some(
        (el) => (el as HTMLInputElement).type === 'file',
      ),
    ).toBe(true)
  })

  // 26
  it('starts an upload to the chat for each picked file, as soon as it is picked', async () => {
    const { user } = await openBox()

    await pick(user, pickedFile('a.pdf'), pickedFile('b.png', 5, 'image/png'))

    expect(uploads().map((x) => [x.method, x.url])).toEqual([
      ['POST', `/api/chats/${general.id}/files`],
      ['POST', `/api/chats/${general.id}/files`],
    ])
    expect(
      uploads()
        .map((x) => x.fileName)
        .sort(),
    ).toEqual(['a.pdf', 'b.png'])
  })

  // 26
  it('attaches files dropped anywhere on the chat panel', async () => {
    await openBox()
    const list = await messageList()

    dropOn(list, [pickedFile('one.pdf'), pickedFile('two.pdf')])

    await waitFor(() => expect(uploads()).toHaveLength(2))
    expect(uploads().map((x) => x.url)).toEqual([
      `/api/chats/${general.id}/files`,
      `/api/chats/${general.id}/files`,
    ])
    expect(
      uploads()
        .map((x) => x.fileName)
        .sort(),
    ).toEqual(['one.pdf', 'two.pdf'])
  })

  // 26
  it('shows "Drop files to attach" while files are dragged over the chat panel, and not after they leave or drop', async () => {
    await openBox()
    const panel = chatPanel()
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

  // 26
  it('does not show the drop outline for something dragged that is not a file', async () => {
    await openBox()

    fireEvent.dragEnter(chatPanel(), {
      dataTransfer: { files: [], types: ['text/plain'], items: [] },
    })

    expect(within(chatPanel()).queryByText('Drop files to attach')).toBe(null)
  })

  // 26
  it('keeps a drop on the chat panel from reaching the card panel, and a drop on the card panel from reaching the chat panel', async () => {
    const { router } = await openBox()
    fakeFiles(login.id, [])
    await act(async () => {
      await router.navigate(`${boardPath}?card=${login.id}&chat=${general.id}`)
    })
    const card = await screen.findByRole('complementary', {
      name: 'Card WEB-12',
    })
    await within(card).findByRole('region', { name: 'Files' })

    dropOn(chatPanel(), [pickedFile('to-chat.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(1))
    dropOn(card, [pickedFile('to-card.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(2))

    expect(uploads().map((x) => [x.fileName, x.url])).toEqual([
      ['to-chat.pdf', `/api/chats/${general.id}/files`],
      ['to-card.pdf', `/api/cards/${login.id}/files`],
    ])
  })
})

describe('Pasting into the message box (criterion 27)', () => {
  const NOW = new Date(2026, 10, 16, 14, 5, 7)

  function atFixedTime() {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  }

  // 27
  it('attaches a pasted image when the clipboard holds no text, and inserts nothing into the editor', async () => {
    const { box } = await openBox()

    pasteInto(box, [pickedFile('image.png', 12, 'image/png')])

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.url).toBe(`/api/chats/${general.id}/files`)
    expect(box).toHaveTextContent('')
  })

  // 27
  it('calls a pasted image with no real name "Screenshot YYYY-MM-DD HH.MM.png", in the person’s own time', async () => {
    atFixedTime()
    const { box } = await openBox()

    pasteInto(box, [pickedFile('image.png', 12, 'image/png')])

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.fileName).toBe('Screenshot 2026-11-16 14.05.png')
    expect(
      await within(chatPanel()).findByText('Screenshot 2026-11-16 14.05.png'),
    ).toBeInTheDocument()
  })

  // 27
  it('uses the image’s real extension', async () => {
    atFixedTime()
    const { box } = await openBox()

    pasteInto(box, [pickedFile('image.jpg', 12, 'image/jpeg')])

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.fileName).toBe('Screenshot 2026-11-16 14.05.jpg')
  })

  // 27
  it('adds the seconds to the second of two images pasted in the same minute', async () => {
    atFixedTime()
    const { box } = await openBox()
    pasteInto(box, [pickedFile('image.png', 12, 'image/png')])
    await waitFor(() => expect(uploads()).toHaveLength(1))

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    pasteInto(box, [pickedFile('image.png', 12, 'image/png')])

    await waitFor(() => expect(uploads()).toHaveLength(2))
    expect(uploads()[0]!.fileName).toBe('Screenshot 2026-11-16 14.05.png')
    expect(uploads()[1]!.fileName).toMatch(
      /^Screenshot 2026-11-16 14\.05\.\d\d\.png$/,
    )
  })

  // 27
  it('keeps the own name of a file pasted from Explorer, and of a dropped file', async () => {
    const { box } = await openBox()

    pasteInto(box, [pickedFile('report.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(1))
    dropOn(chatPanel(), [pickedFile('image.png', 12, 'image/png')])
    await waitFor(() => expect(uploads()).toHaveLength(2))

    expect(uploads().map((x) => x.fileName)).toEqual([
      'report.pdf',
      'image.png',
    ])
  })

  // 27 (Jon, 2026-11-25): only "image.<ext>" counts as no real name
  it.each(['image.png', 'image.jpg', 'image.jpeg', 'image.gif', 'image.webp'])(
    'gives a pasted %s the screenshot name',
    async (name) => {
      atFixedTime()
      const { box } = await openBox()

      pasteInto(box, [pickedFile(name, 12, 'image/png')])

      await waitFor(() => expect(uploads()).toHaveLength(1))
      expect(uploads()[0]!.fileName).toMatch(
        /^Screenshot 2026-11-16 14\.05\.(png|jpg|jpeg|gif|webp)$/,
      )
    },
  )

  // 27 (Jon, 2026-11-25)
  it('keeps the own name of a pasted image called photo.png', async () => {
    const { box } = await openBox()

    pasteInto(box, [pickedFile('photo.png', 12, 'image/png')])

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.fileName).toBe('photo.png')
  })

  // 27
  it('pastes the text and attaches nothing when the clipboard holds text and a picture of it (Word)', async () => {
    const { box } = await openBox()

    pasteInto(box, [pickedFile('image.png', 12, 'image/png')], 'Some words')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(uploads()).toHaveLength(0)
    expect(box).toHaveTextContent('Some words')
  })
})

describe('Blank text with no file (criterion 13, Jon 2026-11-25)', () => {
  // 13
  it('says "Write a message or attach a file" and sends nothing', async () => {
    const { user, box, api } = await openBox()

    box.focus()
    await user.keyboard('{Enter}')

    expect(
      await within(chatPanel()).findByText('Write a message or attach a file'),
    ).toBeInTheDocument()
    expect(api.changes).toEqual([])
  })
})

describe('The files in the message box (criterion 28)', () => {
  // 28
  it('shows a chip with the name and size, and "Uploading… 45%" while it is sent', async () => {
    const { user } = await openBox()

    await pick(user, pickedFile('plan.pdf', 340 * 1024))
    uploads()[0]!.progress(0.45)

    const chip = await waitFor(() => chipOf('plan.pdf'))
    expect(chip).toHaveTextContent('340 KB')
    await waitFor(() => expect(chip).toHaveTextContent('Uploading… 45%'))
  })

  // 28
  it('shows a small preview once an image is up', async () => {
    const { user, api } = await openBox()
    await pick(user, pickedFile('shot.png', 12, 'image/png'))

    const file = stored(api, 'shot.png', { isImage: true })

    const chip = await waitFor(() => chipOf('shot.png'))
    const preview = await within(chip).findByRole('img', { name: 'shot.png' })
    expect(preview.getAttribute('src')).toContain(
      `/api/files/${file.id}/preview`,
    )
    expect(chip).not.toHaveTextContent('Uploading')
  })

  // 28
  it('has "Remove ‘name’", which stops an upload that is still running', async () => {
    const { user } = await openBox()
    await pick(user, pickedFile('plan.pdf'))

    await user.click(
      within(chipOf('plan.pdf')).getByRole('button', {
        name: 'Remove ‘plan.pdf’',
      }),
    )

    expect(uploads()[0]!.aborted).toBe(true)
    await waitFor(() => noChip('plan.pdf'))
  })

  // 28
  it('has "Remove ‘name’", which deletes a file that is up (a pending file) and drops the chip', async () => {
    const requests = recordRequests()
    const { user, api } = await openBox()
    await pick(user, pickedFile('plan.pdf'))
    const file = stored(api, 'plan.pdf')
    await waitFor(() =>
      expect(chipOf('plan.pdf')).not.toHaveTextContent('Uploading'),
    )

    await user.click(
      within(chipOf('plan.pdf')).getByRole('button', {
        name: 'Remove ‘plan.pdf’',
      }),
    )

    await waitFor(() => noChip('plan.pdf'))
    expect(
      requests
        .saves()
        .some(
          (r) => r.method === 'DELETE' && r.path === `/api/files/${file.id}`,
        ),
    ).toBe(true)
  })

  // 28
  it('shows the server’s own words for a refused upload, with "Try again" and "Dismiss"', async () => {
    const { user } = await openBox()
    await pick(user, pickedFile('plan.pdf'))

    uploads()[0]!.respond(413, {
      statusCode: 413,
      message: 'Files can be at most 100 MB',
    })

    const chip = await waitFor(() => chipOf('plan.pdf'))
    expect(
      await within(chip).findByText('Files can be at most 100 MB'),
    ).toBeInTheDocument()
    expect(
      within(chip).getByRole('button', { name: 'Try again' }),
    ).toBeVisible()
    expect(within(chip).getByRole('button', { name: 'Dismiss' })).toBeVisible()
  })

  // 28
  it('says "Couldn’t upload, try again" when the network fails or the server breaks', async () => {
    const { user } = await openBox()
    await pick(user, pickedFile('a.pdf'), pickedFile('b.pdf'))

    uploadOf('a.pdf').networkError()
    uploadOf('b.pdf').respond(500, {
      statusCode: 500,
      message: 'Internal server error',
    })

    for (const name of ['a.pdf', 'b.pdf']) {
      expect(
        await within(await waitFor(() => chipOf(name))).findByText(
          'Couldn’t upload, try again',
        ),
      ).toBeInTheDocument()
    }
    expect(within(chatPanel()).queryByText('Internal server error')).toBe(null)
  })

  // 28
  it('sends the same file again with "Try again", and drops the chip with "Dismiss"', async () => {
    const { user } = await openBox()
    await pick(user, pickedFile('a.pdf'), pickedFile('b.pdf'))
    uploadOf('a.pdf').networkError()
    uploadOf('b.pdf').networkError()

    await user.click(
      within(await waitFor(() => chipOf('a.pdf'))).getByRole('button', {
        name: 'Try again',
      }),
    )
    await user.click(
      within(await waitFor(() => chipOf('b.pdf'))).getByRole('button', {
        name: 'Dismiss',
      }),
    )

    await waitFor(() => expect(uploads()).toHaveLength(3))
    expect(uploads()[2]!.fileName).toBe('a.pdf')
    expect(uploads()[2]!.url).toBe(`/api/chats/${general.id}/files`)
    await waitFor(() => noChip('b.pdf'))
  })

  // 28
  it('refuses a file over the limit before sending anything, in words, and still uploads the others', async () => {
    const { user } = await openBox()

    await user.upload(chooser(), [
      pickedFile('plan.mov', 101 * MB, 'video/quicktime'),
      pickedFile('ok.pdf'),
    ])

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(uploads()[0]!.fileName).toBe('ok.pdf')
    expect(
      await within(chatPanel()).findByText('plan.mov is bigger than 100 MB'),
    ).toBeInTheDocument()
  })

  // 28
  it('refuses an 11th file with "A message can have at most 10 files" before sending anything', async () => {
    const { user } = await openBox()
    await pick(
      user,
      ...Array.from({ length: 10 }, (_, i) => pickedFile(`f${i}.pdf`)),
    )

    await user.upload(chooser(), [pickedFile('eleventh.pdf')])

    expect(
      await within(chatPanel()).findByText(
        'A message can have at most 10 files',
      ),
    ).toBeInTheDocument()
    expect(uploads()).toHaveLength(10)
    noChip('eleventh.pdf')
  })
})

describe('Send while uploading (criteria 29 to 31)', () => {
  // 29
  it('never turns Send off for uploads', async () => {
    const { user, box } = await openBox()
    await typeInto(user, box, 'Text')

    await pick(user, pickedFile('plan.pdf'))

    expect(sendButton()).toBeEnabled()
  })

  // 29
  it('shows "Sends when the files finish uploading" and Cancel when Enter is pressed while a file uploads, and sends nothing yet', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'See the plan')
    await pick(user, pickedFile('plan.pdf'))

    await user.keyboard('{Enter}')

    expect(await within(chatPanel()).findByText(WAITING)).toBeInTheDocument()
    expect(
      within(chatPanel()).getByRole('button', { name: 'Cancel' }),
    ).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(api.changes).toEqual([])
  })

  // 29
  it('does the same with the Send button', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'See the plan')
    await pick(user, pickedFile('plan.pdf'))

    await user.click(sendButton())

    expect(await within(chatPanel()).findByText(WAITING)).toBeInTheDocument()
    expect(api.changes).toEqual([])
  })

  // 29
  it('sends itself, text and files in one message, once every file has finished', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'See the plan')
    await pick(user, pickedFile('a.pdf'), pickedFile('b.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    const a = stored(api, 'a.pdf')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(api.changes).toEqual([])
    const b = stored(api, 'b.pdf')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]).toEqual({
      request: `POST /api/chats/${general.id}/messages`,
      body: {
        body: 'See the plan',
        id: expect.stringMatching(UUID),
        fileIds: [a.id, b.id],
      },
    })
    await waitFor(() =>
      expect(within(chatPanel()).queryByText(WAITING)).toBe(null),
    )
    expect(box).toHaveTextContent('')
    noChip('a.pdf')
    expect(
      await within(await messageList()).findByText('See the plan'),
    ).toBeInTheDocument()
  })

  // 29
  it('sends exactly once, however the uploads finish', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Once')
    await pick(user, pickedFile('a.pdf'), pickedFile('b.pdf'))
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    stored(api, 'a.pdf')
    stored(api, 'b.pdf')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(api.changes).toHaveLength(1)
  })

  // 29
  it('sends text that is blank with the files, when there are files', async () => {
    const { user, box, api } = await openBox()
    await pick(user, pickedFile('a.pdf'))
    stored(api, 'a.pdf')
    await waitFor(() =>
      expect(chipOf('a.pdf')).not.toHaveTextContent('Uploading'),
    )
    box.focus()

    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({
      body: '',
      fileIds: [expect.any(String)],
    })
  })

  // 29
  it('Cancel stops the send and keeps the text and the files, and uploads still running carry on', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Keep me')
    await pick(user, pickedFile('plan.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    await user.click(
      within(chatPanel()).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() =>
      expect(within(chatPanel()).queryByText(WAITING)).toBe(null),
    )
    expect(box).toHaveTextContent('Keep me')
    expect(chipOf('plan.pdf')).toBeVisible()
    expect(uploads()[0]!.aborted).toBe(false)
    stored(api, 'plan.pdf')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(api.changes).toEqual([])
    expect(box).toHaveTextContent('Keep me')
  })

  // 29 (decision 18 / question 2)
  it('sends what was on screen when Send was pressed, and ignores typing while it waits', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'First')
    await pick(user, pickedFile('plan.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    box.focus()
    await user.keyboard('more words')
    stored(api, 'plan.pdf')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { body: string }).body).toBe('First')
  })

  // 30
  it('does not send while a file has failed, shows Try again and Dismiss on it, and sends itself once it is dismissed', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Mixed')
    await pick(user, pickedFile('good.pdf'), pickedFile('bad.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)
    const good = stored(api, 'good.pdf')

    uploadOf('bad.pdf').respond(500, { statusCode: 500, message: 'Broken' })

    const chip = await waitFor(() => chipOf('bad.pdf'))
    await within(chip).findByRole('button', { name: 'Try again' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(api.changes).toEqual([])
    await user.click(within(chip).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({
      body: 'Mixed',
      fileIds: [good.id],
    })
    expect(box).toHaveTextContent('')
  })

  // 30
  it('sends itself once a failed file is tried again and finishes', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Retry')
    await pick(user, pickedFile('bad.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)
    uploadOf('bad.pdf').networkError()
    await user.click(
      within(await waitFor(() => chipOf('bad.pdf'))).getByRole('button', {
        name: 'Try again',
      }),
    )
    await waitFor(() => expect(uploads()).toHaveLength(2))
    expect(api.changes).toEqual([])

    const file = pendingFile('bad.pdf', general.id)
    api.hasPending(file)
    act(() => uploads()[1]!.respond(201, file))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({ fileIds: [file.id] })
  })

  // Question 3, 2026-11-16
  it('sends nothing and leaves the box empty when every file is dismissed and there is no text', async () => {
    const { user, box, api } = await openBox()
    await pick(user, pickedFile('bad.pdf'))
    box.focus()
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)
    uploadOf('bad.pdf').networkError()

    await user.click(
      within(await waitFor(() => chipOf('bad.pdf'))).getByRole('button', {
        name: 'Dismiss',
      }),
    )

    await waitFor(() =>
      expect(within(chatPanel()).queryByText(WAITING)).toBe(null),
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(api.changes).toEqual([])
    expect(box).toHaveTextContent('')
    noChip('bad.pdf')
  })

  // 30
  it('sends once when Try again and Dismiss are pressed in quick succession on different files', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Quick')
    await pick(user, pickedFile('a.pdf'), pickedFile('b.pdf'))
    await user.keyboard('{Enter}')
    uploadOf('a.pdf').networkError()
    uploadOf('b.pdf').networkError()
    const a = await waitFor(() => chipOf('a.pdf'))
    const b = await waitFor(() => chipOf('b.pdf'))

    await user.click(within(a).getByRole('button', { name: 'Dismiss' }))
    await user.click(within(b).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(api.changes).toHaveLength(1)
    expect(api.changes[0]!.body).toMatchObject({ body: 'Quick', fileIds: [] })
  })

  // 31
  it('sends nothing when the page is closed while a message waits', async () => {
    const { user, box, api, unmount } = await openBox()
    await typeInto(user, box, 'Never sent')
    await pick(user, pickedFile('plan.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)
    const file = pendingFile('plan.pdf', general.id)
    api.hasPending(file)
    const xhr = uploadOf('plan.pdf')

    unmount()
    xhr.respond(201, file)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(api.changes).toEqual([])
  })

  // 31
  it('sends nothing when the board is left while a message waits', async () => {
    const { user, box, api, router } = await openBox()
    await typeInto(user, box, 'Never sent')
    await pick(user, pickedFile('plan.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    await act(async () => {
      await router.navigate('/projects')
    })
    const file = pendingFile('plan.pdf', general.id)
    api.hasPending(file)
    act(() => uploadOf('plan.pdf').respond(201, file))
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(api.changes).toEqual([])
  })
})

describe('Drafts and sent messages with files (criteria 32 and 33)', () => {
  // 32
  it('keeps the files of a chat’s draft when the person switches chat and back', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Draft')
    await pick(user, pickedFile('plan.pdf'))
    stored(api, 'plan.pdf')
    await waitFor(() =>
      expect(chipOf('plan.pdf')).not.toHaveTextContent('Uploading'),
    )

    await user.click(screen.getByRole('link', { name: 'Release plan' }))
    await screen.findByRole('complementary', { name: 'Chat: Release plan' })
    await within(chatPanel()).findByRole('textbox', { name: 'Message' })
    expect(() => chipOf('plan.pdf')).toThrow()
    await user.click(screen.getByRole('link', { name: 'General' }))
    await screen.findByRole('complementary', { name: 'Chat: General' })
    await within(chatPanel()).findByRole('textbox', { name: 'Message' })

    expect(await waitFor(() => chipOf('plan.pdf'))).toBeVisible()
  })

  // 32
  it('empties the box, chips included, once the message is sent', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Sent')
    await pick(user, pickedFile('plan.pdf'))
    stored(api, 'plan.pdf')
    await waitFor(() =>
      expect(chipOf('plan.pdf')).not.toHaveTextContent('Uploading'),
    )

    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    await waitFor(() => noChip('plan.pdf'))
    expect(box).toHaveTextContent('')
  })

  // 32
  it('loses the files when the page is loaded again, like the text', async () => {
    const first = await openBox()
    await pick(first.user, pickedFile('plan.pdf'))
    stored(first.api, 'plan.pdf')
    await waitFor(() =>
      expect(chipOf('plan.pdf')).not.toHaveTextContent('Uploading'),
    )
    first.unmount()

    await openBox()

    noChip('plan.pdf')
  })

  // 33
  it('shows a message with files at once, faded and marked "Sending…", with its files listed', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'On its way')
    await pick(user, pickedFile('plan.pdf'))
    stored(api, 'plan.pdf')
    await waitFor(() =>
      expect(chipOf('plan.pdf')).not.toHaveTextContent('Uploading'),
    )
    const release = api.hold()

    await user.keyboard('{Enter}')

    await within(await messageList()).findByText('On its way')
    const sending = messageWith('On its way')
    expect(sending).toHaveTextContent('Sending…')
    expect(sending).toHaveTextContent('plan.pdf')
    release()
    await waitFor(() => expect(sending).not.toHaveTextContent('Sending…'))
    expect(messageWith('On its way')).toHaveTextContent('plan.pdf')
  })

  // 33
  it('keeps a message that could not be sent, and "Try again" sends the same id and fileIds', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Please arrive')
    await pick(user, pickedFile('plan.pdf'))
    const file = stored(api, 'plan.pdf')
    await waitFor(() =>
      expect(chipOf('plan.pdf')).not.toHaveTextContent('Uploading'),
    )
    const bodies: unknown[] = []
    server.use(
      http.post(
        '/api/chats/:chatId/messages',
        async ({ request }) => {
          bodies.push(await request.json())
          return apiError(500, 'Something broke')
        },
        { once: true },
      ),
    )

    await user.keyboard('{Enter}')

    const item = await waitFor(() => {
      const found = messageWith('Please arrive')
      expect(found).toHaveTextContent(/Couldn.t send/)
      return found
    })
    expect(item).toHaveTextContent('plan.pdf')
    await user.click(within(item).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toEqual({
      body: 'Please arrive',
      id: (bodies[0] as { id: string }).id,
      fileIds: [file.id],
    })
  })
})

describe('Files in the message list (criteria 34 and 35)', () => {
  function withFiles() {
    const note = message('Here is the plan', { author: ben })
    const files = [
      messageFile('plan.pdf', general.id, note.id, {
        size: 340 * 1024,
        uploader: { id: ben.id, displayName: 'Ben' },
      }),
      messageFile('shot.png', general.id, note.id, {
        isImage: true,
        uploader: { id: ben.id, displayName: 'Ben' },
      }),
    ]
    note.files = files
    return { note, files }
  }

  async function open(options: Parameters<typeof openChat>[0] = {}) {
    const app = openChat(options)
    await messageList()
    return app
  }

  // 34
  it('shows an image as a small preview that opens full size, and another file as a row with its name, size and "Download"', async () => {
    const { note, files } = withFiles()
    const { user } = await open({ messages: [note] })
    const item = await waitFor(() => messageWith('Here is the plan'))

    const image = within(item).getByRole('img', { name: 'shot.png' })
    expect(image.getAttribute('src')).toContain(
      `/api/files/${files[1]!.id}/preview`,
    )
    expect(item).toHaveTextContent('plan.pdf')
    expect(item).toHaveTextContent('340 KB')
    expect(
      within(item)
        .getByRole('link', { name: /^Download/ })
        .getAttribute('href'),
    ).toBe(`/api/files/${files[0]!.id}/download`)

    await user.click(within(item).getByRole('button', { name: 'shot.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'shot.png' })
    expect(within(dialog).getByRole('img', { name: 'shot.png' })).toBeVisible()
  })

  // 34
  it('shows no files under a message that has none', async () => {
    await open({ messages: [message('Just words')] })

    const item = messageWith('Just words')

    expect(within(item).queryByRole('link', { name: /^Download/ })).toBe(null)
    expect(within(item).queryByRole('img')).toBe(null)
  })

  // 34
  it('shows Remove on a file to its uploader, and not to another member', async () => {
    const own = message('Ben’s', { author: ben })
    own.files = [
      messageFile('b.pdf', general.id, own.id, {
        uploader: { id: ben.id, displayName: 'Ben' },
      }),
    ]
    const hers = message('Ana’s')
    hers.files = [messageFile('a.pdf', general.id, hers.id)]

    // Ben, a plain member.
    await open({ messages: [own, hers], me: ben })

    expect(
      within(messageWith('Ben’s')).getByRole('button', { name: /^Remove/ }),
    ).toBeVisible()
    expect(
      within(messageWith('Ana’s')).queryByRole('button', { name: /^Remove/ }),
    ).toBe(null)
  })

  // 34
  it('shows Remove to a project admin on someone else’s message', async () => {
    const { note } = withFiles()

    await open({ messages: [note] })

    await waitFor(() =>
      expect(
        within(messageWith('Here is the plan')).getAllByRole('button', {
          name: /^Remove/,
        }),
      ).toHaveLength(2),
    )
  })

  // 34
  it('asks "Remove ‘plan.pdf’?" with its warning, removes the file with the dialog’s Remove, and puts focus on the message’s "Message options" button', async () => {
    const mine = message('Mine')
    mine.files = [
      messageFile('plan.pdf', general.id, mine.id),
      messageFile('other.pdf', general.id, mine.id),
    ]
    const requests = recordRequests()
    const { user } = await open({ messages: [mine] })
    const item = await waitFor(() => messageWith('Mine'))

    await user.click(
      await within(item).findByRole('button', { name: /^Remove.*plan\.pdf/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })
    expect(dialog).toHaveTextContent(
      'This deletes the file for everyone. It can’t be undone.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(within(messageWith('Mine')).queryByText('plan.pdf')).toBe(null),
    )
    expect(within(messageWith('Mine')).getByText('other.pdf')).toBeVisible()
    expect(
      requests
        .saves()
        .some(
          (r) =>
            r.method === 'DELETE' &&
            r.path === `/api/files/${mine.files[0]!.id}`,
        ),
    ).toBe(true)
    expect(
      within(messageWith('Mine')).getByRole('button', {
        name: 'Message options',
      }),
    ).toHaveFocus()
  })

  // 34
  it('puts focus on the message itself after removing a file from a message with no options menu', async () => {
    // Ben, a plain member, removes his own file from Ana’s message: he has no
    // options menu on it.
    const anas = message('Ana’s words')
    anas.files = [
      messageFile('b.pdf', general.id, anas.id, {
        uploader: { id: ben.id, displayName: 'Ben' },
      }),
      messageFile('c.pdf', general.id, anas.id),
    ]
    const { user } = await open({ messages: [anas], me: ben })
    const item = await waitFor(() => messageWith('Ana’s words'))
    expect(
      within(item).queryByRole('button', { name: 'Message options' }),
    ).toBe(null)

    await user.click(
      await within(item).findByRole('button', { name: /^Remove.*b\.pdf/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘b.pdf’?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(within(messageWith('Ana’s words')).queryByText('b.pdf')).toBe(
        null,
      ),
    )
    expect(messageWith('Ana’s words').contains(document.activeElement)).toBe(
      true,
    )
  })

  // 34
  it('shows the server’s words on that file, and keeps it, when removing the last file of a message with no text is refused', async () => {
    const only = message('', {})
    only.files = [messageFile('plan.pdf', general.id, only.id)]
    const { user, api } = await open({ messages: [only] })
    api.failFileRemoval({ status: 400, message: NEEDS_TEXT_OR_FILE })
    const item = await waitFor(() =>
      within(chatPanel()).getByRole('log', { name: 'Messages' }),
    )

    await user.click(
      await within(item).findByRole('button', { name: /^Remove.*plan\.pdf/ }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ‘plan.pdf’?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await within(item).findByText(NEEDS_TEXT_OR_FILE)).toBeVisible()
    expect(within(item).getByText('plan.pdf')).toBeVisible()
  })

  // 35
  it('says "Its 2 files will be deleted too." in the Delete this message dialog, and "Its file will be deleted too." for one', async () => {
    const { note } = withFiles()
    const single = message('One file', { author: ben })
    single.files = [messageFile('only.pdf', general.id, single.id)]
    const { user } = await open({ messages: [note, single] })

    for (const [text, line] of [
      ['Here is the plan', 'Its 2 files will be deleted too.'],
      ['One file', 'Its file will be deleted too.'],
    ] as const) {
      await openMenu(
        user,
        within(messageWith(text)).getByRole('button', {
          name: 'Message options',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete this message?',
      })
      expect(dialog).toHaveTextContent(line)
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Delete this message?' }),
        ).toBe(null),
      )
    }
  })

  // 35
  it('says nothing about files in the dialog for a message with none', async () => {
    const { user } = await open({ messages: [message('Plain')] })

    await openMenu(
      user,
      within(messageWith('Plain')).getByRole('button', {
        name: 'Message options',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })

    expect(dialog).not.toHaveTextContent(/deleted too/)
  })

  // 35
  it('shows a deleted message with no files', async () => {
    const { note } = withFiles()
    const { user } = await open({ messages: [note], me: ben })
    await waitFor(() =>
      expect(messageWith('Here is the plan')).toHaveTextContent('plan.pdf'),
    )
    await openMenu(
      user,
      await within(messageWith('Here is the plan')).findByRole('button', {
        name: 'Message options',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete this message?',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(messageWith('Here is the plan')).toHaveTextContent('Deleted by'),
    )
    expect(messageWith('Here is the plan')).not.toHaveTextContent('plan.pdf')
    expect(
      within(messageWith('Here is the plan')).queryByRole('img', {
        name: 'shot.png',
      }),
    ).toBe(null)
  })
})

describe('Editing stays text only (criterion 21)', () => {
  // 21
  it('has no file controls in the edit box, and does not change the files', async () => {
    const mine = message('Edit me')
    mine.files = [messageFile('plan.pdf', general.id, mine.id)]
    const app = openChat({ messages: [mine] })
    await messageList()
    await waitFor(() =>
      expect(messageWith('Edit me')).toHaveTextContent('plan.pdf'),
    )
    await openMenu(
      app.user,
      within(await waitFor(() => messageWith('Edit me'))).getByRole('button', {
        name: 'Message options',
      }),
    )
    await app.user.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    const editor = await within(messageWith('Edit me')).findByRole('textbox')

    const item = messageWith('Edit me')
    expect(within(item).queryByRole('button', { name: 'Attach file' })).toBe(
      null,
    )
    expect(item.querySelector('input[type="file"]')).toBe(null)
    expect(editor).toBeVisible()
  })

  // 21
  it('lets the text be edited to blank while the message has files, and sends only the text', async () => {
    const mine = message('Edit me')
    mine.files = [messageFile('plan.pdf', general.id, mine.id)]
    const { user, api } = openChat({ messages: [mine] })
    await messageList()
    await openMenu(
      user,
      within(await waitFor(() => messageWith('Edit me'))).getByRole('button', {
        name: 'Message options',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const editor = await within(messageWith('Edit me')).findByRole('textbox')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}{Backspace}{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]).toEqual({
      request: `PATCH /api/messages/${mine.id}`,
      body: { body: '' },
    })
  })
})

describe('Live (criterion 36)', () => {
  // 36
  it('shows a message with files that someone else sent, and a file they removed, without a reload', async () => {
    const { api } = openChat({ messages: [message('Old')] })
    await messageList()
    const fresh = message('From Ben', { author: ben })
    fresh.files = [
      messageFile('plan.pdf', general.id, fresh.id, {
        uploader: { id: ben.id, displayName: 'Ben' },
      }),
      messageFile('two.pdf', general.id, fresh.id, {
        uploader: { id: ben.id, displayName: 'Ben' },
      }),
    ]
    api.arrive(general.id, fresh)

    await live.messageChanged(general.id, fresh.id)

    const item = await waitFor(() => messageWith('From Ben'))
    expect(item).toHaveTextContent('plan.pdf')
    expect(item).toHaveTextContent('two.pdf')

    api
      .messagesOf(general.id)
      .find((m) => m.id === fresh.id)!
      .files.pop()
    await live.messageChanged(general.id, fresh.id)

    await waitFor(() =>
      expect(messageWith('From Ben')).not.toHaveTextContent('two.pdf'),
    )
    expect(messageWith('From Ben')).toHaveTextContent('plan.pdf')
  })

  // 36
  it('shows a message deleted by someone else without its files', async () => {
    const note = message('Soon gone', { author: ben })
    note.files = [messageFile('plan.pdf', general.id, note.id)]
    const { api } = openChat({ messages: [note] })
    await messageList()
    await waitFor(() =>
      expect(messageWith('Soon gone')).toHaveTextContent('plan.pdf'),
    )

    api.remove(note.id, ben)
    api.messagesOf(general.id).find((m) => m.id === note.id)!.files = []
    await live.messageChanged(general.id, note.id)

    await waitFor(() =>
      expect(messageWith('Soon gone')).not.toHaveTextContent('plan.pdf'),
    )
  })

  // 36
  it('sends X-Live-Connection with an upload and with a removal', async () => {
    const requests = recordRequests()
    const mine = message('Mine')
    mine.files = [messageFile('plan.pdf', general.id, mine.id)]
    const { user } = await openBox({ messages: [mine] })
    await waitFor(() => expect(live.id).not.toBeNull())

    await pick(user, pickedFile('new.pdf'))
    expect(uploads()[0]!.headers['x-live-connection']).toBe(live.id)

    await user.click(
      await within(await waitFor(() => messageWith('Mine'))).findByRole(
        'button',
        {
          name: /^Remove.*plan\.pdf/,
        },
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
    expect(removal.headers.get('x-live-connection')).toBe(live.id)
  })
})

describe('Accessibility (criterion 37)', () => {
  // 37
  it('passes the axe checks with chips, a failed upload and the waiting note on show', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Text')
    await pick(
      user,
      pickedFile('up.pdf'),
      pickedFile('done.png', 12, 'image/png'),
      pickedFile('bad.pdf'),
    )
    stored(api, 'done.png', { isImage: true })
    uploadOf('bad.pdf').respond(500, { statusCode: 500, message: 'Broken' })
    await within(await waitFor(() => chipOf('bad.pdf'))).findByRole('button', {
      name: 'Try again',
    })
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    await expectNoAccessibilityProblems(chatPanel())
  })

  // 37
  it('passes the axe checks with the drop outline showing', async () => {
    await openBox()

    fireEvent.dragEnter(chatPanel(), dragging)
    await within(chatPanel()).findByText('Drop files to attach')

    await expectNoAccessibilityProblems(chatPanel())
  })

  // 37
  it('passes the axe checks with files in messages, and with the remove dialog and the image dialog open', async () => {
    const note = message('With files')
    note.files = [
      messageFile('plan.pdf', general.id, note.id),
      messageFile('shot.png', general.id, note.id, { isImage: true }),
    ]
    const { user } = openChat({ messages: [note] })
    await messageList()
    const item = await waitFor(() => messageWith('With files'))
    await within(item).findByRole('button', { name: /^Remove.*plan\.pdf/ })
    await expectNoAccessibilityProblems(chatPanel())

    await user.click(within(item).getByRole('button', { name: 'shot.png' }))
    await screen.findByRole('dialog', { name: 'shot.png' })
    await expectNoAccessibilityProblems(document.body)
    await user.keyboard('{Escape}')
    await user.click(
      await within(item).findByRole('button', { name: /^Remove.*plan\.pdf/ }),
    )
    await screen.findByRole('dialog', { name: 'Remove ‘plan.pdf’?' })
    await expectNoAccessibilityProblems(document.body)
  })
})
