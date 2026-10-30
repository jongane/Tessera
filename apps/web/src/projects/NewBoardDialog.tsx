import { newBoardSchema } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateBoard } from '../api/projects'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'

export function NewBoardDialog({
  projectId,
  projectCode,
  onOpenChange,
}: {
  projectId: string
  projectCode: string
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const createBoard = useCreateBoard(projectId)
  const navigate = useNavigate()

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newBoardSchema, { name })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    createBoard.mutate(checked.data, {
      onSuccess: (board) => navigate(`/${projectCode}/boards/${board.id}`),
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange} title="New board">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {createBoard.error && <Alert>{createBoard.error.message}</Alert>}
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          hint="It starts with the columns To do, In progress and Done, and a general thread."
        />
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" disabled={createBoard.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
