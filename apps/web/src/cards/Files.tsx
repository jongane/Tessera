import { type CardFile, formatFileSize } from '@tessera/shared'
import { useId, useRef, useState } from 'react'
import { useMe } from '../api/auth'
import { useCardFiles, useRemoveFile } from '../api/files'
import { useMembers } from '../api/members'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FORMER_MEMBER } from '../ui/former-member'
import { Loading } from '../ui/Loading'
import { When } from '../ui/When'
import { useEveryMinute } from './clock'
import { ImageDialog } from './ImageDialog'
import type { UploadRow, Uploads } from './use-uploads'

const LOAD_FAILED = 'Couldn’t load the files'
const REMOVE_FAILED = 'Couldn’t remove, try again'

const actionLink =
  'inline-flex min-h-8 items-center font-semibold text-accent hover:text-accent-strong hover:underline'

// The card's files, newest first, with the uploads on their way at the top:
// who added each one and when, a preview of an image, a download for every
// file, and Remove for the person who added it and for project admins
// (docs/card-features.md, section 8).
export function Files({
  cardId,
  projectId,
  uploads,
}: {
  cardId: string
  projectId: string
  uploads: Uploads
}) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const list = useCardFiles(cardId)
  const now = useEveryMinute()
  const files = list.data?.files ?? []
  const [previewing, setPreviewing] = useState<CardFile | null>(null)
  const removal = useRemoval(cardId, heading)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="font-semibold"
        >
          Files
        </h3>
        <Button
          variant="secondary"
          className="min-h-8 text-sm"
          onClick={() => chooser.current?.click()}
        >
          Attach file
        </Button>
        <input
          ref={chooser}
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          onChange={(event) => {
            uploads.attach(Array.from(event.target.files ?? []))
            // So the same file can be picked again.
            event.target.value = ''
          }}
        />
      </div>
      {uploads.tooBig.map((message, index) => (
        <Alert key={`${index}-${message}`}>{message}</Alert>
      ))}
      {list.isPending && <Loading />}
      {list.isError && !list.data && (
        <div className="flex flex-col items-start gap-2">
          <Alert>{LOAD_FAILED}</Alert>
          <Button variant="secondary" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {list.data && files.length === 0 && uploads.rows.length === 0 && (
        <p className="text-muted">No files yet</p>
      )}
      {(files.length > 0 || uploads.rows.length > 0) && (
        <ul aria-label="Files" className="flex flex-col gap-2">
          {uploads.rows.map((row) => (
            <UploadItem key={`upload-${row.id}`} row={row} uploads={uploads} />
          ))}
          {files.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              projectId={projectId}
              now={now}
              failure={removal.failures[file.id] ?? null}
              onPreview={setPreviewing}
              onRemove={removal.ask}
            />
          ))}
        </ul>
      )}
      {previewing && (
        <ImageDialog file={previewing} onClose={() => setPreviewing(null)} />
      )}
      {removal.asking && (
        <ConfirmDialog
          title={`Remove ‘${removal.asking.file.name}’?`}
          confirmLabel="Remove"
          onConfirm={removal.confirm}
          onCancel={removal.cancel}
          pending={removal.pending}
          returnFocusTo={removal.returnFocusTo}
        >
          This deletes the file for everyone. It can’t be undone.
        </ConfirmDialog>
      )}
    </section>
  )
}

const itemClass = 'flex flex-col gap-1 rounded-lg border border-line p-2'

function UploadItem({ row, uploads }: { row: UploadRow; uploads: Uploads }) {
  const nameId = useId()
  return (
    <li className={itemClass}>
      <span id={nameId} className="break-all font-semibold">
        {row.file.name}
      </span>
      {row.error ? (
        <>
          <Alert>{row.error}</Alert>
          <div className="flex gap-3">
            <Button
              variant="link"
              className="min-h-8"
              aria-describedby={nameId}
              onClick={() => uploads.retry(row)}
            >
              Try again
            </Button>
            <Button
              variant="link"
              className="min-h-8"
              aria-describedby={nameId}
              onClick={() => uploads.dismiss(row.id)}
            >
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label={`Uploading ${row.file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={row.percent}
            className="h-2 overflow-hidden rounded-full bg-subtle"
          >
            <div
              className="h-full bg-accent"
              style={{ width: `${row.percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">{`Uploading… ${row.percent}%`}</span>
            <Button
              variant="link"
              className="min-h-8"
              aria-describedby={nameId}
              onClick={row.cancel}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
    </li>
  )
}

// Asking before removing a file, and what comes of it. Kept above the rows,
// because a removed file's row is gone before focus has moved on.
function useRemoval(
  cardId: string,
  heading: React.RefObject<HTMLHeadingElement | null>,
) {
  const remove = useRemoveFile(cardId)
  const [asking, setAsking] = useState<{
    file: CardFile
    button: HTMLElement
  } | null>(null)
  // Set once the file is gone: focus then goes to the "Files" heading,
  // instead of back to the Remove button of a row that no longer exists.
  const removed = useRef(false)
  // Why a removal failed, by file.
  const [failures, setFailures] = useState<Record<string, string>>({})

  function confirm() {
    if (!asking) return
    const { id } = asking.file
    setFailures((all) =>
      Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)),
    )
    remove.mutateAsync(id).then(
      () => {
        removed.current = true
        setAsking(null)
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : REMOVE_FAILED
        setFailures((all) => ({ ...all, [id]: message }))
        setAsking(null)
      },
    )
  }

  return {
    asking,
    failures,
    pending: remove.isPending,
    returnFocusTo: () =>
      removed.current ? heading.current : (asking?.button ?? null),
    ask: (file: CardFile, button: HTMLElement) => {
      removed.current = false
      setAsking({ file, button })
    },
    cancel: () => setAsking(null),
    confirm,
  }
}

function FileItem({
  file,
  projectId,
  now,
  failure,
  onPreview,
  onRemove,
}: {
  file: CardFile
  projectId: string
  now: number
  failure: string | null
  onPreview: (file: CardFile) => void
  onRemove: (file: CardFile, button: HTMLElement) => void
}) {
  const me = useMe()
  const members = useMembers(projectId)
  const isAdmin =
    members.data?.find((member) => member.userId === me.data?.id)?.role ===
    'ADMIN'
  const mayRemove =
    isAdmin || (file.uploader !== null && file.uploader.id === me.data?.id)

  const nameId = useId()

  return (
    <li className={itemClass}>
      <div className="flex items-start gap-2">
        {file.isImage && (
          <button
            type="button"
            onClick={() => onPreview(file)}
            className="shrink-0 rounded-md border border-line"
          >
            <img
              src={`/api/files/${file.id}/preview`}
              alt={file.name}
              loading="lazy"
              className="size-16 rounded-md object-cover"
            />
          </button>
        )}
        <div className="flex min-w-0 flex-col">
          <span id={nameId} className="break-all font-semibold">
            {file.name}
          </span>
          <span className="text-sm text-muted">
            {formatFileSize(file.size)}
          </span>
          <span className="text-sm text-muted">
            {`Added by ${file.uploader?.displayName ?? FORMER_MEMBER} `}
            <When createdAt={file.createdAt} now={now} />
          </span>
        </div>
      </div>
      <div className="flex gap-3">
        <a
          href={`/api/files/${file.id}/download`}
          aria-describedby={nameId}
          className={actionLink}
        >
          Download
        </a>
        {mayRemove && (
          <Button
            variant="link"
            className="min-h-8 text-danger"
            aria-describedby={nameId}
            onClick={(event) => onRemove(file, event.currentTarget)}
          >
            Remove
          </Button>
        )}
      </div>
      {failure && <Alert>{failure}</Alert>}
    </li>
  )
}
