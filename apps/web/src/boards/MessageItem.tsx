import type { Message } from '@tessera/shared'
import { Component, type ReactNode, useEffect, useRef, useState } from 'react'
import { useDeleteMessage, useEditMessage } from '../api/messages'
import { ActionsMenu } from '../cards/ActionsMenu'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { exactTime } from '../ui/time-text'
import { When } from '../ui/When'
import { MessageEditor } from './MessageEditor'
import { canHoldInMessageBox } from './message-extensions'
import { MessageBoundary } from './MessageBoundary'
import { MessageBody } from './message-markdown'
import { TheirVersion } from '../live/their-change'
import { useTheirChange } from '../live/use-their-change'
import {
  checkMessage,
  COULDNT_SAVE,
  DELETED_AUTHOR_NAME,
  markdownOf,
  refusalOr,
} from './message-text'

// A message that is on its way or could not be sent, shown with the others.
export interface Outgoing {
  status: 'sending' | 'failed' | 'saved'
  error?: string
  onRetry: () => void
}

export function MessageItem({
  message,
  projectId,
  now,
  showHeader,
  canEdit,
  canDelete,
  outgoing,
}: {
  message: Message
  projectId: string
  now: number
  // The author's name and the time, which a message that follows on from the
  // one before leaves out.
  showHeader: boolean
  canEdit: boolean
  canDelete: boolean
  outgoing?: Outgoing
}) {
  const [editStarted, setEditing] = useState(false)
  const deleted = message.deletedAt !== null
  // Someone deleting the message while you edit it closes the editor.
  const editing = editStarted && !deleted
  const item = useRef<HTMLLIElement>(null)
  // Once an edit is over, focus goes back to the message's menu button.
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) {
      // A deleted message has no menu: the message itself takes the focus.
      const menu = item.current?.querySelector<HTMLElement>(
        'button[aria-label="Message options"]',
      )
      ;(menu ?? item.current)?.focus()
    }
    wasEditing.current = editing
  }, [editing])
  const [deleting, setDeleting] = useState<HTMLElement | null | false>(false)
  // Why the last delete failed.
  const [deleteProblem, setDeleteProblem] = useState<string>()
  const menu = [
    canEdit && {
      name: 'Edit',
      onSelect: () => setEditing(true),
    },
    canDelete && {
      name: 'Delete',
      onSelect: (opener: HTMLElement | null) => {
        setDeleteProblem(undefined)
        setDeleting(opener)
      },
    },
  ].filter((action) => action !== false)

  return (
    <li
      ref={item}
      tabIndex={-1}
      className={`relative flex flex-col gap-0.5 ${showHeader ? 'mt-3' : ''} ${outgoing?.status === 'sending' ? 'opacity-60' : ''}`}
    >
      {showHeader ? (
        <div className="flex items-baseline gap-2 pr-8">
          <span className="font-semibold">
            {message.author?.displayName ?? DELETED_AUTHOR_NAME}
          </span>
          <When createdAt={message.createdAt} now={now} />
        </div>
      ) : (
        <time
          dateTime={message.createdAt}
          title={exactTime(new Date(message.createdAt))}
          className="sr-only"
        >
          {exactTime(new Date(message.createdAt))}
        </time>
      )}
      {editing ? (
        <EditForm
          message={message}
          projectId={projectId}
          onDone={() => setEditing(false)}
        />
      ) : deleted ? (
        <>
          <del className="text-muted">
            <MessageBoundary key={message.body} markdown={message.body}>
              <MessageBody markdown={message.body} projectId={projectId} />
            </MessageBoundary>
          </del>
          <p className="text-sm text-muted">
            Deleted by {message.deletedBy?.displayName ?? DELETED_AUTHOR_NAME},{' '}
            <When createdAt={message.deletedAt!} now={now} />
          </p>
        </>
      ) : (
        <>
          <MessageBoundary key={message.body} markdown={message.body}>
            <MessageBody markdown={message.body} projectId={projectId} />
          </MessageBoundary>
          {message.editedAt !== null && (
            <span className="text-sm text-muted">(edited)</span>
          )}
        </>
      )}
      {outgoing?.status === 'sending' && (
        <p className="text-sm text-muted">Sending…</p>
      )}
      {outgoing?.status === 'failed' && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-danger">
          <span>{outgoing.error}</span>
          <Button variant="link" className="min-h-8" onClick={outgoing.onRetry}>
            Try again
          </Button>
        </p>
      )}
      {menu.length > 0 && !deleted && !editing && (
        <ActionsMenu
          label="Message options"
          actions={menu}
          className="absolute top-0 right-0"
        />
      )}
      {deleteProblem && <Alert>{deleteProblem}</Alert>}
      {deleting !== false && (
        <DeleteDialog
          message={message}
          opener={deleting}
          onClose={() => setDeleting(false)}
          onFailed={(reason) => {
            setDeleting(false)
            setDeleteProblem(reason)
          }}
        />
      )}
    </li>
  )
}

// Saves an edit, with the same rules whichever box it was written in.
function useSaveEdit(message: Message, onDone: () => void) {
  const edit = useEditMessage(message.chatId)
  const [problem, setProblem] = useState<string>()
  // From sending until it fails: the saved change must not look like
  // someone else's.
  const [sending, setSending] = useState(false)

  function save(markdown: string) {
    if (edit.isPending) {
      return
    }
    const checked = checkMessage(markdown)
    if (!checked.ok) {
      setProblem(checked.reason ?? 'This can’t be empty')
    } else if (checked.body === message.body) {
      onDone()
    } else {
      setProblem(undefined)
      setSending(true)
      edit
        .mutateAsync({ id: message.id, body: checked.body })
        .then(onDone, (error: unknown) => {
          setSending(false)
          setProblem(refusalOr(error, COULDNT_SAVE))
        })
    }
  }

  return { save, problem, setProblem, saving: edit.isPending, sending }
}

// The rich edit box. If it cannot hold the message's body whole (a heading,
// say), found out before it opens, or fails to open it, the person edits the
// body as plain text instead (the chat carries on either way).
function EditForm({
  message,
  projectId,
  onDone,
}: {
  message: Message
  projectId: string
  onDone: () => void
}) {
  const [rich] = useState(() => canHoldInMessageBox(message.body))
  const plain = (
    <PlainEditForm message={message} projectId={projectId} onDone={onDone} />
  )
  return rich ? (
    <EditBoundary fallback={plain}>
      <RichEditForm message={message} projectId={projectId} onDone={onDone} />
    </EditBoundary>
  ) : (
    plain
  )
}

class EditBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// What the message says now, under the box, when someone else changed it
// while you were editing (docs/web-app.md, section 6).
function TheirMessage({
  theirs,
  projectId,
  onUseTheirs,
  onKeepMine,
}: {
  theirs: string
  projectId: string
  onUseTheirs: () => void
  onKeepMine: () => void
}) {
  return (
    <TheirVersion onUseTheirs={onUseTheirs} onKeepMine={onKeepMine}>
      <MessageBoundary key={theirs} markdown={theirs}>
        <MessageBody markdown={theirs} projectId={projectId} />
      </MessageBoundary>
    </TheirVersion>
  )
}

function PlainEditForm({
  message,
  projectId,
  onDone,
}: {
  message: Message
  projectId: string
  onDone: () => void
}) {
  const { save, problem, setProblem, saving, sending } = useSaveEdit(
    message,
    onDone,
  )
  const [text, setText] = useState(message.body)
  const change = useTheirChange(message.body, !sending)
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="Message"
        value={text}
        rows={4}
        autoFocus
        onChange={(event) => {
          setText(event.target.value)
          setProblem(undefined)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onDone()
          }
        }}
        className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2"
      />
      {change.theirs !== null && (
        <TheirMessage
          theirs={change.theirs}
          projectId={projectId}
          onUseTheirs={() => {
            setText(change.theirs ?? '')
            change.seen()
          }}
          onKeepMine={change.seen}
        />
      )}
      {problem && <Alert>{problem}</Alert>}
      <div className="flex gap-2">
        <Button disabled={saving} onClick={() => save(text.trim())}>
          Save
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function RichEditForm({
  message,
  projectId,
  onDone,
}: {
  message: Message
  projectId: string
  onDone: () => void
}) {
  const { save, problem, setProblem, saving, sending } = useSaveEdit(
    message,
    onDone,
  )
  const change = useTheirChange(message.body, !sending)
  return (
    <MessageEditor
      label="Edit message"
      initial={message.body}
      autofocus
      onEnter={(editor) => save(markdownOf(editor))}
      onEscape={onDone}
      onChange={() => setProblem(undefined)}
    >
      {(editor) => (
        <>
          {change.theirs !== null && (
            <TheirMessage
              theirs={change.theirs}
              projectId={projectId}
              onUseTheirs={() => {
                editor.commands.setContent(change.theirs ?? '', {
                  contentType: 'markdown',
                })
                change.seen()
              }}
              onKeepMine={change.seen}
            />
          )}
          {problem && <Alert>{problem}</Alert>}
          <div className="flex gap-2">
            <Button disabled={saving} onClick={() => save(markdownOf(editor))}>
              Save
            </Button>
            <Button variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </MessageEditor>
  )
}

function DeleteDialog({
  message,
  opener,
  onClose,
  onFailed,
}: {
  message: Message
  opener: HTMLElement | null
  onClose: () => void
  // The window closes and the message shows why the delete failed.
  onFailed: (reason: string) => void
}) {
  const remove = useDeleteMessage(message.chatId)
  return (
    <ConfirmDialog
      title="Delete this message?"
      confirmLabel="Delete"
      pending={remove.isPending}
      returnFocusTo={opener}
      onCancel={onClose}
      onConfirm={() =>
        remove
          .mutateAsync(message.id)
          .then(onClose, (error: unknown) =>
            onFailed(refusalOr(error, COULDNT_SAVE)),
          )
      }
    >
      Everyone can still read it, crossed out. This can’t be undone.
    </ConfirmDialog>
  )
}
