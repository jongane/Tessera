import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { MessageEditor } from './MessageEditor'
import { checkMessage, markdownOf } from './message-text'
import type { MessageOutbox } from './message-outbox'

// The message box at the bottom of a chat. What is typed is kept in the
// outbox while the page is open, so switching chats does not lose it.
export function MessageComposer({
  chatId,
  outbox,
  onSend,
}: {
  chatId: string
  outbox: MessageOutbox
  onSend: (body: string) => void
}) {
  const [problem, setProblem] = useState<string>()

  function submit(editor: Editor) {
    const checked = checkMessage(markdownOf(editor))
    if (!checked.ok) {
      setProblem(checked.reason)
      return
    }
    setProblem(undefined)
    editor.commands.clearContent(true)
    outbox.setDraft(chatId, '')
    onSend(checked.body)
    editor.commands.focus()
  }

  return (
    <MessageEditor
      label="Message"
      initial={outbox.draft(chatId)}
      onEnter={submit}
      onChange={(markdown) => {
        outbox.setDraft(chatId, markdown)
        setProblem(undefined)
      }}
    >
      {(editor) => (
        <>
          {problem && <Alert>{problem}</Alert>}
          <Button className="self-end" onClick={() => submit(editor)}>
            Send
          </Button>
        </>
      )}
    </MessageEditor>
  )
}
