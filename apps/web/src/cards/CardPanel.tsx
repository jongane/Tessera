import type {
  BoardCard,
  BoardView,
  CardChangesBody,
  Project,
} from '@tessera/shared'
import { type KeyboardEvent, lazy, Suspense, useState } from 'react'
import { useBlocker } from 'react-router'
import { useMe } from '../api/auth'
import { useChangeCard, useCompleteCard, useReopenCard } from '../api/cards'
import { useMembers } from '../api/members'
import { useMoveCard } from '../api/boards'
import { CompleteAnywayDialog } from '../boards/CompleteAnywayDialog'
import { findCard } from '../boards/move-card'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Loading } from '../ui/Loading'
import {
  DueField,
  EstimateField,
  PriorityField,
  TitleField,
} from './CardFields'
import { DeleteCardDialog } from './DeleteCardDialog'
import { AssigneesField, LabelsField } from './PeopleAndLabels'

const SAVE_FAILED = 'Couldn’t save, try again'

// The rich-text editor is most of the panel's code, so it loads on its own
// and the other fields can be used straight away.
const DescriptionField = lazy(() =>
  import('./Description').then((m) => ({ default: m.DescriptionField })),
)

export interface CardPanelProps {
  cardId: string
  view: BoardView
  project: Project
  onClose: () => void
  onOpenChat: (chatId: string) => void
}

// One card, with everything about it that can be changed. The panel does
// not know where it sits: the board screen places it, so it can move into a
// dialog or onto its own page later (docs/web-app.md, section 3). It reads
// the card from the board, which reloads every 30 seconds.
export default function CardPanel(props: CardPanelProps) {
  const found = findCard(props.view, props.cardId)
  return (
    <aside
      aria-label={found ? `Card ${found.card.number}` : 'Card'}
      onKeyDown={(event) => closeOnEscape(event, props.onClose)}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      {found ? (
        <CardDetails
          // A different card starts afresh.
          key={found.card.id}
          {...props}
          card={found.card}
          columnName={found.column.name}
        />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <p>This card has been deleted or moved to another board.</p>
          <Button variant="secondary" className="self-start" onClick={props.onClose}>
            Close
          </Button>
        </div>
      )}
    </aside>
  )
}

// Escape closes the panel, unless it was pressed in a box being typed in,
// or in a menu or dialog opened from the panel (which is not inside it on
// the page, though React passes the key on).
function closeOnEscape(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  const target = event.target as HTMLElement
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    !event.currentTarget.contains(target) ||
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT'
  ) {
    return
  }
  onClose()
}

function CardDetails({
  card,
  columnName,
  view,
  project,
  onClose,
  onOpenChat,
}: CardPanelProps & { card: BoardCard; columnName: string }) {
  const [saveFailed, setSaveFailed] = useState(false)
  const [unsavedDescription, setUnsavedDescription] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const change = useChangeCard(card.boardId, card.id)

  function track(saving: Promise<unknown>) {
    setSaveFailed(false)
    saving.catch(() => setSaveFailed(true))
  }
  const save = (body: CardChangesBody) => track(change.mutateAsync(body))

  return (
    <>
      <PanelHeader
        card={card}
        columnName={columnName}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {saveFailed && <Alert>{SAVE_FAILED}</Alert>}
        <TitleField card={card} save={save} />
        <CompleteControl card={card} view={view} track={track} />
        {card.chatId && (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => onOpenChat(card.chatId!)}
          >
            Open chat
          </Button>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <PriorityField card={card} save={save} />
          <EstimateField card={card} save={save} />
        </div>
        <DueField card={card} timeZone={project.timeZone} save={save} />
        <AssigneesField card={card} projectId={project.id} track={track} />
        <LabelsField card={card} projectId={project.id} track={track} />
        <Suspense fallback={<Loading />}>
          <DescriptionField
            description={card.description}
            onEditingChange={setUnsavedDescription}
            onSave={(description) => save({ description })}
          />
        </Suspense>
        <DeleteButton
          card={card}
          projectId={project.id}
          onDelete={() => setDeleting(true)}
        />
      </div>
      {unsavedDescription && <DiscardOnLeave />}
      {deleting && (
        <DeleteCardDialog
          card={card}
          projectCode={project.code}
          onCancel={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false)
            onClose()
          }}
        />
      )}
    </>
  )
}

function PanelHeader({
  card,
  columnName,
  onClose,
}: {
  card: BoardCard
  columnName: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  function copyLink() {
    const link = new URL(`/${card.number}`, window.location.origin).href
    navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => {},
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2">
      <h2 className="font-semibold text-muted">{card.number}</h2>
      <span className="truncate text-muted">{`in ${columnName}`}</span>
      <Button variant="link" className="min-h-8 text-sm" onClick={copyLink}>
        Copy link
      </Button>
      <span role="status" className="text-xs text-muted">
        {copied ? 'Copied' : ''}
      </span>
      <button
        type="button"
        aria-label="Close card"
        onClick={onClose}
        className="ml-auto flex size-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  )
}

// Completing asks first when subtasks are open, then offers to move the
// card to the board's done column. Reopening leaves the card where it is
// (docs/card-features.md, sections 4 and 5).
function CompleteControl({
  card,
  view,
  track,
}: {
  card: BoardCard
  view: BoardView
  track: (saving: Promise<unknown>) => void
}) {
  const complete = useCompleteCard(card.boardId, card.id)
  const reopen = useReopenCard(card.boardId, card.id)
  const move = useMoveCard(card.boardId)
  const [asking, setAsking] = useState(false)
  const [offer, setOffer] = useState<string | null>(null)
  const open = card.subtaskProgress.total - card.subtaskProgress.complete
  const doneColumn = view.columns.find((column) => column.id === offer)

  function completeCard(confirmOpenSubtasks: boolean) {
    const saving = complete.mutateAsync(confirmOpenSubtasks)
    track(saving)
    saving.then((result) => setOffer(result.doneColumnId), () => {})
  }

  function onChange(checked: boolean) {
    setOffer(null)
    if (!checked) {
      track(reopen.mutateAsync())
    } else if (open > 0) {
      setAsking(true)
    } else {
      completeCard(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-8 items-center gap-2 font-semibold">
        <input
          type="checkbox"
          checked={card.isComplete}
          onChange={(event) => onChange(event.target.checked)}
          className="size-4 accent-accent"
        />
        Complete
      </label>
      {doneColumn && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-success">
          <span>{`Move it to ${doneColumn.name}?`}</span>
          <Button
            variant="secondary"
            className="min-h-8"
            onClick={() => {
              setOffer(null)
              track(
                move.mutateAsync({
                  cardId: card.id,
                  columnId: doneColumn.id,
                  // Past the end: the bottom of the column.
                  position: doneColumn.cards.length,
                }),
              )
            }}
          >
            {`Move to ${doneColumn.name}`}
          </Button>
          <Button
            variant="link"
            className="min-h-8"
            onClick={() => setOffer(null)}
          >
            Not now
          </Button>
        </div>
      )}
      {asking && (
        <CompleteAnywayDialog
          openSubtasks={open}
          byMoving={false}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false)
            completeCard(true)
          }}
        />
      )}
    </div>
  )
}

// Only the card's creator or a project admin may delete it. Others see the
// button turned off, with the reason (agreed 2026-11-01).
function DeleteButton({
  card,
  projectId,
  onDelete,
}: {
  card: BoardCard
  projectId: string
  onDelete: () => void
}) {
  const me = useMe()
  const members = useMembers(projectId)
  const isAdmin =
    members.data?.find((member) => member.userId === me.data?.id)?.role ===
    'ADMIN'
  const mayDelete =
    isAdmin || (card.createdById !== null && card.createdById === me.data?.id)
  const reasonId = `${card.id}-delete-reason`
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-4">
      <Button
        variant="secondary"
        className="self-start text-danger"
        disabled={!mayDelete}
        aria-describedby={mayDelete ? undefined : reasonId}
        onClick={onDelete}
      >
        Delete card
      </Button>
      {!mayDelete && members.data && (
        <p id={reasonId} className="text-muted">
          Only the person who made this card or a project admin can delete it.
        </p>
      )}
    </div>
  )
}

// Asks before leaving the card, or the page, with an unsaved description.
function DiscardOnLeave() {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search,
  )
  if (blocker.state !== 'blocked') {
    return null
  }
  return (
    <ConfirmDialog
      title="Discard your changes?"
      confirmLabel="Discard"
      onConfirm={() => blocker.proceed()}
      onCancel={() => blocker.reset()}
    >
      The description has changes that aren’t saved.
    </ConfirmDialog>
  )
}
