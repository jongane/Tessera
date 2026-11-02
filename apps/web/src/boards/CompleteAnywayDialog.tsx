import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'

// Asked before a card with open subtasks is completed, by moving it into a
// done column or by ticking it (docs/card-features.md, section 4).
export function CompleteAnywayDialog({
  openSubtasks,
  byMoving = true,
  onConfirm,
  onCancel,
}: {
  openSubtasks: number
  byMoving?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const what =
    openSubtasks === 1
      ? '1 subtask is still open.'
      : `${openSubtasks} subtasks are still open.`
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title="Complete anyway?"
    >
      <p>
        {what}
        {byMoving && ' Moving the card into a done column completes it.'}
      </p>
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button onClick={onConfirm}>Complete anyway</Button>
      </div>
    </Dialog>
  )
}
