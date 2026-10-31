import type { BoardCard, BoardColumn } from '@tessera/shared'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

// The way to move a card without dragging it (docs/web-app.md, section 4).
// The card goes to the bottom of the column picked.
export function MoveToMenu({
  card,
  columns,
  onMoveTo,
}: {
  card: BoardCard
  columns: BoardColumn[]
  onMoveTo: (column: BoardColumn) => void
}) {
  const others = columns.filter((column) => column.id !== card.columnId)
  if (others.length === 0) {
    return null
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Move ${card.number} to…`}
        className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <span aria-hidden="true">⋯</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="min-w-44 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-xs font-semibold text-muted">
            Move to
          </DropdownMenu.Label>
          {others.map((column) => (
            <DropdownMenu.Item
              key={column.id}
              onSelect={() => onMoveTo(column)}
              className="cursor-pointer rounded-md px-3 py-2 outline-none data-highlighted:bg-subtle"
            >
              {column.name}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
