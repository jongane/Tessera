import {
  type Project,
  RELATION_COLOURS,
  type RelationColourName,
  RELATIONS,
} from '@tessera/shared'
import { useId } from 'react'
import { useChangeProject } from '../api/projects'
import {
  RELATION_COLOUR_NAMES,
  RELATION_LABELS,
  RELATION_OUTLINES,
} from '../boards/card-text'
import { Alert } from '../ui/Alert'
import { SettingsSection } from './ProjectSettingsPage'

// The colours that outline an open card and its relatives on the board
// (docs/card-features.md, section 7). Only admins change them, so everyone
// in the project sees the same ones; a change saves straight away.
export function RelationColoursSection({
  project,
  isAdmin,
}: {
  project: Project
  isAdmin: boolean
}) {
  const change = useChangeProject(project.id)
  return (
    <SettingsSection id="relation-colours-heading" title="Relationship colours">
      <p className="text-muted">
        When a card is open, it and its relatives are outlined in these colours
        on the board. Deeper subtasks in the same colour as direct ones are
        drawn paler.
      </p>
      {change.error && <Alert>{change.error.message}</Alert>}
      <ul className="flex flex-col gap-2">
        {RELATIONS.map((relation) => (
          <li key={relation} className="flex items-center gap-3">
            <Swatch colour={project.relationColours[relation]} />
            {isAdmin ? (
              <ColourChoice
                label={RELATION_LABELS[relation]}
                value={project.relationColours[relation]}
                disabled={change.isPending}
                onChange={(colour) =>
                  change.mutate({ relationColours: { [relation]: colour } })
                }
              />
            ) : (
              <span>
                <span className="font-semibold">
                  {RELATION_LABELS[relation]}
                </span>
                <span className="text-muted">
                  {RELATION_COLOUR_NAMES[project.relationColours[relation]]}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </SettingsSection>
  )
}

function Swatch({ colour }: { colour: RelationColourName }) {
  return (
    <span
      aria-hidden="true"
      className="size-5 shrink-0 rounded border-2"
      style={{ borderColor: RELATION_OUTLINES[colour].strong }}
    />
  )
}

function ColourChoice({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: RelationColourName
  disabled: boolean
  onChange: (colour: RelationColourName) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="w-32 font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as RelationColourName)}
        className="min-h-11 rounded-lg border border-line-strong bg-surface px-3"
      >
        {RELATION_COLOURS.map((colour) => (
          <option key={colour} value={colour}>
            {RELATION_COLOUR_NAMES[colour]}
          </option>
        ))}
      </select>
    </div>
  )
}
