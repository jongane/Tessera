import type { BoardView } from '@tessera/shared'

interface Move {
  cardId: string
  columnId: string
  position: number
}

// The board after a card moves to `position` in a column, the way the API
// does it: 0 is the top, and past the end is the bottom.
export function moveCardInView(view: BoardView, move: Move): BoardView {
  const card = view.columns
    .flatMap((column) => column.cards)
    .find((c) => c.id === move.cardId)
  if (!card) {
    return view
  }
  const moved = { ...card, columnId: move.columnId }
  return {
    ...view,
    columns: view.columns.map((column) => {
      const cards = column.cards.filter((c) => c.id !== move.cardId)
      if (column.id === move.columnId) {
        cards.splice(Math.min(move.position, cards.length), 0, moved)
      }
      return {
        ...column,
        cards: cards.map((c, position) => ({ ...c, position })),
      }
    }),
  }
}

// Where a card is: its column and its place in it.
export function findCard(view: BoardView, cardId: string) {
  for (const column of view.columns) {
    const index = column.cards.findIndex((card) => card.id === cardId)
    if (index !== -1) {
      return { column, index, card: column.cards[index]! }
    }
  }
  return undefined
}

// The move to send once a drag ends with the cards laid out as `layout`, or
// null when the card ends where it started. Places are compared on screen,
// not with the saved positions, which can have gaps.
export function plannedMove(
  view: BoardView,
  layout: Record<string, string[]>,
  cardId: string,
): { column: BoardView['columns'][number]; position: number } | null {
  const start = findCard(view, cardId)
  const to = Object.keys(layout).find((id) => layout[id]!.includes(cardId))
  const column = view.columns.find((c) => c.id === to)
  if (!start || !column) {
    return null
  }
  const position = layout[column.id]!.indexOf(cardId)
  if (column.id === start.column.id && position === start.index) {
    return null
  }
  return { column, position }
}

// The cards to show in a column, from the order captured when a drag
// started. The board can reload during a drag: a column that is new then
// starts empty, and a card that has gone is left out.
export function cardsInLayout<Card>(
  layout: Record<string, string[]>,
  columnId: string,
  cards: Map<string, Card>,
): Card[] {
  return (layout[columnId] ?? []).flatMap((id) => {
    const card = cards.get(id)
    return card ? [card] : []
  })
}
