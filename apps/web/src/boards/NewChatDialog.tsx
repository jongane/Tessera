import { newChatSchema, type Chat } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { useCreateChat } from '../api/chats'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'

// A chat of its own, not linked to a card.
export function NewChatDialog({
  boardId,
  onCreated,
  onOpenChange,
}: {
  boardId: string
  onCreated: (chat: Chat) => void
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string>()
  const createChat = useCreateChat(boardId)

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newChatSchema, { title })
    if (!checked.ok) {
      setError(checked.errors.title)
      return
    }
    setError(undefined)
    createChat.mutate(checked.data, { onSuccess: onCreated })
  }

  return (
    <Dialog open onOpenChange={onOpenChange} title="New chat">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {createChat.error && <Alert>{createChat.error.message}</Alert>}
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
          <Button type="submit" disabled={createChat.isPending}>
            Start
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
