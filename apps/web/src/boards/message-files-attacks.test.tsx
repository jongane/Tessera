import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatPanel, general, openChat, typeInto } from '../test/chat-panel'
import {
  installFakeUploads,
  pendingFile,
  pickedFile,
  uploadOf,
  uploads,
} from '../test/fake-files'

// Antagonist proof tests for files on messages (PR B). Each one fails on the
// branch as it is.

const WAITING = 'Sends when the files finish uploading'

beforeEach(() => {
  installFakeUploads()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function openBox() {
  const app = openChat()
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

function pasteInto(box: HTMLElement, files: File[]) {
  fireEvent.paste(box, {
    clipboardData: {
      files,
      types: ['Files'],
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
      getData: () => '',
    },
  })
}

describe('The waiting send keeps the chips locked (plan, Jon’s answer 2 of 2026-11-16; web-app.md §3)', () => {
  // "While a message waits to send itself, the text and file chips are
  // locked until it is sent or Cancel is pressed; what is sent is what was
  // on screen when Send was pressed." "Attach file" stays usable while it
  // waits, and a file picked then is sent with the waiting message.
  it('does not send a file picked with "Attach file" after Send was pressed', async () => {
    const { user, box, api } = await openBox()
    await typeInto(user, box, 'Only a')
    await pick(user, pickedFile('a.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    await pick(user, pickedFile('late.pdf'))
    const a = stored(api, 'a.pdf')
    stored(api, 'late.pdf')

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.body).toMatchObject({
      body: 'Only a',
      fileIds: [a.id],
    })
  })

  // The same through paste: the editor is read-only while it waits, but the
  // paste handler still attaches.
  it('does not attach a file pasted while the message waits', async () => {
    const { user, box } = await openBox()
    await typeInto(user, box, 'Only a')
    await pick(user, pickedFile('a.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)
    const before = uploads().length

    pasteInto(box, [pickedFile('image.png', 12, 'image/png')])
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(uploads()).toHaveLength(before)
  })

  // A chip's "Remove" still works while the message waits, so what is sent
  // is not what was on screen when Send was pressed.
  it('offers no working "Remove" on a chip while the message waits', async () => {
    const { user, box } = await openBox()
    await typeInto(user, box, 'With a')
    await pick(user, pickedFile('a.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)

    const remove = within(chipOf('a.pdf')).queryByRole('button', {
      name: 'Remove ‘a.pdf’',
    })
    expect(remove === null || (remove as HTMLButtonElement).disabled).toBe(true)
  })

  // Dropping is part of the lock too.
  it('does not attach files dropped on the chat panel while the message waits', async () => {
    const { user, box } = await openBox()
    await typeInto(user, box, 'Only a')
    await pick(user, pickedFile('a.pdf'))
    await user.keyboard('{Enter}')
    await within(chatPanel()).findByText(WAITING)
    const before = uploads().length

    const dropped = pickedFile('dropped.pdf')
    fireEvent.drop(chatPanel(), {
      dataTransfer: {
        files: [dropped],
        types: ['Files'],
        items: [{ kind: 'file', getAsFile: () => dropped }],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(uploads()).toHaveLength(before)
  })
})
