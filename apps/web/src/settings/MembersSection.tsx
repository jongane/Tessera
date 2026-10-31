import {
  newMemberSchema,
  type Project,
  type ProjectMember,
  type ProjectRole,
} from '@tessera/shared'
import { type FormEvent, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { isApiError } from '../api/client'
import { useAddMember, useChangeRole, useRemoveMember } from '../api/members'
import { forgetProject } from '../boards/last-board'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { checkForm } from '../ui/form-errors'
import { TextField } from '../ui/TextField'
import { SettingsSection } from './ProjectSettingsPage'

const ROLE_NAMES: Record<ProjectRole, string> = {
  ADMIN: 'Admin',
  MEMBER: 'Member',
}

export const SELECT_CLASS =
  'min-h-11 rounded-lg border border-line-strong bg-surface px-3 disabled:opacity-60'

const LAST_ADMIN = 'A project needs at least one admin.'

// The project's members. Admins add people by email, change roles and
// remove people; everyone can leave. A project always keeps at least one
// admin, as the API does (docs/api.md, "Project members").
export function MembersSection({
  project,
  members,
  meId,
  isAdmin,
}: {
  project: Project
  members: ProjectMember[]
  meId: string
  isAdmin: boolean
}) {
  const changeRole = useChangeRole(project.id)
  const remove = useRemoveMember(project.id)
  const navigate = useNavigate()
  const [removing, setRemoving] = useState<ProjectMember | null>(null)
  const [leaving, setLeaving] = useState(false)
  const lastAdminHint = useId()
  const admins = members.filter((member) => member.role === 'ADMIN').length

  function isLastAdmin(member: ProjectMember) {
    return member.role === 'ADMIN' && admins === 1
  }

  function confirmRemove(member: ProjectMember) {
    remove.mutate(member.userId, { onSuccess: () => setRemoving(null) })
  }

  function confirmLeave() {
    remove.mutate(meId, {
      onSuccess: () => {
        forgetProject(project.code)
        navigate('/projects', { replace: true })
      },
    })
  }

  return (
    <SettingsSection id="members-heading" title="Members">
      {changeRole.error && <Alert>{changeRole.error.message}</Alert>}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
        {members.map((member) => {
          const nameId = `member-${member.userId}`
          const isMe = member.userId === meId
          const locked = isLastAdmin(member)
          // Explains the turned-off controls, to the people who see them.
          const showHint = locked && (isAdmin || isMe)
          const hintId = showHint
            ? `${lastAdminHint}-${member.userId}`
            : undefined
          return (
            <li
              key={member.userId}
              aria-labelledby={nameId}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p id={nameId} className="font-semibold">
                  {member.displayName}
                  {isMe && (
                    <span className="font-normal text-muted"> (you)</span>
                  )}
                </p>
                <p className="truncate text-muted">{member.email}</p>
                {showHint && (
                  <p id={hintId} className="text-muted">
                    {LAST_ADMIN}
                  </p>
                )}
              </div>
              {isAdmin ? (
                <select
                  aria-label={`Role for ${member.displayName}`}
                  aria-describedby={hintId}
                  className={SELECT_CLASS}
                  value={member.role}
                  disabled={locked || changeRole.isPending}
                  onChange={(event) =>
                    changeRole.mutate({
                      userId: member.userId,
                      role: event.target.value as ProjectRole,
                    })
                  }
                >
                  <option value="ADMIN">{ROLE_NAMES.ADMIN}</option>
                  <option value="MEMBER">{ROLE_NAMES.MEMBER}</option>
                </select>
              ) : (
                <span className="text-muted">{ROLE_NAMES[member.role]}</span>
              )}
              {isMe ? (
                <Button
                  variant="secondary"
                  disabled={locked}
                  aria-describedby={hintId}
                  onClick={() => {
                    remove.reset()
                    setLeaving(true)
                  }}
                >
                  Leave project
                </Button>
              ) : (
                isAdmin && (
                  <Button
                    variant="secondary"
                    aria-label={`Remove ${member.displayName}`}
                    disabled={locked}
                    onClick={() => {
                      remove.reset()
                      setRemoving(member)
                    }}
                  >
                    Remove
                  </Button>
                )
              )}
            </li>
          )
        })}
      </ul>
      {isAdmin && <AddMemberForm projectId={project.id} />}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.displayName} from ${project.name}?`}
          confirmLabel="Remove"
          onConfirm={() => confirmRemove(removing)}
          onCancel={() => setRemoving(null)}
          pending={remove.isPending}
          error={remove.error}
        >
          Their card assignments go, and a timer they have running in this
          project is stopped and its time saved.
        </ConfirmDialog>
      )}
      {leaving && (
        <ConfirmDialog
          title={`Leave ${project.name}?`}
          confirmLabel="Leave"
          onConfirm={confirmLeave}
          onCancel={() => setLeaving(false)}
          pending={remove.isPending}
          error={remove.error}
        >
          You’ll no longer see its boards and cards. A timer you have running in
          it is stopped and its time saved. An admin can add you again.
        </ConfirmDialog>
      )}
    </SettingsSection>
  )
}

// Adds someone who already has an account. Email invites come later
// (docs/web-app.md, section 1).
function AddMemberForm({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('MEMBER')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const addMember = useAddMember(projectId)
  const roleId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    const checked = checkForm(newMemberSchema, { email, role })
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    addMember.mutate(checked.data, {
      onSuccess: () => {
        setEmail('')
        setRole('MEMBER')
      },
    })
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Add member"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h3 className="font-semibold">Add member</h3>
      {addMember.error && (
        <Alert>
          {isApiError(addMember.error, 404)
            ? 'No one has an account with that email yet. Email invites come later.'
            : addMember.error.message}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          className="min-w-56 flex-1"
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleId} className="font-semibold">
            Role
          </label>
          <select
            id={roleId}
            className={SELECT_CLASS}
            value={role}
            onChange={(event) => setRole(event.target.value as ProjectRole)}
          >
            <option value="MEMBER">{ROLE_NAMES.MEMBER}</option>
            <option value="ADMIN">{ROLE_NAMES.ADMIN}</option>
          </select>
        </div>
        <Button type="submit" disabled={addMember.isPending}>
          Add
        </Button>
      </div>
    </form>
  )
}
