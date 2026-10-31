import type {
  BoardCard,
  BoardColumn,
  BoardView,
  Project,
} from '@tessera/shared'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { type CardMove, useBoardView, useMoveCard } from '../api/boards'
import { isApiError } from '../api/client'
import { useBoards, useProjectByCode } from '../api/projects'
import { NotFoundPage } from '../app/NotFoundPage'
import { Alert } from '../ui/Alert'
import { Loading } from '../ui/Loading'
import { BoardColumns } from './BoardColumns'
import { CompleteAnywayDialog } from './CompleteAnywayDialog'
import { findCard } from './move-card'

const SAVE_FAILED = 'Couldn’t save, try again'

// A board: the project's boards on the left, the columns in the middle
// (docs/web-app.md, section 3).
export function BoardPage() {
  const { code = '', boardId = '' } = useParams()
  const project = useProjectByCode(code)
  const board = useBoardView(boardId)

  if (project.isPending || board.isPending) {
    return <Loading />
  }
  if (isApiError(project.error, 404) || isApiError(board.error, 404)) {
    return (
      <NotFoundPage
        title="Board not found"
        text="There’s no board at this address, or you’re not a member of its project."
      />
    )
  }
  if (!project.data || !board.data) {
    return (
      <div className="p-6">
        <Alert>{(project.error ?? board.error)?.message}</Alert>
      </div>
    )
  }
  return <BoardScreen project={project.data} view={board.data} />
}

function BoardScreen({ project, view }: { project: Project; view: BoardView }) {
  const boardId = view.id
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCardId = searchParams.get('card')
  const moveCard = useMoveCard(boardId)
  const [saveFailed, setSaveFailed] = useState(false)
  const [confirming, setConfirming] = useState<{
    move: CardMove
    openSubtasks: number
  } | null>(null)

  function send(move: CardMove) {
    setSaveFailed(false)
    moveCard.mutate(move, { onError: () => setSaveFailed(true) })
  }

  // Into a done column with open subtasks asks first: the move completes
  // the card (docs/web-app.md, section 4).
  function onMove(card: BoardCard, column: BoardColumn, position: number) {
    const from = findCard(view, card.id)?.column
    const open = card.subtaskProgress.total - card.subtaskProgress.complete
    const move = { cardId: card.id, columnId: column.id, position }
    if (column.isDone && !from?.isDone && open > 0) {
      setConfirming({ move, openSubtasks: open })
    } else {
      send(move)
    }
  }

  function onSelect(card: BoardCard) {
    setSearchParams({ card: card.id })
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <BoardSidebar project={project} boardId={boardId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-1 px-4 pt-4">
          <nav aria-label="Breadcrumb" className="text-muted">
            <Link to={`/${project.code}`} className="hover:text-ink">
              {project.name}
            </Link>
          </nav>
          <h1 className="text-2xl font-bold">{view.name}</h1>
          {saveFailed && <Alert>{SAVE_FAILED}</Alert>}
        </div>
        <BoardColumns
          view={view}
          timeZone={project.timeZone}
          selectedCardId={selectedCardId}
          onSelect={onSelect}
          onMove={onMove}
        />
      </div>
      {confirming && (
        <CompleteAnywayDialog
          openSubtasks={confirming.openSubtasks}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            send({ ...confirming.move, confirmOpenSubtasks: true })
            setConfirming(null)
          }}
        />
      )}
    </div>
  )
}

function BoardSidebar({
  project,
  boardId,
}: {
  project: Project
  boardId: string
}) {
  const boards = useBoards(project.id)
  return (
    <aside className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface p-3 md:w-56 md:border-r md:border-b-0">
      <nav aria-labelledby="sidebar-boards" className="flex flex-col gap-1">
        <h2
          id="sidebar-boards"
          className="px-2 text-xs font-semibold text-muted uppercase"
        >
          Boards
        </h2>
        {boards.data?.map((board) => (
          <Link
            key={board.id}
            to={`/${project.code}/boards/${board.id}`}
            aria-current={board.id === boardId ? 'page' : undefined}
            className="rounded-md px-2 py-1.5 hover:bg-subtle aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent-strong"
          >
            {board.name}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
