import { act, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatPanel,
  general,
  messageWith,
  openChat,
  releasePlan,
  typeInto,
} from '../test/chat-panel'
import {
  installFakeUploads,
  pendingFile,
  pickedFile,
  uploadOf,
  uploads,
} from '../test/fake-files'
import { apiError, server } from '../test/server'

// Files on messages, PR B, "Round 1 follow-ups" of the plan (built as
// recommended, Jon can still change them before merge):
// 1. A send refused with "A file is no longer there. Remove it and try
//    again." offers "Put back in the box" on the failed message: it removes
//    the failed copy and puts its text and its still-pending files back in
//    the box, dropping the files that are gone. The box learns which files
//    still exist from GET /api/chats/:chatId/files (answer `{ files }`, the
//    caller's own pending files of that chat, oldest first).
// 2. Switching to another chat while a message waits cancels the wait.
// 3. Opening a chat shows the person's own leftover pending files as chips.

const WAITING = 'Sends when the files finish uploading'
const A_FILE_IS_GONE = 'A file is no longer there. Remove it and try again.'
const TOO_MANY = 'A message can have at most 10 files'

beforeEach(() => {
  installFakeUploads()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

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
  if (!input) throw new Error('The message box has no file chooser')
  return input
}

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

async function pick(
  user: Awaited<ReturnType<typeof openBox>>['user'],
  ...files: File[]
) {
  const before = uploads().length
  await user.upload(chooser(), files)
  await waitFor(() => expect(uploads()).toHaveLength(before + files.length))
}

function stored(api: Awaited<ReturnType<typeof openBox>>['api'], name: string) {
  const file = pendingFile(name, general.id)
  api.hasPending(file)
  act(() => uploadOf(name).respond(201, file))
  return file
}

describe('"Put back in the box" after a refused send (follow-up 1)', () => {
  async function refusedSend() {
    const app = await openBox()
    const { user, box, api } = app
    await typeInto(user, box, 'Here it is')
    await pick(user, pickedFile('kept.pdf'), pickedFile('gone.pdf'))
    const kept = stored(api, 'kept.pdf')
    const gone = stored(api, 'gone.pdf')
    await waitFor(() =>
      expect(chipOf('gone.pdf')).not.toHaveTextContent('Uploading'),
    )
    // The server swept one of them meanwhile, and refuses the send.
    api.pending.delete(gone.id)
    server.use(
      http.post(
        '/api/chats/:chatId/messages',
        () => apiError(400, A_FILE_IS_GONE),
        { once: true },
      ),
    )
    await user.keyboard('{Enter}')
    const item = await waitFor(() => {
      const found = messageWith('Here it is')
      expect(found).toHaveTextContent(A_FILE_IS_GONE)
      return found
    })
    return { ...app, item, kept, gone }
  }

  // 1
  it('offers "Put back in the box" on a message refused for a missing file', async () => {
    const { item } = await refusedSend()

    expect(
      within(item).getByRole('button', { name: 'Put back in the box' }),
    ).toBeVisible()
  })

  // 1
  it('does not offer it for any other refusal', async () => {
    const { user, box } = await openBox()
    server.use(
      http.post('/api/chats/:chatId/messages', () =>
        apiError(500, 'Something broke'),
      ),
    )
    await typeInto(user, box, 'Other trouble')

    await user.keyboard('{Enter}')

    const item = await waitFor(() => {
      const found = messageWith('Other trouble')
      expect(found).toHaveTextContent(/Couldn.t send/)
      return found
    })
    expect(
      within(item).queryByRole('button', { name: 'Put back in the box' }),
    ).toBe(null)
  })

  // 1
  it('removes the failed copy and puts the text and the files that still exist back in the box, dropping the gone one', async () => {
    const { user, box, item, kept } = await refusedSend()
    expect(box).toHaveTextContent('')

    await user.click(
      within(item).getByRole('button', { name: 'Put back in the box' }),
    )

    await waitFor(() =>
      expect(
        within(
          within(chatPanel()).getByRole('log', { name: 'Messages' }),
        ).queryByText('Here it is'),
      ).toBe(null),
    )
    expect(box).toHaveTextContent('Here it is')
    expect(await waitFor(() => chipOf('kept.pdf'))).toBeVisible()
    noChip('gone.pdf')
    expect(kept.id).toBeTruthy()
  })

  // 1
  it('sends the put-back message again with only the files that still exist', async () => {
    const { user, box, item, api, kept } = await refusedSend()
    await user.click(
      within(item).getByRole('button', { name: 'Put back in the box' }),
    )
    await waitFor(() => expect(box).toHaveTextContent('Here it is'))
    await waitFor(() => chipOf('kept.pdf'))

    box.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({
      body: 'Here it is',
      fileIds: [kept.id],
    })
  })
})

describe('Switching chats while a message waits (follow-up 2)', () => {
  // 2
  it('cancels the wait: the text and the files stay in that chat’s box and nothing is sent until Send is pressed again', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Wait for me')
    await pick(user, pickedFile('plan.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    await user.click(screen.getByRole('link', { name: 'Release plan' }))
    await screen.findByRole('complementary', { name: 'Chat: Release plan' })
    // The upload finishes while the person is elsewhere.
    stored(api, 'plan.pdf')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(api.changes).toEqual([])
    await user.click(screen.getByRole('link', { name: 'General' }))
    await screen.findByRole('complementary', { name: 'Chat: General' })
    const again = await within(chatPanel()).findByRole('textbox', {
      name: 'Message',
    })

    await waitFor(() => expect(again).toHaveTextContent('Wait for me'))
    expect(await waitFor(() => chipOf('plan.pdf'))).toBeVisible()
    expect(within(chatPanel()).queryByText(WAITING)).toBe(null)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(api.changes).toEqual([])

    again.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({ body: 'Wait for me' })
  })

  // 2
  it('does not send the waiting message even when it is the other chat’s uploads that finish', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Never alone')
    await pick(user, pickedFile('plan.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    await user.click(screen.getByRole('link', { name: releasePlan.title }))
    await screen.findByRole('complementary', { name: 'Chat: Release plan' })

    expect(api.changes).toEqual([])
    expect(within(chatPanel()).queryByText(WAITING)).toBe(null)
  })
})

describe('Leftover pending files in the box (follow-up 3)', () => {
  const left = (name: string, fields = {}) =>
    pendingFile(name, general.id, fields)

  // 3
  it('shows the person’s own leftover pending files as chips when the chat is opened, and starts no upload', async () => {
    const a = left('a.pdf', { size: 340 * 1024 })
    const b = left('b.png', { isImage: true })
    const { api } = await openBox({ pendingFiles: [a, b] })

    const chip = await waitFor(() => chipOf('a.pdf'))
    expect(chip).toHaveTextContent('340 KB')
    expect(await waitFor(() => chipOf('b.png'))).toBeVisible()
    expect(
      within(chipOf('b.png'))
        .getByRole('img', { name: 'b.png' })
        .getAttribute('src'),
    ).toContain(`/api/files/${b.id}/preview`)
    expect(uploads()).toHaveLength(0)
    expect(api.fileGets.map((u) => u.pathname)).toContain(
      `/api/chats/${general.id}/files`,
    )
  })

  // 3
  it('shows no chip for a pending file of another chat', async () => {
    await openBox({
      pendingFiles: [pendingFile('elsewhere.pdf', releasePlan.id)],
    })

    await new Promise((resolve) => setTimeout(resolve, 150))

    noChip('elsewhere.pdf')
  })

  // 3
  it('removes a leftover file with "Remove ‘name’", deleting it on the server', async () => {
    const a = left('a.pdf')
    const { user, api } = await openBox({ pendingFiles: [a, left('b.pdf')] })
    await waitFor(() => chipOf('a.pdf'))

    await user.click(
      within(chipOf('a.pdf')).getByRole('button', { name: 'Remove ‘a.pdf’' }),
    )

    await waitFor(() => noChip('a.pdf'))
    expect(chipOf('b.pdf')).toBeVisible()
    expect(api.changes.map((c) => c.request)).toContain(
      `DELETE /api/files/${a.id}`,
    )
  })

  // 3
  it('sends the leftover files with the next message, oldest first', async () => {
    const a = left('a.pdf')
    const b = left('b.pdf')
    const { user, box, api } = await openBox({ pendingFiles: [a, b] })
    await waitFor(() => chipOf('b.pdf'))
    await typeInto(user, box, 'With the old ones')

    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({
      body: 'With the old ones',
      fileIds: [a.id, b.id],
    })
    expect(
      await within(chatPanel()).findByText('With the old ones'),
    ).toBeInTheDocument()
    await waitFor(() => noChip('a.pdf'))
  })

  // 3
  it('lets a message be sent with leftover files and no text', async () => {
    const a = left('a.pdf')
    const { user, box, api } = await openBox({ pendingFiles: [a] })
    await waitFor(() => chipOf('a.pdf'))
    box.focus()

    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({ body: '', fileIds: [a.id] })
  })

  // 3 ("the 10-per-chat limit then matches what the box shows")
  it('counts the leftover files towards the 10 in the box', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => left(`f${i}.pdf`))
    const { user } = await openBox({ pendingFiles: ten })
    await waitFor(() => chipOf('f9.pdf'))

    await user.upload(chooser(), [pickedFile('eleventh.pdf')])

    expect(await within(chatPanel()).findByText(TOO_MANY)).toBeInTheDocument()
    expect(uploads()).toHaveLength(0)
  })
})
