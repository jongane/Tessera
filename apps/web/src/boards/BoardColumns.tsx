import type { BoardCard, BoardColumn, BoardView } from '@tessera/shared'
import {
  type Announcements,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useMemo, useState } from 'react'
import { AddCardForm } from './AddCardForm'
import { CardTile, DraggedCard } from './CardTile'

// Card ids in each column, from the top, while a card is being dragged.
type Layout = Record<string, string[]>

interface BoardColumnsProps {
  view: BoardView
  timeZone: string
  selectedCardId: string | null
  onSelect: (card: BoardCard) => void
  onMove: (card: BoardCard, column: BoardColumn, position: number) => void
}

// The board's columns, side by side. Cards can be dragged within a column
// and into another one, with a pointer, by touch or with the keyboard
// (docs/web-app.md, section 4).
export function BoardColumns({
  view,
  timeZone,
  selectedCardId,
  onSelect,
  onMove,
}: BoardColumnsProps) {
  const [layout, setLayout] = useState<Layout | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    // A small movement first, so a click still selects the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter selects the card, so only Space picks it up.
      keyboardCodes: {
        start: ['Space'],
        cancel: ['Escape'],
        end: ['Space', 'Enter'],
      },
    }),
  )

  const cards = useMemo(() => {
    const byId = new Map<string, BoardCard>()
    for (const column of view.columns) {
      for (const card of column.cards) {
        byId.set(card.id, card)
      }
    }
    return byId
  }, [view])
  const shown = layout ?? layoutOf(view)
  const columnName = (id: string) =>
    view.columns.find((column) => column.id === id)?.name ?? ''
  const numberOf = (id: UniqueIdentifier) =>
    cards.get(String(id))?.number ?? 'The card'

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id))
    setLayout(layoutOf(view))
  }

  // Moving over another column takes the card there straight away, so the
  // other cards make room for it.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !layout) {
      return
    }
    const from = columnOf(layout, active.id)
    const to = columnOf(layout, over.id)
    if (!from || !to || from === to) {
      return
    }
    setLayout((current) => {
      if (!current) {
        return current
      }
      const target = current[to]!
      const overIndex = target.indexOf(String(over.id))
      const index = overIndex === -1 ? target.length : overIndex
      return {
        ...current,
        [from]: current[from]!.filter((id) => id !== active.id),
        [to]: [
          ...target.slice(0, index),
          String(active.id),
          ...target.slice(index),
        ],
      }
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const final =
      layout && over ? finalLayout(layout, active.id, over.id) : null
    setLayout(null)
    setActiveId(null)
    const card = cards.get(String(active.id))
    if (!final || !card) {
      return
    }
    const to = columnOf(final, active.id)!
    const position = final[to]!.indexOf(card.id)
    const column = view.columns.find((c) => c.id === to)!
    if (to !== card.columnId || position !== card.position) {
      onMove(card, column, position)
    }
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up card ${numberOf(active.id)}.`,
    onDragOver: ({ active, over }) => {
      if (!over || !layout) {
        return undefined
      }
      const to = columnOf(layout, over.id)
      if (!to) {
        return undefined
      }
      const place = layout[to]!.indexOf(String(active.id)) + 1
      return `Card ${numberOf(active.id)} is in ${columnName(to)}, place ${Math.max(place, 1)} of ${layout[to]!.length}.`
    },
    onDragEnd: ({ active, over }) => {
      if (!over || !layout) {
        return `Card ${numberOf(active.id)} was put back.`
      }
      const final = finalLayout(layout, active.id, over.id)
      const to = columnOf(final, active.id)!
      const place = final[to]!.indexOf(String(active.id)) + 1
      return `Card ${numberOf(active.id)} was dropped in ${columnName(to)}, place ${place}.`
    },
    onDragCancel: ({ active }) =>
      `Moving was cancelled. Card ${numberOf(active.id)} was put back.`,
  }

  const active = activeId ? cards.get(activeId) : undefined
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setLayout(null)
        setActiveId(null)
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To pick up the card, press Space. Use the arrow keys to move it, then press Space again to drop it, or Escape to cancel. Press Enter to select it.',
        },
      }}
    >
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-4">
        {view.columns.map((column) => (
          <ColumnView
            key={column.id}
            boardId={view.id}
            column={column}
            cards={shown[column.id]!.map((id) => cards.get(id)!)}
            columns={view.columns}
            timeZone={timeZone}
            selectedCardId={selectedCardId}
            onSelect={onSelect}
            onMoveTo={(card, to) => onMove(card, to, to.cards.length)}
          />
        ))}
      </div>
      <DragOverlay>
        {active && (
          <DraggedCard
            card={active}
            timeZone={timeZone}
            selected={false}
            onSelect={() => {}}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}

function ColumnView({
  boardId,
  column,
  cards,
  columns,
  timeZone,
  selectedCardId,
  onSelect,
  onMoveTo,
}: {
  boardId: string
  column: BoardColumn
  cards: BoardCard[]
  columns: BoardColumn[]
  timeZone: string
  selectedCardId: string | null
  onSelect: (card: BoardCard) => void
  onMoveTo: (card: BoardCard, column: BoardColumn) => void
}) {
  const { setNodeRef } = useDroppable({ id: column.id })
  const headingId = `column-${column.id}`
  return (
    <section
      aria-label={column.name}
      className="flex max-h-full w-72 shrink-0 flex-col gap-2 rounded-xl bg-column p-2"
    >
      <div className="flex items-center gap-2 px-1 pt-1">
        <h2 id={headingId} className="font-semibold">
          {column.name}
          {column.isDone && (
            <span aria-hidden="true" className="ml-1 text-success">
              ✓
            </span>
          )}
        </h2>
        <span className="text-muted">
          {cards.length}
          <span className="sr-only">
            {' '}
            {cards.length === 1 ? 'card' : 'cards'}
          </span>
        </span>
      </div>
      <SortableContext
        id={column.id}
        items={cards.map((card) => card.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          ref={setNodeRef}
          aria-labelledby={headingId}
          className="flex min-h-12 flex-col gap-2 overflow-y-auto"
        >
          {cards.length === 0 && (
            <li className="px-1 py-3 text-center text-muted">No cards</li>
          )}
          {cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              columns={columns}
              timeZone={timeZone}
              selected={card.id === selectedCardId}
              onSelect={onSelect}
              onMoveTo={onMoveTo}
            />
          ))}
        </ul>
      </SortableContext>
      <AddCardForm boardId={boardId} columnId={column.id} />
    </section>
  )
}

function layoutOf(view: BoardView): Layout {
  return Object.fromEntries(
    view.columns.map((column) => [
      column.id,
      column.cards.map((card) => card.id),
    ]),
  )
}

// The column a card is in, or the column itself when `id` is a column.
function columnOf(layout: Layout, id: UniqueIdentifier): string | undefined {
  const key = String(id)
  if (key in layout) {
    return key
  }
  return Object.keys(layout).find((column) => layout[column]!.includes(key))
}

// The layout once the card is dropped over `overId`: in the same column it
// takes the place of the card it is over.
function finalLayout(
  layout: Layout,
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier,
): Layout {
  const column = columnOf(layout, activeId)
  if (!column || columnOf(layout, overId) !== column) {
    return layout
  }
  const ids = layout[column]!
  const from = ids.indexOf(String(activeId))
  const to = ids.indexOf(String(overId))
  if (to === -1 || from === to) {
    return layout
  }
  return { ...layout, [column]: arrayMove(ids, from, to) }
}
