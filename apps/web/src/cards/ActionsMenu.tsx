import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useId, useRef, useState } from 'react'

export interface Action {
  name: string
  onSelect: () => void
  disabled?: boolean
  // Shown under a turned-off action, and read out with it.
  reason?: string
}

// A "⋯" button that opens a menu of actions, for a checklist or an item.
export function ActionsMenu({
  label,
  actions,
}: {
  label: string
  actions: Action[]
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  // The menu opens when the button is pressed. Pressed close to a panel's
  // edge, the resizable panels take the press for themselves, so the click
  // that follows opens it instead.
  const pressTaken = useRef(false)
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        aria-label={label}
        onPointerDown={(event) => {
          pressTaken.current = event.defaultPrevented
        }}
        onClick={() => {
          if (pressTaken.current) {
            pressTaken.current = false
            setOpen(true)
          }
        }}
        className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <span aria-hidden="true">⋯</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="max-w-64 min-w-44 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {actions.map((action, index) => {
            const reasonId = `${id}-reason-${index}`
            const showReason = action.disabled && action.reason
            return (
              <DropdownMenu.Item
                key={action.name}
                disabled={action.disabled}
                onSelect={action.onSelect}
                aria-describedby={showReason ? reasonId : undefined}
                className="cursor-pointer rounded-md px-3 py-2 outline-none data-disabled:cursor-default data-disabled:text-muted data-highlighted:bg-subtle"
              >
                {action.name}
                {showReason && (
                  // Read out as the description, not as part of the name.
                  <span
                    id={reasonId}
                    aria-hidden="true"
                    className="block text-xs text-muted"
                  >
                    {action.reason}
                  </span>
                )}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
