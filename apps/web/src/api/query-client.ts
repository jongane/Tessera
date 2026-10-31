import {
  type DefaultOptions,
  MutationCache,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query'
import { meKey } from './auth'
import { ApiError, isApiError } from './client'

// One place for loading and caching API data. When the API says the session
// has ended (401), the person counts as signed out, so the page sends them
// to sign in and back again afterwards (see RequireSignedIn).
export function createQueryClient(defaultOptions?: DefaultOptions) {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      ...defaultOptions,
      queries: {
        // Reload when the person comes back to the tab (docs/web-app.md, 6).
        refetchOnWindowFocus: true,
        // Try again after a network or server problem, but not when the API
        // refused the request (4xx): asking again would get the same answer.
        retry: (failures, error) =>
          failures < 2 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        ...defaultOptions?.queries,
      },
    },
    queryCache: new QueryCache({ onError: sessionEnded }),
    mutationCache: new MutationCache({ onError: sessionEnded }),
  })

  function sessionEnded(error: unknown) {
    if (isApiError(error, 401)) {
      queryClient.setQueryData(meKey, null)
    }
  }

  return queryClient
}
