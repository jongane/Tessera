import type { BoardCard, Thread } from '@tessera/shared'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { Dock } from './panel-layout'

const DOCKS: { value: Dock; label: string }[] = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'bottom', label: 'Bottom' },
]

// One thread: its title and its card. Messages come with chat
// (docs/web-app.md, section 1). The panel does not know where it sits, so
// it can later float or open in its own window (section 3).
export function ThreadPanel({
  thread,
  card,
  dock,
  onDock,
  onClose,
  onOpenCard,
}: {
  thread: Thread
  card: BoardCard | undefined
  dock: Dock
  onDock: (dock: Dock) => void
  onClose: () => void
  onOpenCard: (card: BoardCard) => void
}) {
  return (
    <aside
      aria-label={`Thread: ${thread.title}`}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate font-semibold">
          {thread.title}
        </h2>
        <DockMenu dock={dock} onDock={onDock} />
        <button
          type="button"
          aria-label="Close thread"
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        {card && (
          <p>
            For card{' '}
            <button
              type="button"
              onClick={() => onOpenCard(card)}
              className="font-semibold text-accent hover:text-accent-strong hover:underline"
            >
              {card.number} {card.title}
            </button>
          </p>
        )}
        <p className="text-muted">Messages are coming soon.</p>
      </div>
    </aside>
  )
}

function DockMenu({
  dock,
  onDock,
}: {
  dock: Dock
  onDock: (dock: Dock) => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Dock the panel"
        className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <span aria-hidden="true">⇄</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="min-w-40 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-xs font-semibold text-muted">
            Dock the panel
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={dock}
            onValueChange={(value) => onDock(value as Dock)}
          >
            {DOCKS.map(({ value, label }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 outline-none data-highlighted:bg-subtle"
              >
                <span aria-hidden="true" className="w-3">
                  <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
                </span>
                {label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
