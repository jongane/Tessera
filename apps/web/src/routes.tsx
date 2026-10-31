import type { RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { HomePage } from './app/HomePage'
import { NotFoundPage } from './app/NotFoundPage'
import { RequireSignedIn } from './app/RequireSignedIn'
import { Loading } from './ui/Loading'

// Every address in the app (docs/web-app.md, section 2). Each page's code
// loads when the page is first opened, so the first visit stays quick.
export const routes: RouteObject[] = [
  {
    path: '/sign-in',
    hydrateFallbackElement: <Loading />,
    lazy: () =>
      import('./auth/SignInPage').then((m) => ({ Component: m.SignInPage })),
  },
  {
    path: '/sign-up',
    hydrateFallbackElement: <Loading />,
    lazy: () =>
      import('./auth/SignUpPage').then((m) => ({ Component: m.SignUpPage })),
  },
  {
    element: <RequireSignedIn />,
    hydrateFallbackElement: <Loading />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          {
            path: '/projects',
            lazy: () =>
              import('./projects/ProjectsPage').then((m) => ({
                Component: m.ProjectsPage,
              })),
          },
          {
            path: '/:code',
            lazy: () =>
              import('./app/ProjectOrCardPage').then((m) => ({
                Component: m.ProjectOrCardPage,
              })),
          },
          {
            path: '/:code/boards/:boardId',
            lazy: () =>
              import('./boards/BoardPage').then((m) => ({
                Component: m.BoardPage,
              })),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
