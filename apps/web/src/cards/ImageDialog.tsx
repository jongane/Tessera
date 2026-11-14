import type { CardFile } from '@tessera/shared'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'

// An image file at full size, with a way to download it. Escape or Close
// brings back the card, with focus on the preview that was opened.
export function ImageDialog({
  file,
  onClose,
}: {
  file: CardFile
  onClose: () => void
}) {
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={file.name}
    >
      <img
        src={`/api/files/${file.id}/preview`}
        alt={file.name}
        className="max-h-[70vh] max-w-full self-center object-contain"
      />
      <div className="flex justify-end gap-2">
        <a
          href={`/api/files/${file.id}/download`}
          aria-label={`Download ${file.name}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 font-semibold text-accent hover:bg-subtle"
        >
          Download
        </a>
        <DialogClose asChild>
          <Button variant="secondary">Close</Button>
        </DialogClose>
      </div>
    </Dialog>
  )
}
