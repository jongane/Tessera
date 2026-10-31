import { newThreadSchema, type Thread } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { useCreateThread } from '../api/threads'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'

// A thread of its own, not linked to a card.
export function NewThreadDialog({
  boardId,
  onCreated,
  onOpenChange,
}: {
  boardId: string
  onCreated: (thread: Thread) => void
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string>()
  const createThread = useCreateThread(boardId)

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newThreadSchema, { title })
    if (!checked.ok) {
      setError(checked.errors.title)
      return
    }
    setError(undefined)
    createThread.mutate(checked.data, { onSuccess: onCreated })
  }

  return (
    <Dialog open onOpenChange={onOpenChange} title="New thread">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {createThread.error && <Alert>{createThread.error.message}</Alert>}
        <TextField
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={error}
        />
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" disabled={createThread.isPending}>
            Start
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
