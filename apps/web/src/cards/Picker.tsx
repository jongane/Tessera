import * as Popover from '@radix-ui/react-popover'
import { type ReactNode, useId, useState } from 'react'
import { Button } from '../ui/Button'

export interface PickerOption {
  id: string
  name: string
  // Shown instead of the name, e.g. a coloured label. The name stays the
  // button's accessible name.
  look?: ReactNode
}

// A button that opens a small searchable list, for assigning people and
// adding labels. `extra` can add something below the list for what was
// typed, such as "Create label".
export function Picker({
  buttonLabel,
  searchLabel,
  options,
  emptyText,
  onPick,
  extra,
}: {
  buttonLabel: string
  searchLabel: string
  options: PickerOption[]
  emptyText: string
  onPick: (id: string) => void
  extra?: (query: string, close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchId = useId()
  const wanted = query.trim().toLowerCase()
  const shown = options.filter((option) =>
    option.name.toLowerCase().includes(wanted),
  )

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery('')
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button variant="link" className="min-h-8 self-start text-sm">
          {buttonLabel}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-10 flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-lg"
        >
          <label htmlFor={searchId} className="font-semibold">
            {searchLabel}
          </label>
          <input
            id={searchId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 rounded-lg border border-line-strong px-3"
          />
          {shown.length > 0 ? (
            <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
              {shown.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-label={option.look ? option.name : undefined}
                    onClick={() => {
                      onPick(option.id)
                      onOpenChange(false)
                    }}
                    className="flex min-h-11 w-full items-center rounded-md px-2 text-left hover:bg-subtle"
                  >
                    {option.look ?? option.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{emptyText}</p>
          )}
          {extra?.(query.trim(), () => onOpenChange(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
