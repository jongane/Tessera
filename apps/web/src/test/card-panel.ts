import type { BoardView } from '@tessera/shared'
import { screen } from '@testing-library/react'
// Loaded up front: the board loads the panel lazily, and the first load of
// the editor can take longer than a test waits.
import '../cards/CardPanel'
import '../cards/Description'
import { fakeBoard, type FakeBoardOptions } from './fake-board'
import { boardCard, boardColumn, boardView, sprint } from './fixtures'
import { renderApp } from './render'

// Helpers for the card panel's tests.

export const boardPath = `/WEB/boards/${sprint.id}`

export const login = boardCard('12', 'Login page', {
  chatId: '55555555-5555-4555-8555-000000000012',
})

export function board(card = login): BoardView {
  return boardView([
    boardColumn('To do', [card], { id: '88888888-8888-4888-8888-000000000001' }),
    boardColumn('Done', [], {
      id: '88888888-8888-4888-8888-000000000002',
      isDone: true,
    }),
  ])
}

// Opens the board with the card panel already open on `card`.
export function openCard(
  card = login,
  options: FakeBoardOptions & { view?: BoardView } = {},
) {
  const api = fakeBoard(options.view ?? board(card), options)
  const app = renderApp(`${boardPath}?card=${card.id}`)
  return { ...app, api }
}

export async function cardPanel(number = 'WEB-12') {
  return screen.findByRole('complementary', { name: `Card ${number}` })
}

// In jsdom every element sits at 0,0, so the resizable edges take every
// pointer press and a click would not move the focus. Boxes are typed in
// from the keyboard instead.
export async function typeInto(
  user: ReturnType<typeof renderApp>['user'],
  box: HTMLElement,
  text: string,
) {
  box.focus()
  await user.type(box, text, { skipClick: true })
}

export function tile(name: string) {
  return screen.getByRole('button', { name })
}
