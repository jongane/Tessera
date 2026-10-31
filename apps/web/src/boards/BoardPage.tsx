import type {
  BoardCard,
  BoardColumn,
  BoardView,
  Project,
  Chat,
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
import { useChats } from '../api/chats'
import { NotFoundPage } from '../app/NotFoundPage'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { BoardColumns } from './BoardColumns'
import { CompleteAnywayDialog } from './CompleteAnywayDialog'
import { forgetBoard, rememberBoard } from './last-board'
import { findCard } from './move-card'
import { NewChatDialog } from './NewChatDialog'
import {
  type Dock,
  panelSizeStorage,
  savedDock,
  saveDock,
} from './panel-layout'
import { ChatCard } from './ChatCard'
import { ChatPanel } from './ChatPanel'

const SAVE_FAILED = 'Couldn’t save, try again'

// A board: the project's boards and the board's chats on the left, the
// columns in the middle, and the chat panel docked where the person put
// it (docs/web-app.md, section 3).
export function BoardPage() {
  const { code = '', boardId = '' } = useParams()
  const project = useProjectByCode(code)
  const board = useBoardView(boardId)

  if (project.isPending || board.isPending) {
    return <Loading />
  }
  const notFound =
    isApiError(project.error, 404) ||
    isApiError(board.error, 404) ||
    // A board from another project, under this project's code.
    (project.data && board.data && board.data.projectId !== project.data.id)
  if (notFound) {
    return <BoardNotFound code={code} boardId={boardId} />
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

// The home page does not open this board again.
function BoardNotFound({ code, boardId }: { code: string; boardId: string }) {
  useEffect(() => forgetBoard(code, boardId), [code, boardId])
  return (
    <NotFoundPage
      title="Board not found"
      text="There’s no board at this address, or you’re not a member of its project."
    />
  )
}

function BoardScreen({ project, view }: { project: Project; view: BoardView }) {
  const boardId = view.id
  useEffect(() => rememberBoard(project.code, boardId), [project.code, boardId])
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCardId = searchParams.get('card')
  const chats = useChats(boardId)
  const openChat = chats.data?.find(
    (chat) => chat.id === searchParams.get('chat'),
  )
  const [creatingChat, setCreatingChat] = useState(false)
  const moveCard = useMoveCard(boardId)
  const [saveFailed, setSaveFailed] = useState(false)
  const [confirming, setConfirming] = useState<{
    move: CardMove
    openSubtasks: number
  } | null>(null)

  function send(move: CardMove) {
    setSaveFailed(false)
    // Each move's own promise: options given to mutate() only reach the
    // latest call, so an earlier move that fails would go unnoticed.
    moveCard.mutateAsync(move).catch(() => setSaveFailed(true))
  }

  // An open card going into a done column with open subtasks asks first:
  // the move completes it (docs/web-app.md, section 4). The API checks the
  // same way.
  function onMove(card: BoardCard, column: BoardColumn, position: number) {
    const open = card.subtaskProgress.total - card.subtaskProgress.complete
    const move = { cardId: card.id, columnId: column.id, position }
    if (column.isDone && !card.isComplete && open > 0) {
      setConfirming({ move, openSubtasks: open })
    } else {
      send(move)
    }
  }

  // Selecting a card also opens its chat (until the card panel exists).
  function onSelect(card: BoardCard) {
    setSearchParams(
      card.chatId ? { card: card.id, chat: card.chatId } : { card: card.id },
    )
  }

  function openChatOnly(chat: Chat) {
    setSearchParams({ chat: chat.id })
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
        chats={chats.data ?? []}
        openChatId={openChat?.id}
        onNewChat={() => setCreatingChat(true)}
      />
      <div className="min-h-0 min-w-0 flex-1">
        {openChat ? (
          <WithChatPanel
            board={board}
            panel={(dock, onDock) => (
              <ChatPanel
                key={openChat.id}
                chat={openChat}
                cardPart={
                  <ChatCard
                    view={view}
                    chat={openChat}
                    card={
                      openChat.cardId
                        ? findCard(view, openChat.cardId)?.card
                        : undefined
                    }
                    onOpenCard={onSelect}
                    onCardCreated={(cardId) =>
                      setSearchParams({ card: cardId, chat: openChat.id })
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
      {creatingChat && (
        <NewChatDialog
          boardId={boardId}
          onOpenChange={setCreatingChat}
          onCreated={(chat) => {
            setCreatingChat(false)
            openChatOnly(chat)
          }}
        />
      )}
    </div>
  )
}

// The board with the chat panel docked on the right, left or bottom. The
// edge between them can be dragged, or moved with the arrow keys.
function WithChatPanel({
  board,
  panel,
}: {
  board: ReactNode
  panel: (dock: Dock, onDock: (dock: Dock) => void) => ReactNode
}) {
  const [dock, setDock] = useState(savedDock)
  const sizes = useDefaultLayout({
    id: `tessera.chatPanel.${dock}`,
    panelIds: ['board', 'chat'],
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
  const chatPanel = (
    <Panel key="chat" id="chat" defaultSize="30" minSize={240}>
      {panel(dock, onDock)}
    </Panel>
  )
  const edge = (
    <Separator
      key="edge"
      aria-label="Resize the chat panel"
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
        ? [chatPanel, edge, boardPanel]
        : [boardPanel, edge, chatPanel]}
    </Group>
  )
}

function BoardSidebar({
  project,
  boardId,
  chats,
  openChatId,
  onNewChat,
}: {
  project: Project
  boardId: string
  chats: Chat[]
  openChatId: string | undefined
  onNewChat: () => void
}) {
  const boards = useBoards(project.id)
  // A card's chat opens from its card, so only the others are listed.
  const listed = chats.filter(
    (chat) => chat.kind === 'GENERAL' || chat.cardId === null,
  )
  const linkClass =
    'rounded-md px-2 py-1.5 hover:bg-subtle aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent-strong'
  return (
    <aside
      aria-label="Boards and chats"
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
      <nav aria-labelledby="sidebar-chats" className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="sidebar-chats"
            className="px-2 text-xs font-semibold text-muted uppercase"
          >
            Chats
          </h2>
          <Button
            variant="link"
            className="min-h-6 px-1 text-xs"
            onClick={onNewChat}
          >
            New chat
          </Button>
        </div>
        {listed.map((chat) => (
          <Link
            key={chat.id}
            to={{ search: `?chat=${chat.id}` }}
            aria-current={chat.id === openChatId ? 'true' : undefined}
            className={linkClass}
          >
            {chat.title}
          </Link>
        ))}
      </nav>
      <Link
        to={`/${project.code}/settings`}
        className={`${linkClass} md:mt-auto`}
      >
        Project settings
      </Link>
    </aside>
  )
}
