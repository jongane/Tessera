import type { BoardCard, BoardView, Chat } from '@tessera/shared'
import { useState } from 'react'
import { useCreateCard } from '../api/boards'
import { useLinkChat, useUnlinkChat } from '../api/chats'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { LinkCardDialog } from './LinkCardDialog'

// The chat's card, in the chat panel. A chat with no card is asked
// whether it wants one (PROJECT.md): a new card, or a card that has no chat
// yet. The general chat never has a card.
export function ChatCard({
  view,
  chat,
  card,
  onOpenCard,
  onCardCreated,
}: {
  view: BoardView
  chat: Chat
  card: BoardCard | undefined
  onOpenCard: (card: BoardCard) => void
  onCardCreated: (cardId: string) => void
}) {
  const createCard = useCreateCard(view.id)
  const link = useLinkChat(view.id, chat.id)
  const unlink = useUnlinkChat(view.id, chat.id)
  const [linking, setLinking] = useState(false)
  // A failed link is shown in the picker, which stays open.
  const error = createCard.error ?? unlink.error
  const firstColumn = view.columns[0]

  if (chat.kind === 'GENERAL') {
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
        chat.cardId === null && (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <p className="font-semibold">Create a card for this chat?</p>
            <div className="flex flex-wrap gap-2">
              {firstColumn && (
                <Button
                  disabled={createCard.isPending}
                  onClick={() =>
                    createCard.mutate(
                      {
                        columnId: firstColumn.id,
                        title: chat.title,
                        chatId: chat.id,
                      },
                      { onSuccess: (created) => onCardCreated(created.id) },
                    )
                  }
                >
                  Create a card
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => {
                  link.reset()
                  setLinking(true)
                }}
              >
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
          error={link.error?.message}
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
