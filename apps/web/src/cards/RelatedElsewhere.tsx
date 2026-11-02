import type { BoardCard, RelatedCard } from '@tessera/shared'
import { useId } from 'react'
import { Link } from 'react-router'
import { useCardRelatives } from '../api/cards'

// The card's relatives on other boards, with links to them. Those on this
// board are outlined on the board instead (docs/card-features.md,
// section 7). Nothing is shown when there are none. If they cannot be
// loaded, it says so, since the board's outlines are missing too.
export function RelatedElsewhere({ card }: { card: BoardCard }) {
  const relatives = useCardRelatives(card.boardId, card.id)
  const headingId = useId()
  if (!relatives.data) {
    return relatives.isError ? (
      <p className="text-sm text-muted">
        Couldn’t load the related cards. They will be tried again shortly.
      </p>
    ) : null
  }
  const elsewhere = (cards: RelatedCard[]) =>
    cards.filter((related) => related.boardId !== card.boardId)
  const groups = [
    { name: 'Parents', cards: elsewhere(relatives.data.parents) },
    { name: 'Subtasks', cards: elsewhere(relatives.data.subtasks) },
    { name: 'Siblings', cards: elsewhere(relatives.data.siblings) },
  ].filter((group) => group.cards.length > 0)
  if (groups.length === 0) {
    return null
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-semibold">
        Related cards on other boards
      </h3>
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-muted uppercase">
            {group.name}
          </h4>
          <ul aria-label={group.name} className="flex flex-col gap-1">
            {group.cards.map((related) => (
              <li
                key={related.id}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <Link
                  to={`/${related.number}`}
                  className="font-semibold text-accent hover:text-accent-strong hover:underline"
                >
                  {`${related.number} ${related.title}`}
                </Link>
                <span className="text-xs text-muted">
                  {`on ${related.boardName}`}
                  {related.isComplete && ', complete'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
