import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { isApiError } from '../api/client'
import { useBoards, useProjectByCode } from '../api/projects'
import { NotFoundPage } from '../app/NotFoundPage'
import { lastBoardIn } from '../boards/last-board'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { NewBoardDialog } from './NewBoardDialog'

// A project's boards. Opens the last board used in it instead, when this
// browser remembers one that still exists (docs/web-app.md, section 2).
export function ProjectPage() {
  const { code = '' } = useParams()
  const project = useProjectByCode(code)
  const boards = useBoards(project.data?.id)
  const [creating, setCreating] = useState(false)

  if (project.isPending) {
    return <Loading />
  }
  if (isApiError(project.error, 404)) {
    return (
      <NotFoundPage
        title="Project not found"
        text="There’s no project with that code, or you’re not a member of it."
      />
    )
  }
  if (project.error) {
    return (
      <div className="p-6">
        <Alert>{project.error.message}</Alert>
      </div>
    )
  }

  const { data } = project
  const lastBoard = lastBoardIn(data.code)
  if (lastBoard && boards.data?.some((board) => board.id === lastBoard)) {
    return <Navigate to={`/${data.code}/boards/${lastBoard}`} replace />
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-muted">
        <Link to="/projects" className="hover:text-ink">
          Your projects
        </Link>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{data.name}</h1>
        <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">
          {data.code}
        </span>
        {boards.data && boards.data.length > 0 && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            New board
          </Button>
        )}
      </div>
      {data.description && <p className="text-muted">{data.description}</p>}
      {boards.isPending && <Loading />}
      {boards.error && <Alert>{boards.error.message}</Alert>}
      {boards.data?.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong p-6">
          <p className="text-muted">
            A board holds columns of cards and the chats about them.
          </p>
          <Button onClick={() => setCreating(true)}>
            Create your first board
          </Button>
        </div>
      )}
      {boards.data && boards.data.length > 0 && (
        <section
          aria-labelledby="boards-heading"
          className="flex flex-col gap-2"
        >
          <h2
            id="boards-heading"
            className="text-sm font-semibold text-muted uppercase"
          >
            Boards
          </h2>
          <ul className="flex flex-col gap-2">
            {boards.data.map((board) => (
              <li key={board.id}>
                <Link
                  to={`/${data.code}/boards/${board.id}`}
                  className="block rounded-lg border border-line bg-surface px-4 py-3 font-semibold hover:border-accent"
                >
                  {board.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {creating && (
        <NewBoardDialog
          projectId={data.id}
          projectCode={data.code}
          onOpenChange={setCreating}
        />
      )}
    </div>
  )
}
