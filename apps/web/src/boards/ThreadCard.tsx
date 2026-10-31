import type { BoardCard, BoardView, Thread } from '@tessera/shared'
import { useState } from 'react'
import { useCreateCard } from '../api/boards'
import { useLinkThread, useUnlinkThread } from '../api/threads'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { LinkCardDialog } from './LinkCardDialog'

// The thread's card, in the thread panel. A thread with no card is asked
// whether it wants one (PROJECT.md): a new card, or a card that has no thread
// yet. The general thread never has a card.
export function ThreadCard({
  view,
  thread,
  card,
  onOpenCard,
  onCardCreated,
}: {
  view: BoardView
  thread: Thread
  card: BoardCard | undefined
  onOpenCard: (card: BoardCard) => void
  onCardCreated: (cardId: string) => void
}) {
  const createCard = useCreateCard(view.id)
  const link = useLinkThread(view.id, thread.id)
  const unlink = useUnlinkThread(view.id, thread.id)
  const [linking, setLinking] = useState(false)
  const error = createCard.error ?? link.error ?? unlink.error
  const firstColumn = view.columns[0]

  if (thread.kind === 'GENERAL') {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <Alert>{error.message}</Alert>}
      {card ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            For card{' '}
            <button
              type="button"
              onClick={() => onOpenCard(card)}
              className="font-semibold text-accent hover:text-accent-strong hover:underline"
            >
              {card.number} {card.title}
            </button>
          </span>
          <Button
            variant="link"
            aria-label={`Unlink from ${card.number}`}
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
            className="min-h-6"
          >
            Unlink
          </Button>
        </p>
      ) : (
        thread.cardId === null && (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <p className="font-semibold">Create a card for this thread?</p>
            <div className="flex flex-wrap gap-2">
              {firstColumn && (
                <Button
                  disabled={createCard.isPending}
                  onClick={() =>
                    createCard.mutate(
                      {
                        columnId: firstColumn.id,
                        title: thread.title,
                        threadId: thread.id,
                      },
                      { onSuccess: (created) => onCardCreated(created.id) },
                    )
                  }
                >
                  Create a card
                </Button>
              )}
              <Button variant="secondary" onClick={() => setLinking(true)}>
                Link to a card
              </Button>
            </div>
          </div>
        )
      )}
      {linking && (
        <LinkCardDialog
          view={view}
          linking={link.isPending}
          onOpenChange={setLinking}
          onPick={(picked) =>
            link.mutate(
              { cardId: picked.id },
              { onSuccess: () => setLinking(false) },
            )
          }
        />
      )}
    </div>
  )
}
