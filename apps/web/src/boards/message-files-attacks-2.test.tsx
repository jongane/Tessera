import { act, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatPanel,
  general,
  messageWith,
  openChat,
  typeInto,
} from '../test/chat-panel'
import {
  installFakeUploads,
  messageFile,
  pendingFile,
  pickedFile,
  uploadOf,
  uploads,
} from '../test/fake-files'
import { message } from '../test/fake-messages'
import { apiError, server } from '../test/server'

// Round 2 of files on messages (PR B), "Round 2 fixes" of the plan: chips
// remove files through DELETE /api/chats/:chatId/files/:fileId (a file already
// sent answers 409 "This file was already sent" and the chip is dropped);
// "Put back in the box" brings only that message's own still-pending files, and
// is disabled with "Send or clear the message box first" when the box has text
// or chips or a message is waiting; a waiting send waits for and clears only
// its own rows; and a leftover with the same file id as a finished upload
// leaves one chip. Adapted from the antagonist's proofs.

const WAITING = 'Sends when the files finish uploading'
const A_FILE_IS_GONE = 'A file is no longer there. Remove it and try again.'
const CLEAR_FIRST = 'Send or clear the message box first'

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

function chipsOf(name: string): HTMLElement[] {
  const log = within(chatPanel()).queryByRole('log', { name: 'Messages' })
  return within(chatPanel())
    .queryAllByRole('listitem')
    .filter((item) => !log?.contains(item) && item.textContent?.includes(name))
}

function chipOf(name: string): HTMLElement {
  const found = chipsOf(name)[0]
  if (!found) throw new Error(`No chip for ${name}`)
  return found
}

type App = Awaited<ReturnType<typeof openBox>>

async function pick(user: App['user'], ...files: File[]) {
  const before = uploads().length
  await user.upload(chooser(), files)
  await waitFor(() => expect(uploads()).toHaveLength(before + files.length))
}

function stored(api: App['api'], name: string) {
  const file = pendingFile(name, general.id)
  api.hasPending(file)
  act(() => uploadOf(name).respond(201, file))
  return file
}

async function failedWith(text: string, error: RegExp | string) {
  return waitFor(() => {
    const found = messageWith(text)
    expect(found).toHaveTextContent(error)
    return found
  })
}

// "Here it is" with kept.pdf and gone.pdf, refused because gone.pdf is gone.
// Afterwards the box is empty and kept.pdf is still pending on the server.
async function refusedForGoneFile(app: App) {
  const { user, box, api } = app
  await typeInto(user, box, 'Here it is')
  await pick(user, pickedFile('kept.pdf'), pickedFile('gone.pdf'))
  const kept = stored(api, 'kept.pdf')
  const gone = stored(api, 'gone.pdf')
  await waitFor(() =>
    expect(chipOf('gone.pdf')).not.toHaveTextContent('Uploading'),
  )
  api.pending.delete(gone.id)
  server.use(
    http.post(
      '/api/chats/:chatId/messages',
      () => apiError(400, A_FILE_IS_GONE),
      { once: true },
    ),
  )
  await user.keyboard('{Enter}')
  const item = await failedWith('Here it is', A_FILE_IS_GONE)
  return { item, kept, gone }
}

describe('A chip never deletes a sent file (round 2, fix 2)', () => {
  // A chip whose file was sent meanwhile (here by another tab).
  it('removes through the chat’s pending-only route, and drops the chip without touching the sent file when the server says it was already sent', async () => {
    const a = pendingFile('a.pdf', general.id)
    const { user, api } = await openBox({ pendingFiles: [a] })
    await waitFor(() => chipOf('a.pdf'))
    // Another tab sent it.
    api.pending.delete(a.id)
    const sent = message('First')
    sent.files = [messageFile('a.pdf', general.id, sent.id)]
    sent.files[0]!.id = a.id
    api.arrive(general.id, sent)

    await user.click(
      within(chipOf('a.pdf')).getByRole('button', { name: 'Remove ‘a.pdf’' }),
    )

    await waitFor(() => expect(chipsOf('a.pdf')).toHaveLength(0))
    const requests = api.changes.map((c) => c.request)
    expect(requests).toContain(`DELETE /api/chats/${general.id}/files/${a.id}`)
    expect(requests).not.toContain(`DELETE /api/files/${a.id}`)
    expect(
      api
        .messagesOf(general.id)
        .find((m) => m.body === 'First')
        ?.files.map((f) => f.name),
    ).toEqual(['a.pdf'])
  })

  it('removes a pending chip through the chat’s route', async () => {
    const a = pendingFile('a.pdf', general.id)
    const { user, api } = await openBox({ pendingFiles: [a] })
    await waitFor(() => chipOf('a.pdf'))

    await user.click(
      within(chipOf('a.pdf')).getByRole('button', { name: 'Remove ‘a.pdf’' }),
    )

    await waitFor(() => expect(chipsOf('a.pdf')).toHaveLength(0))
    expect(api.changes.map((c) => c.request)).toEqual([
      `DELETE /api/chats/${general.id}/files/${a.id}`,
    ])
  })
})

describe('Put back in the box (round 2, fixes 1 and 3)', () => {
  // 1
  it('brings back only that message’s own still-pending files, not every leftover', async () => {
    const app = await openBox()
    const { user, box, api } = app
    const { item } = await refusedForGoneFile(app)
    // Uploaded in another tab meanwhile: pending on the server, not in this box.
    api.hasPending(pendingFile('other-tab.pdf', general.id))

    await user.click(
      within(item).getByRole('button', { name: 'Put back in the box' }),
    )

    await waitFor(() => expect(box).toHaveTextContent('Here it is'))
    await waitFor(() => chipOf('kept.pdf'))
    expect(chipsOf('gone.pdf')).toHaveLength(0)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(chipsOf('other-tab.pdf')).toHaveLength(0)
  })

  // 3
  it('is enabled when the box is empty', async () => {
    const app = await openBox()
    const { item } = await refusedForGoneFile(app)

    expect(
      within(item).getByRole('button', { name: 'Put back in the box' }),
    ).toBeEnabled()
    expect(item).not.toHaveTextContent(CLEAR_FIRST)
  })

  // 3
  it('is disabled with "Send or clear the message box first" when the box has text', async () => {
    const app = await openBox()
    const { user, box } = app
    const { item } = await refusedForGoneFile(app)
    await typeInto(user, box, 'A new draft')

    const button = within(item).getByRole('button', {
      name: 'Put back in the box',
    })
    await waitFor(() => expect(button).toBeDisabled())
    expect(item).toHaveTextContent(CLEAR_FIRST)
    await user.click(button)

    expect(box).toHaveTextContent('A new draft')
    expect(box).not.toHaveTextContent('Here it is')
    expect(messageWith('Here it is')).toBe(item)
  })

  // 3
  it('is disabled when the box has a chip, and enabled again once the box is empty', async () => {
    const app = await openBox()
    const { user } = app
    const { item } = await refusedForGoneFile(app)
    await pick(user, pickedFile('new.pdf'))

    const button = within(item).getByRole('button', {
      name: 'Put back in the box',
    })
    await waitFor(() => expect(button).toBeDisabled())
    expect(item).toHaveTextContent(CLEAR_FIRST)
    await user.click(
      within(chipOf('new.pdf')).getByRole('button', {
        name: 'Remove ‘new.pdf’',
      }),
    )

    await waitFor(() => expect(button).toBeEnabled())
  })

  // 3
  it('is disabled while another message waits to send, so nothing put back can be lost', async () => {
    const app = await openBox()
    const { user, box, api } = app
    const { item } = await refusedForGoneFile(app)
    await typeInto(user, box, 'Second')
    await pick(user, pickedFile('slow.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    const button = within(item).getByRole('button', {
      name: 'Put back in the box',
    })
    expect(button).toBeDisabled()
    await user.click(button)
    stored(api, 'slow.pdf')
    await waitFor(() => expect(api.changes).toHaveLength(1))

    // The failed message is still there, for when the box is free.
    expect(messageWith('Here it is')).toHaveTextContent(A_FILE_IS_GONE)
  })
})

describe('A waiting send touches only its own rows (round 2, minors)', () => {
  it('sends only the files on screen at Send, and keeps a chip that appeared during the wait in the box afterwards', async () => {
    const old = pendingFile('old.pdf', general.id)
    const app = await openBox({ pendingFiles: [old], holdPendingList: true })
    const { user, box, api } = app
    await typeInto(user, box, 'Mine')
    await pick(user, pickedFile('a.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    // The leftover list arrives while the message waits.
    act(() => api.releasePendingList())
    await waitFor(() => chipOf('old.pdf'))
    const a = stored(api, 'a.pdf')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({
      body: 'Mine',
      fileIds: [a.id],
    })
    await waitFor(() => expect(chipsOf('a.pdf')).toHaveLength(0))
    expect(chipOf('old.pdf')).toBeVisible()
    expect(within(chatPanel()).queryByText(WAITING)).toBe(null)
  })

  it('shows one chip, and sends no duplicate id, when a leftover arrives for a file whose upload then finishes', async () => {
    const app = await openBox({ holdPendingList: true })
    const { user, box, api } = app
    await pick(user, pickedFile('a.pdf'))
    const a = stored(api, 'a.pdf')
    await waitFor(() =>
      expect(chipOf('a.pdf')).not.toHaveTextContent('Uploading'),
    )

    // The list, asked before the upload finished, now answers with the file.
    act(() => api.releasePendingList())
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(chipsOf('a.pdf')).toHaveLength(1)
    await typeInto(user, box, 'Once')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({
      body: 'Once',
      fileIds: [a.id],
    })
  })

  it('shows one chip when the leftover list arrives while the upload is still running, and the upload then finishes', async () => {
    const app = await openBox({ holdPendingList: true })
    const { user, box, api } = app
    await pick(user, pickedFile('a.pdf'))
    const a = pendingFile('a.pdf', general.id)
    // The server already holds it (the bytes arrived) but has not answered yet.
    api.hasPending(a)
    act(() => api.releasePendingList())
    await new Promise((resolve) => setTimeout(resolve, 100))

    act(() => uploadOf('a.pdf').respond(201, a))

    await waitFor(() =>
      expect(chipOf('a.pdf')).not.toHaveTextContent('Uploading'),
    )
    expect(chipsOf('a.pdf')).toHaveLength(1)
    await typeInto(user, box, 'Once')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect((api.changes[0]!.body as { fileIds: string[] }).fileIds).toEqual([
      a.id,
    ])
  })
})
