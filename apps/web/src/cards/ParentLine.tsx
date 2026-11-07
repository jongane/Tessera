import type { BoardCard } from '@tessera/shared'
import { Link } from 'react-router'
import { useCardRelatives } from '../api/cards'

// "Subtask of WEB-12 Build sign-in", linking to the parent: to its card on
// this board, or to its board when it is on another one. A top-level card
// has no such line.
export function ParentLine({ card }: { card: BoardCard }) {
  const relatives = useCardRelatives(card.boardId, card.id)
  const parent = relatives.data?.parents[0]
  if (!card.parentId || !parent) {
    return null
  }
  return (
    <p className="text-muted">
      Subtask of{' '}
      <Link
        to={
          parent.boardId === card.boardId
            ? { search: `?card=${parent.id}` }
            : `/${parent.number}`
        }
        className="font-semibold text-accent hover:text-accent-strong hover:underline"
      >
        {`${parent.number} ${parent.title}`}
      </Link>
    </p>
  )
}
