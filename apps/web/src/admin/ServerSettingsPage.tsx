import { useChangeServerSettings, useMe, useServerSettings } from '../api/auth'
import { NotFoundPage } from '../app/NotFoundPage'
import { Alert } from '../ui/Alert'
import { Loading } from '../ui/Loading'

// /admin: settings for the whole server, for server admins only. Anyone
// else gets "Page not found", so the page gives nothing away.
export function ServerSettingsPage() {
  const me = useMe()
  const settings = useServerSettings()
  const change = useChangeServerSettings()

  if (me.isPending) {
    return <Loading />
  }
  if (!me.data?.isServerAdmin) {
    return <NotFoundPage />
  }
  if (settings.error) {
    return (
      <div className="p-6">
        <Alert>{settings.error.message}</Alert>
      </div>
    )
  }
  if (settings.isPending) {
    return <Loading />
  }

  const open = settings.data.signUpOpen
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold">Server settings</h1>
      <section
        aria-labelledby="sign-up-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="sign-up-heading" className="text-lg font-semibold">
          Sign-up
        </h2>
        {change.error && <Alert>{change.error.message}</Alert>}
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4">
          <button
            type="button"
            role="switch"
            aria-checked={open}
            aria-labelledby="sign-up-label"
            aria-describedby="sign-up-hint"
            disabled={change.isPending}
            onClick={() => change.mutate({ signUpOpen: !open })}
            className="group relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-line-strong p-0.5 aria-checked:bg-accent disabled:opacity-60"
          >
            <span className="size-6 rounded-full bg-surface shadow transition-transform group-aria-checked:translate-x-5" />
          </button>
          <div className="flex flex-col gap-1">
            <span id="sign-up-label" className="font-semibold">
              Anyone can create an account
            </span>
            <p id="sign-up-hint" className="text-muted">
              {open
                ? 'The sign-up page is open to everyone who can reach this server.'
                : 'Sign-up is closed. Nobody new can create an account.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
