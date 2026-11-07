import type { Card } from '@tessera/shared'
import { useSetParent } from '../api/subtasks'
import { ParentPickerDialog } from './ParentPickerDialog'

// Picks a new parent for a card and moves it there. The picker stays open
// when the API refuses, with its message, and closes once saved. The board
// reloads, so the card shows under its new number.
export function MoveToParent({
  card,
  onDone,
  onMoved,
  returnFocusTo,
}: {
  card: Pick<Card, 'id' | 'boardId' | 'projectId' | 'parentId'>
  onDone: () => void
  // Called when the move was saved, before `onDone`.
  onMoved?: () => void
  returnFocusTo?: HTMLElement | null
}) {
  const setParent = useSetParent()
  return (
    <ParentPickerDialog
      projectId={card.projectId}
      moving={card}
      alsoLeaveOut={card.parentId ? [card.parentId] : []}
      onPick={(parent) =>
        // mutateAsync still answers if a reload removed this dialog's row
        // while saving; a failure shows in `error`.
        setParent.mutateAsync({ cardId: card.id, parentId: parent.id }).then(
          () => {
            onMoved?.()
            onDone()
          },
          () => {},
        )
      }
      onCancel={onDone}
      error={setParent.error}
      pending={setParent.isPending}
      returnFocusTo={returnFocusTo}
    />
  )
}
