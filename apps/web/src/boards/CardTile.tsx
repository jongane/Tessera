import type { BoardCard, BoardColumn } from '@tessera/shared'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type KeyboardEvent, useId } from 'react'
import {
  assigneesText,
  dueText,
  initial,
  LABEL_STYLES,
  PRIORITY_NAMES,
} from './card-text'
import { MoveToMenu } from './MoveToMenu'

interface CardTileProps {
  card: BoardCard
  columns: BoardColumn[]
  timeZone: string
  selected: boolean
  onSelect: (card: BoardCard) => void
  onMoveTo: (card: BoardCard, column: BoardColumn) => void
}

// A card on the board. Space picks it up to move it with the arrow keys;
// Enter or a click selects it.
export function CardTile(props: CardTileProps) {
  const { card } = props
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: card.id, data: { card } })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative ${isDragging ? 'opacity-40' : ''}`}
    >
      <CardFace
        {...props}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
      <MoveToMenu
        card={card}
        columns={props.columns}
        onMoveTo={(column) => props.onMoveTo(card, column)}
      />
    </li>
  )
}

type DragAttributes = ReturnType<typeof useSortable>['attributes']
type DragListeners = ReturnType<typeof useSortable>['listeners']

function CardFace({
  card,
  timeZone,
  selected,
  onSelect,
  dragAttributes,
  dragListeners,
}: CardTileProps & {
  dragAttributes?: DragAttributes
  dragListeners?: DragListeners
}) {
  const detailsId = useId()
  const due = dueText(card, timeZone)
  const { checklistProgress: checklist, subtaskProgress: subtasks } = card

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    dragListeners?.onKeyDown?.(event)
    if (event.key === 'Enter') {
      onSelect(card)
    }
  }

  return (
    <div
      {...dragAttributes}
      {...dragListeners}
      onKeyDown={onKeyDown}
      onClick={() => onSelect(card)}
      role="button"
      tabIndex={0}
      aria-label={`${card.number} ${card.title}`}
      aria-current={selected ? 'true' : undefined}
      aria-describedby={[detailsId, dragAttributes?.['aria-describedby']]
        .filter(Boolean)
        .join(' ')}
      className={`flex cursor-grab touch-none flex-col gap-1.5 rounded-lg border bg-surface p-3 pr-11 text-left shadow-xs ${
        selected
          ? 'border-accent ring-2 ring-accent'
          : 'border-line hover:border-line-strong'
      }`}
    >
      <span className="flex items-center gap-2 text-xs font-semibold text-muted">
        {card.number}
        {card.priority !== 'NONE' && (
          <span className="rounded bg-[#fdeddf] px-1.5 py-0.5 text-[#8a3b0b]">
            {PRIORITY_NAMES[card.priority]}
            <span className="sr-only"> priority</span>
          </span>
        )}
      </span>
      <span className="font-semibold">{card.title}</span>
      <span id={detailsId} className="flex flex-col gap-1.5">
        {card.labels.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {card.labels.map((label) => (
              <span
                key={label.id}
                className={`rounded px-1.5 py-0.5 text-xs font-semibold ${LABEL_STYLES[label.colour]}`}
              >
                {label.name}
              </span>
            ))}
          </span>
        )}
        <CardFooter
          card={card}
          due={due}
          checklist={checklist}
          subtasks={subtasks}
        />
      </span>
    </div>
  )
}

function CardFooter({
  card,
  due,
  checklist,
  subtasks,
}: {
  card: BoardCard
  due: string | null
  checklist: BoardCard['checklistProgress']
  subtasks: BoardCard['subtaskProgress']
}) {
  const hasAny =
    checklist.total > 0 ||
    subtasks.total > 0 ||
    due !== null ||
    card.assignees.length > 0
  if (!hasAny) {
    return null
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {checklist.total > 0 && (
        <Count
          short={`☐ ${checklist.done}/${checklist.total}`}
          full={`${checklist.done} of ${checklist.total} checklist items done`}
        />
      )}
      {subtasks.total > 0 && (
        <Count
          short={`⤷ ${subtasks.complete}/${subtasks.total}`}
          full={`${subtasks.complete} of ${subtasks.total} subtasks done`}
        />
      )}
      {due && <span>{due}</span>}
      {card.assignees.length > 0 && (
        <span className="ml-auto flex -space-x-1">
          <span className="sr-only">{assigneesText(card)}</span>
          {card.assignees.map((person) => (
            <span
              key={person.id}
              aria-hidden="true"
              title={person.displayName}
              className="flex size-6 items-center justify-center rounded-full border-2 border-surface bg-accent-soft font-semibold text-accent-strong"
            >
              {initial(person.displayName)}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

// A short count for the eye ("3/5"), with the words for screen readers.
function Count({ short, full }: { short: string; full: string }) {
  return (
    <span>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{full}</span>
    </span>
  )
}

// The card as it follows the pointer while being dragged.
export function DraggedCard(
  props: Omit<CardTileProps, 'onMoveTo' | 'columns'>,
) {
  return (
    <div className="rotate-1 shadow-lg">
      <CardFace {...props} columns={[]} onMoveTo={() => {}} />
    </div>
  )
}
