import * as RadixDialog from '@radix-ui/react-dialog'
import { type ReactNode, useEffect, useRef } from 'react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  // False for a window opened over another one, so that one stays readable.
  modal?: boolean
  // Wider, for content such as an image.
  wide?: boolean
  // Gets focus back on close. Else whatever had focus when it opened. A
  // function is asked when the window closes, for a place that depends on how.
  returnFocusTo?: HTMLElement | null | (() => HTMLElement | null)
}

// A window over the page. Radix keeps the keyboard inside it and closes it on
// Escape. Our windows have no Radix trigger, so the element that had focus
// when the window opened is remembered, and gets focus back on close.
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  modal = true,
  wide = false,
  returnFocusTo,
}: DialogProps) {
  const opener = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  )
  // Also when the parent drops the window without closing it first.
  const back = useRef(returnFocusTo)
  useEffect(() => {
    back.current = returnFocusTo
  })
  const target = () => {
    const place =
      typeof back.current === 'function' ? back.current() : back.current
    return place ?? opener.current
  }
  useEffect(() => () => focusBack(target()), [])
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-ink/40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            focusBack(target())
          }}
          className={`fixed top-1/2 left-1/2 flex w-[calc(100%-32px)] ${wide ? 'max-w-3xl' : 'max-w-md'} -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-surface p-6 shadow-lg ${modal ? '' : 'border border-line-strong'}`}
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

function focusBack(element: Element | null) {
  if (element instanceof HTMLElement && element.isConnected) element.focus()
}
