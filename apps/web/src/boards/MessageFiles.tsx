import { type FileInfo, formatFileSize } from '@tessera/shared'
import { useId, useRef, useState } from 'react'
import { useRemoveMessageFile } from '../api/messages'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ImageDialog } from '../ui/ImageDialog'
import { refusalOr } from './message-text'

const REMOVE_FAILED = 'Couldn’t remove, try again'

// The files of one message: images as small previews that open full size,
// other files as a row with name, size and Download. `canRemove` says whether
// the person may remove a file (its uploader, or a project admin); a message
// on its way (`readOnly`) offers nothing but the look of it. After a removal
// focus goes to `afterRemoval()`.
export function MessageFiles({
  files,
  chatId,
  cardId,
  canRemove,
  readOnly = false,
  afterRemoval,
}: {
  files: FileInfo[]
  chatId: string
  cardId: string | null
  canRemove: (file: FileInfo) => boolean
  readOnly?: boolean
  afterRemoval: () => HTMLElement | null
}) {
  const [previewing, setPreviewing] = useState<FileInfo | null>(null)
  const removal = useRemoval(chatId, cardId, afterRemoval)
  if (files.length === 0) return null
  const images = files.filter((file) => file.isImage)
  const others = files.filter((file) => !file.isImage)
  const mayRemove = (file: FileInfo) => !readOnly && canRemove(file)

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <ul aria-label="Images" className="flex flex-wrap items-end gap-2">
          {images.map((file) => (
            <li key={file.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setPreviewing(file)}
                className="rounded-md border border-line"
              >
                <img
                  src={`/api/files/${file.id}/preview`}
                  alt={file.name}
                  loading="lazy"
                  className="max-h-[200px] max-w-full rounded-md object-contain"
                />
              </button>
              {mayRemove(file) && (
                <RemoveButton
                  file={file}
                  onAsk={removal.ask}
                  failure={removal.failures[file.id]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul aria-label="Files" className="flex flex-col gap-1">
          {others.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              readOnly={readOnly}
              remove={
                mayRemove(file) && (
                  <RemoveButton
                    file={file}
                    onAsk={removal.ask}
                    failure={undefined}
                  />
                )
              }
              failure={removal.failures[file.id]}
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
    </div>
  )
}

function FileRow({
  file,
  readOnly,
  remove,
  failure,
}: {
  file: FileInfo
  readOnly: boolean
  remove: React.ReactNode
  failure: string | undefined
}) {
  const nameId = useId()
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-line px-2 py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={nameId} className="break-all font-semibold">
          {file.name}
        </span>
        <span className="text-sm text-muted">{formatFileSize(file.size)}</span>
        {!readOnly && (
          <a
            href={`/api/files/${file.id}/download`}
            aria-describedby={nameId}
            className="inline-flex min-h-8 items-center font-semibold text-accent hover:text-accent-strong hover:underline"
          >
            Download
          </a>
        )}
        {remove}
      </div>
      {failure && <Alert>{failure}</Alert>}
    </li>
  )
}

function RemoveButton({
  file,
  onAsk,
  failure,
}: {
  file: FileInfo
  onAsk: (file: FileInfo, button: HTMLElement) => void
  failure: string | undefined
}) {
  return (
    <>
      <Button
        variant="link"
        className="min-h-8 self-start text-danger"
        aria-label={`Remove ‘${file.name}’`}
        onClick={(event) => onAsk(file, event.currentTarget)}
      >
        Remove
      </Button>
      {failure && <Alert>{failure}</Alert>}
    </>
  )
}

// Asking before removing a file, and what comes of it.
function useRemoval(
  chatId: string,
  cardId: string | null,
  afterRemoval: () => HTMLElement | null,
) {
  const remove = useRemoveMessageFile(chatId, cardId)
  const [asking, setAsking] = useState<{
    file: FileInfo
    button: HTMLElement
  } | null>(null)
  // Set once the file is gone: its button no longer exists, so focus goes on
  // to the message.
  const removed = useRef(false)
  const [failures, setFailures] = useState<Record<string, string>>({})

  function confirm() {
    if (!asking) return
    const { file } = asking
    setFailures((all) =>
      Object.fromEntries(Object.entries(all).filter(([id]) => id !== file.id)),
    )
    remove.mutateAsync(file).then(
      () => {
        removed.current = true
        setAsking(null)
      },
      (error: unknown) => {
        const message = refusalOr(error, REMOVE_FAILED)
        setFailures((all) => ({ ...all, [file.id]: message }))
        setAsking(null)
      },
    )
  }

  return {
    asking,
    failures,
    pending: remove.isPending,
    returnFocusTo: () =>
      removed.current ? afterRemoval() : (asking?.button ?? null),
    ask: (file: FileInfo, button: HTMLElement) => {
      removed.current = false
      setAsking({ file, button })
    },
    cancel: () => setAsking(null),
    confirm,
  }
}
