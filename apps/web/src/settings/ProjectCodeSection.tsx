import type { Project } from '@tessera/shared'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useChangeProject } from '../api/projects'
import { renameProject } from '../boards/last-board'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Dialog, DialogClose } from '../ui/Dialog'
import { TextField } from '../ui/TextField'
import { SettingsSection } from './ProjectSettingsPage'

// The capitals that start card numbers. Old codes keep working, so links
// to WEB-12 still lead to the card after a change.
export function ProjectCodeSection({
  project,
  isAdmin,
}: {
  project: Project
  isAdmin: boolean
}) {
  const [changing, setChanging] = useState(false)
  return (
    <SettingsSection id="code-heading" title="Project code">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-accent-soft px-2 py-0.5 font-semibold text-accent-strong">
          {project.code}
        </span>
        <p className="text-muted">
          Card numbers start with it, like {project.code}-12.
        </p>
        {isAdmin && (
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => setChanging(true)}
          >
            Change code
          </Button>
        )}
      </div>
      {changing && (
        <ChangeCodeDialog project={project} onOpenChange={setChanging} />
      )}
    </SettingsSection>
  )
}

function ChangeCodeDialog({
  project,
  onOpenChange,
}: {
  project: Project
  onOpenChange: (open: boolean) => void
}) {
  const [code, setCode] = useState(project.code)
  const changeProject = useChangeProject(project.id)
  const navigate = useNavigate()

  // The API checks the code (2 to 6 letters, not in use) and explains
  // what is wrong.
  function submit(event: FormEvent) {
    event.preventDefault()
    changeProject.mutate(
      { code: code.trim() },
      {
        onSuccess: (changed) => {
          renameProject(project.code, changed.code)
          // Closed here: the page may not reload if the new code is cached.
          onOpenChange(false)
          navigate(`/${changed.code}/settings`, { replace: true })
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange} title="Change the project code?">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {changeProject.error && <Alert>{changeProject.error.message}</Alert>}
        <p>
          Every card number starts with the new code from now on. Old numbers
          like {project.code}-12 keep working, and lead to the same cards.
        </p>
        <TextField
          label="New code"
          value={code}
          maxLength={6}
          autoComplete="off"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          hint="2 to 6 letters, A to Z."
        />
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" disabled={changeProject.isPending}>
            Change code
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
