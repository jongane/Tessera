import { newCardSchema } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { useCreateCard } from '../api/boards'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'

// "Add a card" at the bottom of a column. The new card goes at the bottom.
export function AddCardForm({
  boardId,
  columnId,
}: {
  boardId: string
  columnId: string
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string>()
  const createCard = useCreateCard(boardId)

  if (!open) {
    return (
      <Button
        variant="secondary"
        className="w-full justify-start border-dashed text-muted"
        onClick={() => setOpen(true)}
      >
        Add a card
      </Button>
    )
  }

  function close() {
    setOpen(false)
    setTitle('')
    setError(undefined)
    createCard.reset()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newCardSchema, { title })
    if (!checked.ok) {
      setError(checked.errors.title)
      return
    }
    setError(undefined)
    createCard.mutate(
      { ...checked.data, columnId },
      // Stay open, so several cards can be added one after another.
      { onSuccess: () => setTitle('') },
    )
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => event.key === 'Escape' && close()}
      className="flex flex-col gap-2 rounded-lg bg-surface p-2"
    >
      {createCard.error && <Alert>{createCard.error.message}</Alert>}
      <TextField
        label="Card title"
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={error}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={createCard.isPending}>
          Add
        </Button>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
