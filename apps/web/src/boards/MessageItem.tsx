import type { Message } from '@tessera/shared'
import { useEffect, useRef, useState } from 'react'
import { useDeleteMessage, useEditMessage } from '../api/messages'
import { ActionsMenu } from '../cards/ActionsMenu'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { exactTime } from '../ui/time-text'
import { When } from '../ui/When'
import { MessageEditor } from './MessageEditor'
import { MessageBody } from './message-markdown'
import {
  checkMessage,
  COULDNT_SAVE,
  DELETED_AUTHOR_NAME,
  markdownOf,
  refusalOr,
} from './message-text'

// A message that is on its way or could not be sent, shown with the others.
export interface Outgoing {
  status: 'sending' | 'failed'
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
  const [editing, setEditing] = useState(false)
  const item = useRef<HTMLLIElement>(null)
  // Once an edit is over, focus goes back to the message's menu button.
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) {
      item.current
        ?.querySelector<HTMLElement>('button[aria-label="Message options"]')
        ?.focus()
    }
    wasEditing.current = editing
  }, [editing])
  const [deleting, setDeleting] = useState<HTMLElement | null | false>(false)
  // Why the last delete failed.
  const [deleteProblem, setDeleteProblem] = useState<string>()
  const deleted = message.deletedAt !== null
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
        <EditForm message={message} onDone={() => setEditing(false)} />
      ) : deleted ? (
        <>
          <del className="text-muted">
            <MessageBody markdown={message.body} projectId={projectId} />
          </del>
          <p className="text-sm text-muted">
            Deleted by {message.deletedBy?.displayName ?? DELETED_AUTHOR_NAME},{' '}
            <When createdAt={message.deletedAt!} now={now} />
          </p>
        </>
      ) : (
        <>
          <MessageBody markdown={message.body} projectId={projectId} />
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

function EditForm({
  message,
  onDone,
}: {
  message: Message
  onDone: () => void
}) {
  const edit = useEditMessage(message.chatId)
  const [problem, setProblem] = useState<string>()

  function save(markdown: string) {
    const checked = checkMessage(markdown)
    if (!checked.ok) {
      setProblem(checked.reason ?? 'This can’t be empty')
    } else if (checked.body === message.body) {
      onDone()
    } else {
      setProblem(undefined)
      edit
        .mutateAsync({ id: message.id, body: checked.body })
        .then(onDone, (error: unknown) =>
          setProblem(refusalOr(error, COULDNT_SAVE)),
        )
    }
  }

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
          {problem && <Alert>{problem}</Alert>}
          <div className="flex gap-2">
            <Button
              disabled={edit.isPending}
              onClick={() => save(markdownOf(editor))}
            >
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
