import { useState } from 'react'
import { Link } from 'react-router'
import { useProjects } from '../api/projects'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { NewProjectDialog } from './NewProjectDialog'

export function ProjectsPage() {
  const projects = useProjects()
  const [creating, setCreating] = useState(false)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Your projects</h1>
        {projects.data && projects.data.length > 0 && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </div>
      {projects.isPending && <Loading />}
      {projects.error && <Alert>{projects.error.message}</Alert>}
      {projects.data?.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong p-6">
          <p className="text-muted">
            A project holds your team’s boards, cards and chats.
          </p>
          <Button onClick={() => setCreating(true)}>
            Create your first project
          </Button>
        </div>
      )}
      {projects.data && projects.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {projects.data.map((project) => (
            <li key={project.id}>
              <Link
                to={`/${project.code}`}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 hover:border-accent"
              >
                <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">
                  {project.code}
                </span>
                <span className="font-semibold">{project.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewProjectDialog open onOpenChange={setCreating} />}
    </div>
  )
}
