import type {
  BoardCard,
  BoardColumn,
  BoardView,
  Project,
  Thread,
} from '@tessera/shared'
import { type ReactNode, useEffect, useState } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Link, useParams, useSearchParams } from 'react-router'
import { type CardMove, useBoardView, useMoveCard } from '../api/boards'
import { isApiError } from '../api/client'
import { useBoards, useProjectByCode } from '../api/projects'
import { useThreads } from '../api/threads'
import { NotFoundPage } from '../app/NotFoundPage'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { BoardColumns } from './BoardColumns'
import { CompleteAnywayDialog } from './CompleteAnywayDialog'
import { rememberBoard } from './last-board'
import { findCard } from './move-card'
import { NewThreadDialog } from './NewThreadDialog'
import {
  type Dock,
  panelSizeStorage,
  savedDock,
  saveDock,
} from './panel-layout'
import { ThreadCard } from './ThreadCard'
import { ThreadPanel } from './ThreadPanel'

const SAVE_FAILED = 'Couldn’t save, try again'

// A board: the project's boards and the board's threads on the left, the
// columns in the middle, and the thread panel docked where the person put
// it (docs/web-app.md, section 3).
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
  useEffect(() => rememberBoard(project.code, boardId), [project.code, boardId])
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCardId = searchParams.get('card')
  const threads = useThreads(boardId)
  const openThread = threads.data?.find(
    (thread) => thread.id === searchParams.get('thread'),
  )
  const [creatingThread, setCreatingThread] = useState(false)
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

  // Selecting a card also opens its thread (until the card panel exists).
  function onSelect(card: BoardCard) {
    setSearchParams(
      card.threadId
        ? { card: card.id, thread: card.threadId }
        : { card: card.id },
    )
  }

  function openThreadOnly(thread: Thread) {
    setSearchParams({ thread: thread.id })
  }

  const board = (
    <div className="flex h-full min-w-0 flex-col">
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
  )

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <BoardSidebar
        project={project}
        boardId={boardId}
        threads={threads.data ?? []}
        openThreadId={openThread?.id}
        onNewThread={() => setCreatingThread(true)}
      />
      <div className="min-h-0 min-w-0 flex-1">
        {openThread ? (
          <WithThreadPanel
            board={board}
            panel={(dock, onDock) => (
              <ThreadPanel
                thread={openThread}
                cardPart={
                  <ThreadCard
                    view={view}
                    thread={openThread}
                    card={
                      openThread.cardId
                        ? findCard(view, openThread.cardId)?.card
                        : undefined
                    }
                    onOpenCard={onSelect}
                    onCardCreated={(cardId) =>
                      setSearchParams({ card: cardId, thread: openThread.id })
                    }
                  />
                }
                dock={dock}
                onDock={onDock}
                onClose={() => setSearchParams({})}
              />
            )}
          />
        ) : (
          board
        )}
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
      {creatingThread && (
        <NewThreadDialog
          boardId={boardId}
          onOpenChange={setCreatingThread}
          onCreated={(thread) => {
            setCreatingThread(false)
            openThreadOnly(thread)
          }}
        />
      )}
    </div>
  )
}

// The board with the thread panel docked on the right, left or bottom. The
// edge between them can be dragged, or moved with the arrow keys.
function WithThreadPanel({
  board,
  panel,
}: {
  board: ReactNode
  panel: (dock: Dock, onDock: (dock: Dock) => void) => ReactNode
}) {
  const [dock, setDock] = useState(savedDock)
  const sizes = useDefaultLayout({
    id: `tessera.threadPanel.${dock}`,
    panelIds: ['board', 'thread'],
    storage: panelSizeStorage,
  })

  function onDock(next: Dock) {
    saveDock(next)
    setDock(next)
  }

  const boardPanel = (
    <Panel key="board" id="board" minSize={280}>
      {board}
    </Panel>
  )
  const threadPanel = (
    <Panel key="thread" id="thread" defaultSize="30" minSize={240}>
      {panel(dock, onDock)}
    </Panel>
  )
  const edge = (
    <Separator
      key="edge"
      aria-label="Resize the thread panel"
      className={`bg-line hover:bg-accent focus-visible:bg-accent ${
        dock === 'bottom' ? 'h-1' : 'w-1'
      }`}
    />
  )
  return (
    <Group
      key={dock}
      orientation={dock === 'bottom' ? 'vertical' : 'horizontal'}
      defaultLayout={sizes.defaultLayout}
      onLayoutChanged={sizes.onLayoutChanged}
      className="h-full"
    >
      {dock === 'left'
        ? [threadPanel, edge, boardPanel]
        : [boardPanel, edge, threadPanel]}
    </Group>
  )
}

function BoardSidebar({
  project,
  boardId,
  threads,
  openThreadId,
  onNewThread,
}: {
  project: Project
  boardId: string
  threads: Thread[]
  openThreadId: string | undefined
  onNewThread: () => void
}) {
  const boards = useBoards(project.id)
  // A card's thread opens from its card, so only the others are listed.
  const listed = threads.filter(
    (thread) => thread.kind === 'GENERAL' || thread.cardId === null,
  )
  const linkClass =
    'rounded-md px-2 py-1.5 hover:bg-subtle aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent-strong'
  return (
    <aside
      aria-label="Boards and threads"
      className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface p-3 md:w-56 md:border-r md:border-b-0"
    >
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
            className={linkClass}
          >
            {board.name}
          </Link>
        ))}
      </nav>
      <nav aria-labelledby="sidebar-threads" className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="sidebar-threads"
            className="px-2 text-xs font-semibold text-muted uppercase"
          >
            Threads
          </h2>
          <Button
            variant="link"
            className="min-h-6 px-1 text-xs"
            onClick={onNewThread}
          >
            New thread
          </Button>
        </div>
        {listed.map((thread) => (
          <Link
            key={thread.id}
            to={{ search: `?thread=${thread.id}` }}
            aria-current={thread.id === openThreadId ? 'page' : undefined}
            className={linkClass}
          >
            {thread.title}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
