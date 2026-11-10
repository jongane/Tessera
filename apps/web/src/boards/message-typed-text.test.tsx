import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  chatPanel,
  messageList,
  messageWith,
  openChat,
  openMenu,
  typeInto,
} from '../test/chat-panel'
import {
  TYPED_LINE_START,
  TYPED_TEXTS,
  withoutEscapes,
} from '../test/typed-text'

// Chat messages PR, criterion 43 (agreed 2026-11-10): typed text is never
// treated as HTML. It stays as typed through sending, editing and saving
// again, and the stored text keeps < > & as typed (apart from the escapes
// Markdown itself needs).
const cases: [string, string][] = [...TYPED_TEXTS, TYPED_LINE_START]
const ENTITY_CASE = 'a literal &lt;div&gt; here'

async function editAndSave(
  user: ReturnType<typeof openChat>['user'],
  shown: string,
  extra: string,
) {
  const button = within(messageWith(shown)).getByRole('button', {
    name: 'Message options',
  })
  await openMenu(user, button)
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
  const editor = await within(messageWith(shown)).findByRole('textbox')
  // The editor takes the focus once it is ready; typing sooner is lost.
  await waitFor(() => expect(editor).toHaveFocus())
  // The editor opens holding the text as it was typed.
  expect(editor.textContent).toBe(shown)
  await user.keyboard(extra)
  await user.click(
    within(messageWith(shown + extra)).getByRole('button', { name: 'Save' }),
  )
}

describe('Typed text is kept as typed in a message (criterion 43)', () => {
  it.each(cases)(
    'keeps %s through sending, editing and saving again',
    async (_name, text) => {
      const { user, api } = openChat()
      const box = await within(
        await screen.findByRole('complementary', { name: /^Chat: / }),
      ).findByRole('textbox', { name: 'Message' })

      await typeInto(user, box, text)
      await user.keyboard('{Enter}')
      const list = await messageList()
      expect(await within(list).findByText(text)).toBeInTheDocument()

      await editAndSave(user, text, ' more')
      expect(await within(list).findByText(`${text} more`)).toBeInTheDocument()
      await editAndSave(user, `${text} more`, ' again')
      expect(
        await within(list).findByText(`${text} more again`),
      ).toBeInTheDocument()

      await waitFor(() => expect(api.changes).toHaveLength(3))
      if (text !== ENTITY_CASE) {
        // (The literal entity's own text holds "&gt;", and the exact text
        // was already found above.)
        expect(list).not.toHaveTextContent(/&(gt|lt|amp);/)
        // Stored as typed.
        const bodies = api.changes.map((c) => (c.body as { body: string }).body)
        expect(bodies.map(withoutEscapes)).toEqual([
          text,
          `${text} more`,
          `${text} more again`,
        ])
        for (const body of bodies) {
          expect(body).not.toMatch(/&(gt|lt|amp);/)
        }
      }
      expect(chatPanel()).toBeInTheDocument()
    },
  )
})
