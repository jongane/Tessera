import { newProjectSchema } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateProject, useSuggestedCode } from '../api/projects'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  // The code the person typed. Until they type one, the code suggested
  // from the name is used.
  const [typedCode, setTypedCode] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const suggestion = useSuggestedCode(typedCode === null ? name : '')
  const suggested = name.trim() ? suggestion.data?.code : undefined
  const code = typedCode ?? suggested ?? ''
  const createProject = useCreateProject()
  const navigate = useNavigate()

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newProjectSchema, { name, code })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    createProject.mutate(checked.data, {
      onSuccess: (project) => navigate(`/${project.code}`),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New project">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {createProject.error && <Alert>{createProject.error.message}</Alert>}
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
        />
        <TextField
          label="Code"
          value={code}
          onChange={(event) => setTypedCode(event.target.value.toUpperCase())}
          // Leaving the field empty brings the suggestion back.
          onBlur={() => {
            if (typedCode === '') {
              setTypedCode(null)
            }
          }}
          error={errors.code}
          hint="2 to 6 letters. Card numbers start with it, like WEB-12."
          maxLength={6}
        />
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" disabled={createProject.isPending}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
