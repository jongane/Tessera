import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  messageList,
  messageWith,
  openChat,
  openMenu,
} from '../test/chat-panel'
import { message } from '../test/fake-messages'

// Chat messages PR, criterion 45 (agreed 2026-11-10): if the rich edit box
// cannot open a message's body, the person edits it as plain text and the
// rest of the chat and board keep working. The failure is forced here for a
// body holding CANTOPEN, in the edit box only (not the message box).
vi.mock('./MessageEditor', async (importOriginal) => {
  const real = await importOriginal<typeof import('./MessageEditor')>()
  return {
    ...real,
    MessageEditor: (props: Parameters<typeof real.MessageEditor>[0]) => {
      if (props.initial?.includes('CANTOPEN')) {
        throw new Error('This body cannot be opened')
      }
      return real.MessageEditor(props)
    },
  }
})

beforeEach(() => {
  // React logs every error that reaches a boundary.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const BROKEN = 'CANTOPEN <odd> body'

async function startEditing(
  options: Parameters<typeof openChat>[0] = {
    messages: [message('Hello before'), message(BROKEN)],
  },
) {
  const app = openChat(options)
  await messageList()
  await screen.findByText('Hello before')
  const item = messageWith(/CANTOPEN/)
  await openMenu(
    app.user,
    within(item).getByRole('button', { name: 'Message options' }),
  )
  await app.user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
  return { ...app, item }
}

describe('Editing a body the rich editor cannot open (criterion 45)', () => {
  // 45
  it('opens a plain text box labelled "Message" with Save and Cancel, and the chat keeps working', async () => {
    const { item } = await startEditing()

    const box = await within(item).findByRole('textbox', { name: 'Message' })
    expect(box).toHaveValue(BROKEN)
    expect(within(item).getByRole('button', { name: 'Save' })).toBeVisible()
    expect(within(item).getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(screen.getByText('Hello before')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Sprint 1', level: 1 }),
    ).toBeInTheDocument()
  })

  // 45
  it('saves the plain text edit with PATCH and shows the new text with "(edited)"', async () => {
    const { user, api, item } = await startEditing()
    const box = await within(item).findByRole('textbox', {
      name: 'Message',
    })

    await user.clear(box)
    await user.type(box, 'Fixed <odd> body', { skipClick: true })
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.changes).toHaveLength(1))
    expect(api.changes[0]!.request).toMatch(/^PATCH \/api\/messages\//)
    expect(api.changes[0]!.body).toEqual({ body: 'Fixed <odd> body' })
    await waitFor(() => expect(item).toHaveTextContent('(edited)'))
    expect(item).toHaveTextContent('Fixed <odd> body')
    expect(within(item).queryByRole('textbox')).not.toBeInTheDocument()
  })

  // 45
  it('Cancel leaves the message as it was and sends nothing', async () => {
    const { user, api, item } = await startEditing()

    await user.click(within(item).getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText(BROKEN)).toBeInTheDocument()
    expect(
      within(messageWith(/CANTOPEN/)).queryByRole('textbox'),
    ).not.toBeInTheDocument()
    expect(api.changes).toEqual([])
  })

  // 45
  it('applies the blank rule: blank text is not saved', async () => {
    const { user, api, item } = await startEditing()
    const box = await within(item).findByRole('textbox', {
      name: 'Message',
    })

    await user.clear(box)
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    expect(api.changes).toEqual([])
  })
})
