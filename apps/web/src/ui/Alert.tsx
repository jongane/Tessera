import type { ReactNode } from 'react'

// A problem the person needs to know about, announced by screen readers.
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg bg-danger-soft px-3 py-2.5 leading-snug text-danger"
    >
      {children}
    </div>
  )
}
