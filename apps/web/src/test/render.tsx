import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createQueryClient } from '../api/query-client'
import { routes } from '../routes'

// Renders the whole app at `path`, as a person would see it.
export function renderApp(path: string) {
  const queryClient = createQueryClient({
    queries: { retry: false },
    mutations: { retry: false },
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...view, router, user }
}

// The current address, e.g. "/projects?x=1".
export function currentPath(router: ReturnType<typeof createMemoryRouter>) {
  const { pathname, search } = router.state.location
  return pathname + search
}
