import { describe, expect, it } from 'vitest'
import { boardCard, boardColumn, boardView } from '../test/fixtures'
import { cardsInLayout, plannedMove } from './move-card'

describe('plannedMove', () => {
  const a = boardCard('1', 'A')
  const b = boardCard('2', 'B')
  const c = boardCard('3', 'C')

  it('sends a reorder even when the saved positions have gaps', () => {
    // The API leaves gaps when a card leaves a column: B is 1, C is 2.
    const toDo = boardColumn('To do', [b, c])
    const view = boardView([
      {
        ...toDo,
        cards: toDo.cards.map((card, index) => ({
          ...card,
          position: index + 1,
        })),
      },
    ])

    expect(plannedMove(view, { [toDo.id]: [c.id, b.id] }, b.id)).toEqual({
      column: view.columns[0],
      position: 1,
    })
  })

  it('sends nothing when the card ends where it started', () => {
    const toDo = boardColumn('To do', [a, b])
    const view = boardView([toDo])

    expect(plannedMove(view, { [toDo.id]: [a.id, b.id] }, b.id)).toBeNull()
  })

  it('sends a move to another column', () => {
    const toDo = boardColumn('To do', [a])
    const done = boardColumn('Done', [b])
    const view = boardView([toDo, done])

    expect(
      plannedMove(view, { [toDo.id]: [], [done.id]: [b.id, a.id] }, a.id),
    ).toEqual({ column: view.columns[1], position: 1 })
  })
})

describe('cardsInLayout', () => {
  it('copes with a board that reloaded during a drag', () => {
    const cards = new Map([
      ['a', 'Card A'],
      ['c', 'Card C'],
    ])
    // Card b was deleted, and column "new" was added, since the drag began.
    const layout = { toDo: ['a', 'b', 'c'] }

    expect(cardsInLayout(layout, 'toDo', cards)).toEqual(['Card A', 'Card C'])
    expect(cardsInLayout(layout, 'new', cards)).toEqual([])
  })
})
