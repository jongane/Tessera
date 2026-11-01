import { projectChangesSchema, type Project } from '@tessera/shared'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { useChangeProject } from '../api/projects'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'
import { SettingsSection } from './ProjectSettingsPage'

// Every time zone this browser knows. New projects start in UTC, which
// some browsers leave out of the list.
function timeZones(): string[] {
  const zones = Intl.supportedValuesOf('timeZone')
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

// "21:30", the time now in `timeZone`.
function timeNowIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeStyle: 'short',
  }).format(new Date())
}

// The project's time zone decides which day time is logged on, so everyone
// in the project sees the same days. Only admins change it.
export function TimeZoneSection({
  project,
  isAdmin,
}: {
  project: Project
  isAdmin: boolean
}) {
  const now = `It’s ${timeNowIn(project.timeZone)} there now.`
  return (
    <SettingsSection id="time-zone-heading" title="Time zone">
      <p className="text-muted">
        Due times and logged time are shown in the project’s time zone, so
        everyone in the project sees the same days.
      </p>
      {isAdmin ? (
        <TimeZoneForm project={project} now={now} />
      ) : (
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="font-semibold">{project.timeZone}</p>
          <p className="text-muted">{now}</p>
        </div>
      )}
    </SettingsSection>
  )
}

function TimeZoneForm({ project, now }: { project: Project; now: string }) {
  const [timeZone, setTimeZone] = useState(project.timeZone)
  const [error, setError] = useState<string>()
  const changeProject = useChangeProject(project.id)
  const listId = useId()
  const zones = useMemo(() => timeZones(), [])

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(projectChangesSchema, { timeZone })
    if (!checked.ok) {
      setError(checked.errors.timeZone)
      return
    }
    setError(undefined)
    changeProject.mutate(checked.data)
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Change time zone"
      className="flex flex-col gap-3"
    >
      {changeProject.error && <Alert>{changeProject.error.message}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          className="min-w-64 flex-1"
          label="Time zone"
          list={listId}
          autoComplete="off"
          value={timeZone}
          onChange={(event) => {
            changeProject.reset()
            setTimeZone(event.target.value)
          }}
          error={error}
          hint={`Type to search, e.g. Europe/London. Saved: ${project.timeZone}. ${now}`}
        />
        <Button type="submit" disabled={changeProject.isPending}>
          Save
        </Button>
      </div>
      {changeProject.isSuccess && (
        <p role="status" className="text-muted">
          Time zone saved.
        </p>
      )}
      <datalist id={listId}>
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </form>
  )
}
