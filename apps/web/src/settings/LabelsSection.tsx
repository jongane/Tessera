import {
  LABEL_COLOURS,
  type Label,
  type LabelColourName,
  labelChangesSchema,
  newLabelSchema,
} from '@tessera/shared'
import { type FormEvent, useId, useState } from 'react'
import {
  useChangeLabel,
  useCreateLabel,
  useDeleteLabel,
  useLabels,
} from '../api/labels'
import { LABEL_COLOUR_NAMES, LABEL_STYLES } from '../boards/card-text'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { checkForm } from '../ui/form-errors'
import { Loading } from '../ui/Loading'
import { TextField } from '../ui/TextField'
import { SettingsSection } from './ProjectSettingsPage'

// The project's labels (docs/card-features.md, section 8). Any member can
// add one; only admins can rename, recolour or delete.
export function LabelsSection({
  projectId,
  isAdmin,
}: {
  projectId: string
  isAdmin: boolean
}) {
  const labels = useLabels(projectId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Label | null>(null)

  return (
    <SettingsSection id="labels-heading" title="Labels">
      {labels.isPending && <Loading />}
      {labels.error && <Alert>{labels.error.message}</Alert>}
      {labels.data?.length === 0 && (
        <p className="text-muted">No labels yet.</p>
      )}
      {labels.data && labels.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {labels.data.map((label) => (
            <li key={label.id} className="px-4 py-3">
              {editingId === label.id ? (
                <EditLabelForm
                  projectId={projectId}
                  label={label}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <LabelChip label={label} />
                  {isAdmin && (
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="secondary"
                        aria-label={`Edit ${label.name}`}
                        onClick={() => setEditingId(label.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Delete ${label.name}`}
                        onClick={() => setDeleting(label)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <NewLabelForm projectId={projectId} />
      {deleting && (
        <DeleteLabelDialog
          projectId={projectId}
          label={deleting}
          onDone={() => setDeleting(null)}
        />
      )}
    </SettingsSection>
  )
}

function LabelChip({ label }: { label: Label }) {
  return (
    <span
      className={`rounded px-2 py-0.5 font-semibold ${LABEL_STYLES[label.colour]}`}
    >
      {label.name}
    </span>
  )
}

function NewLabelForm({ projectId }: { projectId: string }) {
  const [name, setName] = useState('')
  const [colour, setColour] = useState<LabelColourName>('GREY')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const createLabel = useCreateLabel(projectId)

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newLabelSchema, { name, colour })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    createLabel.mutate(checked.data, {
      onSuccess: () => {
        setName('')
        setColour('GREY')
      },
    })
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Add label"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      {createLabel.error && <Alert>{createLabel.error.message}</Alert>}
      <TextField
        label="New label"
        value={name}
        maxLength={50}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />
      <ColourPicker value={colour} onChange={setColour} />
      <div>
        <Button type="submit" disabled={createLabel.isPending}>
          Add label
        </Button>
      </div>
    </form>
  )
}

function EditLabelForm({
  projectId,
  label,
  onDone,
}: {
  projectId: string
  label: Label
  onDone: () => void
}) {
  const [name, setName] = useState(label.name)
  const [colour, setColour] = useState(label.colour)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const changeLabel = useChangeLabel(projectId, label.id)

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(labelChangesSchema, { name, colour })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    changeLabel.mutate(checked.data, { onSuccess: onDone })
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={`Edit ${label.name}`}
      className="flex flex-col gap-3"
    >
      {changeLabel.error && <Alert>{changeLabel.error.message}</Alert>}
      <TextField
        label="Name"
        value={name}
        maxLength={50}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />
      <ColourPicker value={colour} onChange={setColour} />
      <div className="flex gap-2">
        <Button type="submit" disabled={changeLabel.isPending}>
          Save
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// The 10 fixed colours, as radio buttons showing each colour.
function ColourPicker({
  value,
  onChange,
}: {
  value: LabelColourName
  onChange: (colour: LabelColourName) => void
}) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-semibold">Colour</legend>
      <div className="flex flex-wrap gap-2">
        {LABEL_COLOURS.map((colour) => (
          <label
            key={colour}
            className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 font-semibold has-checked:ring-2 has-checked:ring-accent has-focus-visible:outline-2 ${LABEL_STYLES[colour]}`}
          >
            <input
              type="radio"
              name={name}
              value={colour}
              checked={value === colour}
              onChange={() => onChange(colour)}
              className="accent-current"
            />
            {LABEL_COLOUR_NAMES[colour]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function DeleteLabelDialog({
  projectId,
  label,
  onDone,
}: {
  projectId: string
  label: Label
  onDone: () => void
}) {
  const deleteLabel = useDeleteLabel(projectId, label.id)
  return (
    <ConfirmDialog
      title={`Delete the label ${label.name}?`}
      confirmLabel="Delete"
      onConfirm={() => deleteLabel.mutate(undefined, { onSuccess: onDone })}
      onCancel={onDone}
      pending={deleteLabel.isPending}
      error={deleteLabel.error}
    >
      It comes off every card that has it.
    </ConfirmDialog>
  )
}
