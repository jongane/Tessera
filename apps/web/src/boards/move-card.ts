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
