import type { Editor } from '@tiptap/react'
import { type FileInfo, formatFileSize } from '@tessera/shared'
import { useEffect, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { MessageEditor } from './MessageEditor'
import { checkMessage, markdownOf } from './message-text'
import {
  type Attachment,
  type MessageOutbox,
  useAttachNotes,
  useAttachments,
  useWaitingSend,
} from './message-outbox'
import { useAttach } from './use-attach'

const BLANK = 'Write a message or attach a file'
const WAITING = 'Sends when the files finish uploading'

// The message box at the bottom of a chat. What is typed, and the files
// attached, are kept in the outbox while the page is open, so switching chats
// does not lose them.
export function MessageComposer({
  chatId,
  outbox,
  onSend,
}: {
  chatId: string
  outbox: MessageOutbox
  // `files` is undefined when the box had no files.
  onSend: (body: string, files?: FileInfo[]) => void
}) {
  const attach = useAttach(outbox, chatId)
  const [problem, setProblem] = useState<string>()
  // Enter in the editor sends, through the controls under it (which can see
  // the files and the waiting state).
  const submit = useRef<() => void>(() => {})

  return (
    <MessageEditor
      label="Message"
      initial={outbox.draft(chatId)}
      onEnter={() => submit.current()}
      onChange={(markdown) => {
        outbox.setDraft(chatId, markdown)
        setProblem(undefined)
      }}
      onPasteFiles={(files) => attach(files, { pasted: true })}
    >
      {(editor) => (
        <Controls
          editor={editor}
          chatId={chatId}
          outbox={outbox}
          problem={problem}
          onProblem={setProblem}
          onSend={onSend}
          onAttach={attach}
          submitRef={submit}
        />
      )}
    </MessageEditor>
  )
}

// Everything under the editor: the files, the waiting note and Send. It sends
// the message, at once or once the files have finished uploading.
function Controls({
  editor,
  chatId,
  outbox,
  problem,
  onProblem,
  onSend,
  onAttach,
  submitRef,
}: {
  editor: Editor
  chatId: string
  outbox: MessageOutbox
  problem: string | undefined
  onProblem: (problem: string | undefined) => void
  onSend: (body: string, files?: FileInfo[]) => void
  onAttach: (files: File[]) => void
  submitRef: React.RefObject<() => void>
}) {
  const attachments = useAttachments(outbox, chatId)
  const notes = useAttachNotes(outbox, chatId)
  const waiting = useWaitingSend(outbox, chatId)
  const chooser = useRef<HTMLInputElement>(null)

  // What is typed is locked while the message waits to send itself.
  useEffect(() => {
    editor.setEditable(waiting === null)
  }, [editor, waiting])

  useEffect(() => {
    submitRef.current = submit
  })

  function emptyBox() {
    editor.commands.clearContent(true)
    outbox.setDraft(chatId, '')
    outbox.clearAttachments(chatId)
    editor.commands.focus()
  }

  function submit() {
    if (outbox.waitingSend(chatId)) return
    const rows = outbox.attachments(chatId)
    const checked = checkMessage(markdownOf(editor), rows.length > 0)
    if (!checked.ok) {
      onProblem(checked.reason ?? BLANK)
      return
    }
    onProblem(undefined)
    if (rows.some((row) => row.stored === null)) {
      outbox.startWaiting(chatId, {
        body: checked.body,
        withFiles: true,
      })
      return
    }
    sendNow(checked.body, rows.length > 0)
  }

  function sendNow(body: string, withFiles: boolean) {
    const stored = outbox
      .attachments(chatId)
      .flatMap((row) => (row.stored ? [row.stored] : []))
    emptyBox()
    onSend(body, withFiles ? stored : undefined)
  }

  // A waiting message sends itself once every file has finished (uploaded, or
  // dismissed after failing), exactly once.
  useEffect(() => {
    if (!waiting || attachments.some((row) => row.stored === null)) return
    outbox.stopWaiting(chatId)
    if (waiting.body === '' && attachments.length === 0) {
      // Everything was dismissed and there is no text: nothing to send.
      emptyBox()
      return
    }
    sendNow(waiting.body, waiting.withFiles)
    // emptyBox and sendNow only use what is given and the outbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, attachments])

  return (
    <>
      <input
        ref={chooser}
        type="file"
        multiple
        hidden
        aria-label="Choose files to attach"
        onChange={(event) => {
          onAttach(Array.from(event.target.files ?? []))
          // Back to the text, where the person was typing.
          editor.view.focus()
          // So the same file can be picked again.
          event.target.value = ''
        }}
      />
      {notes.map((note) => (
        <Alert key={note}>{note}</Alert>
      ))}
      {attachments.length > 0 && (
        <ul aria-label="Files to send" className="flex flex-col gap-2">
          {attachments.map((row) => (
            <Chip key={row.id} row={row} outbox={outbox} />
          ))}
        </ul>
      )}
      {problem && <Alert>{problem}</Alert>}
      {waiting && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-muted">
            {WAITING}
          </p>
          <Button
            variant="secondary"
            className="min-h-8"
            onClick={() => outbox.stopWaiting(chatId)}
          >
            Cancel
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          className="min-h-8 text-sm"
          onClick={() => chooser.current?.click()}
        >
          Attach file
        </Button>
        <Button onClick={submit}>Send</Button>
      </div>
    </>
  )
}

// One file in the box: its name and size, how far it has got, a preview of an
// image that is up, and what can be done with it.
function Chip({ row, outbox }: { row: Attachment; outbox: MessageOutbox }) {
  const running = row.stored === null && row.error === null
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-line p-2">
      <div className="flex items-start gap-2">
        {row.stored?.isImage && (
          <img
            src={`/api/files/${row.stored.id}/preview`}
            alt={row.name}
            className="size-12 shrink-0 rounded-md object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="break-all font-semibold">{row.name}</span>
          <span className="text-sm text-muted">
            {formatFileSize(row.file.size)}
          </span>
          {running && (
            <span className="text-sm text-muted">{`Uploading… ${row.percent}%`}</span>
          )}
        </div>
        {row.error === null && (
          <Button
            variant="link"
            className="min-h-8 text-danger"
            aria-label={`Remove ‘${row.name}’`}
            onClick={() => outbox.takeOut(row)}
          >
            Remove
          </Button>
        )}
      </div>
      {row.error !== null && (
        <>
          <Alert>{row.error}</Alert>
          <div className="flex gap-3">
            <Button
              variant="link"
              className="min-h-8"
              onClick={() => outbox.retry(row)}
            >
              Try again
            </Button>
            <Button
              variant="link"
              className="min-h-8"
              onClick={() => outbox.dismiss(row)}
            >
              Dismiss
            </Button>
          </div>
        </>
      )}
    </li>
  )
}
