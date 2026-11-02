import * as Tabs from '@radix-ui/react-tabs'
import { type ReactNode, useState, useSyncExternalStore } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import {
  type Dock,
  panelSizeStorage,
  savedDock,
  saveDock,
} from './panel-layout'

// Where the board, the card panel and the chat panel sit (docs/web-app.md,
// section 3). The card panel is on the right of the board; the chat panel
// is docked where the person put it. Each edge between them can be dragged,
// or moved with the arrow keys. On a phone the board comes first, and the
// two panels below it become tabs.
export function BoardLayout({
  board,
  card,
  chat,
}: {
  board: ReactNode
  card: ReactNode | null
  chat: ((dock: Dock, onDock: (dock: Dock) => void) => ReactNode) | null
}) {
  const [dock, setDock] = useState(savedDock)
  const narrow = useNarrowScreen()

  function onDock(next: Dock) {
    saveDock(next)
    setDock(next)
  }

  const chatPanel = chat ? chat(dock, onDock) : null
  if (!card && !chatPanel) {
    return board
  }
  if (narrow) {
    return <StackedPanels board={board} card={card} chat={chatPanel} />
  }
  return (
    <SidePanels
      // Each arrangement remembers its own sizes.
      key={`${dock}-${card ? 'card' : ''}-${chatPanel ? 'chat' : ''}`}
      dock={dock}
      board={board}
      card={card}
      chat={chatPanel}
    />
  )
}

function SidePanels({
  dock,
  board,
  card,
  chat,
}: {
  dock: Dock
  board: ReactNode
  card: ReactNode | null
  chat: ReactNode | null
}) {
  const boardPanel = (
    <Panel key="board" id="board" minSize={280}>
      {board}
    </Panel>
  )
  const cardPanel = card && (
    <Panel key="card" id="card" defaultSize="35" minSize={300}>
      {card}
    </Panel>
  )
  const chatPanel = chat && (
    <Panel key="chat" id="chat" defaultSize="30" minSize={240}>
      {chat}
    </Panel>
  )
  const cardEdge = card && (
    <Edge key="card-edge" label="Resize the card panel" across={false} />
  )
  const chatEdge = chat && (
    <Edge
      key="chat-edge"
      label="Resize the chat panel"
      across={dock === 'bottom'}
    />
  )

  if (!chat) {
    return (
      <Row id="tessera.cardPanel" panelIds={['board', 'card']}>
        {[boardPanel, cardEdge, cardPanel]}
      </Row>
    )
  }
  if (!card) {
    // The same key as before the card panel, so sizes already remembered
    // are kept.
    return (
      <Row
        id={`tessera.chatPanel.${dock}`}
        panelIds={['board', 'chat']}
        vertical={dock === 'bottom'}
      >
        {dock === 'left'
          ? [chatPanel, chatEdge, boardPanel]
          : [boardPanel, chatEdge, chatPanel]}
      </Row>
    )
  }
  if (dock === 'bottom') {
    return (
      <Row id="tessera.panels.bottom" panelIds={['main', 'chat']} vertical>
        <Panel key="main" id="main" minSize={200}>
          <Row id="tessera.cardPanel" panelIds={['board', 'card']}>
            {[boardPanel, cardEdge, cardPanel]}
          </Row>
        </Panel>
        {chatEdge}
        {chatPanel}
      </Row>
    )
  }
  return (
    <Row
      id={`tessera.panels.${dock}`}
      panelIds={
        dock === 'left' ? ['chat', 'board', 'card'] : ['board', 'card', 'chat']
      }
    >
      {dock === 'left'
        ? [chatPanel, chatEdge, boardPanel, cardEdge, cardPanel]
        : [boardPanel, cardEdge, cardPanel, chatEdge, chatPanel]}
    </Row>
  )
}

// A group of panels side by side (or one above the other), whose sizes are
// remembered under `id`.
function Row({
  id,
  panelIds,
  vertical = false,
  children,
}: {
  id: string
  panelIds: string[]
  vertical?: boolean
  children: ReactNode
}) {
  const sizes = useDefaultLayout({ id, panelIds, storage: panelSizeStorage })
  return (
    <Group
      orientation={vertical ? 'vertical' : 'horizontal'}
      defaultLayout={sizes.defaultLayout}
      onLayoutChanged={sizes.onLayoutChanged}
      className="h-full"
    >
      {children}
    </Group>
  )
}

function Edge({ label, across }: { label: string; across: boolean }) {
  return (
    <Separator
      aria-label={label}
      className={`bg-line hover:bg-accent focus-visible:bg-accent ${
        across ? 'h-1' : 'w-1'
      }`}
    />
  )
}

function StackedPanels({
  board,
  card,
  chat,
}: {
  board: ReactNode
  card: ReactNode | null
  chat: ReactNode | null
}) {
  const [tab, setTab] = useState<'card' | 'chat'>('card')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">{board}</div>
      <div className="flex max-h-[70%] min-h-0 flex-1 flex-col border-t border-line">
        {card && chat ? (
          <Tabs.Root
            value={tab}
            onValueChange={(value) => setTab(value as 'card' | 'chat')}
            className="flex min-h-0 flex-1 flex-col"
          >
            <Tabs.List
              aria-label="Panels"
              className="flex gap-1 border-b border-line bg-surface px-2"
            >
              <Tabs.Trigger value="card" className={tabClass}>
                Card
              </Tabs.Trigger>
              <Tabs.Trigger value="chat" className={tabClass}>
                Chat
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="card" className="min-h-0 flex-1">
              {card}
            </Tabs.Content>
            <Tabs.Content value="chat" className="min-h-0 flex-1">
              {chat}
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          (card ?? chat)
        )}
      </div>
    </div>
  )
}

const tabClass =
  'min-h-11 px-3 font-semibold text-muted aria-selected:border-b-2 aria-selected:border-accent aria-selected:text-ink'

// Phone-sized screens, as Tailwind's `md` breakpoint draws the line.
const NARROW = '(max-width: 767px)'

function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia?.(NARROW)
      query?.addEventListener('change', onChange)
      return () => query?.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(NARROW).matches ?? false,
  )
}
