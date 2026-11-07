import type { Card } from '@tessera/shared'
import { useSetParent } from '../api/subtasks'
import { ParentPickerDialog } from './ParentPickerDialog'

// Picks a new parent for a card and moves it there. The picker stays open
// when the API refuses, with its message, and closes once saved. The board
// reloads, so the card shows under its new number.
export function MoveToParent({
  card,
  onDone,
  returnFocusTo,
}: {
  card: Pick<Card, 'id' | 'boardId' | 'projectId'>
  onDone: () => void
  returnFocusTo?: HTMLElement | null
}) {
  const setParent = useSetParent()
  return (
    <ParentPickerDialog
      projectId={card.projectId}
      moving={card}
      onPick={(parent) =>
        setParent.mutate(
          { cardId: card.id, parentId: parent.id },
          { onSuccess: onDone },
        )
      }
      onCancel={onDone}
      error={setParent.error}
      pending={setParent.isPending}
      returnFocusTo={returnFocusTo}
    />
  )
}
