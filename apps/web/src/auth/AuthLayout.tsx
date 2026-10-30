import type { ReactNode } from 'react'
import { Logo } from '../ui/Logo'

// The centred card that sign-in and sign-up sit in.
export function AuthLayout({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2.5">
          <Logo size={40} />
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-sm">
          {children}
        </div>
        {footer && <div className="text-center text-muted">{footer}</div>}
      </main>
    </div>
  )
}
