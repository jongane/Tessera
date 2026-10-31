import type { ReactNode } from 'react'
import { Alert } from './Alert'
import { Button } from './Button'
import { Dialog, DialogClose } from './Dialog'

// "Are you sure?" before something that can't be undone. Stays open while
// the change is saved, and shows why it failed.
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
  error,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  pending?: boolean
  error?: Error | null
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()} title={title}>
      {error && <Alert>{error.message}</Alert>}
      <div>{children}</div>
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button onClick={onConfirm} disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
