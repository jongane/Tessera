import type { FileInfo } from '@tessera/shared'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatPanel, general, openChat, typeInto } from '../test/chat-panel'
import {
  installFakeUploads,
  pendingFile,
  pickedFile,
  uploadOf,
  uploads,
} from '../test/fake-files'
import { server } from '../test/server'

// Antagonist proof test, round 3. The leftover list asked for when a chat
// opens can answer after the person has already sent a file it names: the
// box then shows a chip for a file that is on a sent message (a stale chip,
// whose message would be refused with "A file is no longer there").

beforeEach(() => {
  installFakeUploads()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function chipNamed(name: string): HTMLElement | undefined {
  const log = within(chatPanel()).queryByRole('log', { name: 'Messages' })
  return within(chatPanel())
    .queryAllByRole('listitem')
    .find((item) => !log?.contains(item) && item.textContent?.includes(name))
}

describe('Leftover list answered late (round 3 attack)', () => {
  it('shows no chip for a file that was sent while the leftover list was on its way', async () => {
    let stored: FileInfo | null = null
    let readList!: () => void
    const listRead = new Promise<void>((resolve) => (readList = resolve))
    let answerList!: () => void
    const listAnswered = new Promise<void>((resolve) => (answerList = resolve))
    const app = openChat()
    // The server reads the pending files once plan.pdf is stored, and the
    // answer reaches the browser only after the message was sent.
    server.use(
      http.get('/api/chats/:chatId/files', async () => {
        await listRead
        const files = stored ? [stored] : []
        await listAnswered
        return HttpResponse.json({ files })
      }),
    )
    const { user, api } = app
    const box = await within(
      await screen.findByRole('complementary', { name: /^Chat: / }),
    ).findByRole('textbox', { name: 'Message' })
    await typeInto(user, box, 'Here')
    const input =
      chatPanel().querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, [pickedFile('plan.pdf')])
    await waitFor(() => expect(uploads()).toHaveLength(1))
    stored = pendingFile('plan.pdf', general.id)
    api.hasPending(stored)
    readList()
    act(() => uploadOf('plan.pdf').respond(201, stored))
    await waitFor(() =>
      expect(chipNamed('plan.pdf')).not.toHaveTextContent('Uploading'),
    )
    box.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.changes).toHaveLength(1))
    await waitFor(() => expect(chipNamed('plan.pdf')).toBeUndefined())

    answerList()
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(chipNamed('plan.pdf')).toBeUndefined()
  })
})
