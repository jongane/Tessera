import * as RadixDialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  // False for a window opened over another one, so that one stays readable.
  modal?: boolean
}

// A window over the page. Radix keeps the keyboard inside it, closes it on
// Escape and gives focus back to whatever opened it.
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  modal = true,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-ink/40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={`fixed top-1/2 left-1/2 flex w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-surface p-6 shadow-lg ${modal ? '' : 'border border-line-strong'}`}
        >
          <RadixDialog.Title className="text-lg font-semibold">
            {title}
          </RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export const DialogClose = RadixDialog.Close
