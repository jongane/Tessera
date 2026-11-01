import type {
  BoardCard,
  BoardColumn,
  RelationColourName,
} from '@tessera/shared'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type KeyboardEvent, useId } from 'react'
import {
  type CardRelation,
  detailsText,
  dueText,
  initial,
  LABEL_STYLES,
  PRIORITY_NAMES,
  RELATION_NAMES,
  RELATION_OUTLINES,
} from './card-text'
import { MoveToMenu } from './MoveToMenu'

// While a card is open, it and its relatives are outlined in the project's
// colours, each relative with a tag, and other cards are faded
// (docs/card-features.md, section 7).
export interface Highlight {
  // Null for the open card itself, and for cards not related to it.
  relation: CardRelation | null
  colour: RelationColourName | null
  faded: boolean
}

interface CardTileProps {
  card: BoardCard
  columns: BoardColumn[]
  timeZone: string
  selected: boolean
  highlight?: Highlight
  onSelect: (card: BoardCard) => void
  onMoveTo: (card: BoardCard, column: BoardColumn) => void
}

// A card on the board. Space picks it up to move it with the arrow keys;
// Enter or a click selects it.
export function CardTile(props: CardTileProps) {
  const { card } = props
  const {
    setNodeRef,
    setActivatorNodeRef,
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
        activatorRef={setActivatorNodeRef}
        isDragging={isDragging}
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

// The whole card can be dragged. Only its number and title are the button,
// so its name stays short; the rest is read out as its description. The copy
// that follows the pointer is not a button (`interactive` false).
function CardFace({
  card,
  timeZone,
  selected,
  highlight,
  onSelect,
  dragAttributes,
  dragListeners,
  activatorRef,
  isDragging = false,
  interactive = true,
}: Omit<CardTileProps, 'columns' | 'onMoveTo'> & {
  dragAttributes?: DragAttributes
  dragListeners?: DragListeners
  activatorRef?: (element: HTMLElement | null) => void
  isDragging?: boolean
  interactive?: boolean
}) {
  const detailsId = useId()
  const due = dueText(card, timeZone)
  const { checklistProgress: checklist, subtaskProgress: subtasks } = card
  const relation = highlight?.relation ?? null
  const colour = highlight?.colour ?? null
  const outline =
    colour &&
    RELATION_OUTLINES[colour][relation === 'deeperSubtask' ? 'pale' : 'strong']

  // While the card is being moved, the keys belong to the move.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && !isDragging) {
      onSelect(card)
    }
  }

  return (
    <div
      {...dragListeners}
      onClick={interactive ? () => onSelect(card) : undefined}
      data-relation-colour={colour ?? undefined}
      style={outline ? { borderColor: outline, boxShadow: `0 0 0 2px ${outline}` } : undefined}
      className={`flex cursor-grab touch-none flex-col gap-1.5 rounded-lg border p-3 pr-11 text-left ${
        highlight?.faded
          ? 'border-line bg-subtle grayscale'
          : 'bg-surface shadow-xs'
      } ${
        outline
          ? ''
          : selected
            ? 'border-accent ring-2 ring-accent'
            : 'border-line hover:border-line-strong'
      }`}
    >
      {relation && (
        <span
          aria-hidden="true"
          className="self-start rounded bg-subtle px-1.5 py-0.5 text-xs font-semibold text-muted"
        >
          {RELATION_NAMES[relation]}
        </span>
      )}
      <div
        {...(interactive && {
          ...dragAttributes,
          ref: activatorRef,
          onKeyDown,
          role: 'button',
          tabIndex: 0,
          'aria-label': `${card.number} ${card.title}`,
          'aria-current': selected ? 'true' : undefined,
          'aria-describedby': [detailsId, dragAttributes?.['aria-describedby']]
            .filter(Boolean)
            .join(' '),
        })}
        className="flex flex-col gap-1 rounded"
      >
        <span className="text-xs font-semibold text-muted">{card.number}</span>{' '}
        <span className="font-semibold">{card.title}</span>
      </div>
      <span id={detailsId} className="sr-only">
        {detailsText(card, timeZone, relation ?? undefined)}
      </span>
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        {card.priority !== 'NONE' && (
          <span className="self-start rounded bg-[#fdeddf] px-1.5 py-0.5 text-xs font-semibold text-[#8a3b0b]">
            {PRIORITY_NAMES[card.priority]}
          </span>
        )}
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
      </div>
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
        <span>{`☐ ${checklist.done}/${checklist.total}`}</span>
      )}
      {subtasks.total > 0 && (
        <span>{`⤷ ${subtasks.complete}/${subtasks.total}`}</span>
      )}
      {due && <span>{due}</span>}
      {card.assignees.length > 0 && (
        <span className="ml-auto flex -space-x-1">
          {card.assignees.map((person) => (
            <span
              key={person.id}
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

// The card as it follows the pointer while being dragged.
export function DraggedCard(
  props: Omit<CardTileProps, 'onMoveTo' | 'columns'>,
) {
  return (
    <div aria-hidden="true" className="rotate-1 shadow-lg">
      <CardFace {...props} interactive={false} />
    </div>
  )
}
