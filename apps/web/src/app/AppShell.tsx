import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Link, Outlet, useNavigate } from 'react-router'
import { useMe, useSignOut } from '../api/auth'
import { Logo } from '../ui/Logo'

// The frame around every signed-in page: the Tessera mark and the account
// menu along the top, and the page below.
export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-line bg-surface px-4 py-2.5 sm:px-5">
        <Link
          to="/projects"
          className="flex items-center gap-2 text-base font-bold text-ink"
        >
          <Logo />
          Tessera
        </Link>
        <div className="ml-auto">
          <AccountMenu />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}

function AccountMenu() {
  const { data: me } = useMe()
  const signOut = useSignOut()
  const navigate = useNavigate()

  if (!me) {
    return null
  }
  const initial = me.displayName.charAt(0).toUpperCase()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Account menu for ${me.displayName}`}
        className="flex size-11 items-center justify-center rounded-full"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">
          {initial}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="min-w-56 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="font-semibold">{me.displayName}</p>
            <p className="text-muted">{me.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            className="flex min-h-11 cursor-pointer items-center rounded-md px-3 outline-none data-highlighted:bg-accent-soft"
            onSelect={() =>
              signOut.mutate(undefined, {
                onSuccess: () => navigate('/sign-in', { replace: true }),
              })
            }
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
