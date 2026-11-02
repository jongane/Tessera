import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useMe } from '../api/auth'
import { isApiError } from '../api/client'
import { useMembers } from '../api/members'
import { useProjectByCode } from '../api/projects'
import { NotFoundPage } from '../app/NotFoundPage'
import { Alert } from '../ui/Alert'
import { Loading } from '../ui/Loading'
import { LabelsSection } from './LabelsSection'
import { MembersSection } from './MembersSection'
import { ProjectCodeSection } from './ProjectCodeSection'
import { RelationColoursSection } from './RelationColoursSection'
import { TimeZoneSection } from './TimeZoneSection'

// /WEB/settings (docs/web-app.md, sections 1 and 2). Every member can open
// it. Only project admins can change members, the code, the time zone and
// the relationship colours, and rename, recolour or delete labels; anyone
// can add a label or leave.
export function ProjectSettingsPage() {
  const { code = '' } = useParams()
  const me = useMe()
  const project = useProjectByCode(code)
  const members = useMembers(project.data?.id)

  if (project.error) {
    return isApiError(project.error, 404) ? (
      <ProjectNotFound />
    ) : (
      <Problem error={project.error} />
    )
  }
  if (members.error) {
    return <Problem error={members.error} />
  }
  if (project.isPending || members.isPending || !me.data) {
    return <Loading />
  }

  const { data } = project
  const meId = me.data.id
  const isAdmin = members.data.some(
    (member) => member.userId === meId && member.role === 'ADMIN',
  )
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <nav aria-label="Breadcrumb" className="text-muted">
          <Link to={`/${data.code}`} className="hover:text-ink">
            {data.name}
          </Link>
        </nav>
        <h1 className="text-2xl font-bold">Project settings</h1>
      </div>
      <MembersSection
        project={data}
        members={members.data}
        meId={meId}
        isAdmin={isAdmin}
      />
      <LabelsSection projectId={data.id} isAdmin={isAdmin} />
      <ProjectCodeSection project={data} isAdmin={isAdmin} />
      <TimeZoneSection project={data} isAdmin={isAdmin} />
      <RelationColoursSection project={data} isAdmin={isAdmin} />
    </div>
  )
}

// One part of a settings page, named by its heading.
export function SettingsSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ProjectNotFound() {
  return (
    <NotFoundPage
      title="Project not found"
      text="There’s no project with that code, or you’re not a member of it."
    />
  )
}

function Problem({ error }: { error: Error }) {
  return (
    <div className="p-6">
      <Alert>{error.message}</Alert>
    </div>
  )
}
