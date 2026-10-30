import { Navigate, Outlet, useLocation } from 'react-router'
import { useMe } from '../api/auth'
import { Alert } from '../ui/Alert'
import { Loading } from '../ui/Loading'

// Pages inside need a signed-in person. Anyone else goes to sign in, and
// comes back to the same page afterwards.
export function RequireSignedIn() {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) {
    return <Loading />
  }
  // The API is down or unreachable: say so, rather than asking the person
  // to sign in again.
  if (me.error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Alert>{me.error.message}</Alert>
      </div>
    )
  }
  if (!me.data) {
    const returnTo = location.pathname + location.search
    return (
      <Navigate
        to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    )
  }
  return <Outlet />
}
