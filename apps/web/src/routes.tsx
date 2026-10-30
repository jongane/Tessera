import { Navigate, type RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { NotFoundPage } from './app/NotFoundPage'
import { RequireSignedIn } from './app/RequireSignedIn'
import { SignInPage } from './auth/SignInPage'
import { SignUpPage } from './auth/SignUpPage'
import { BoardPage } from './boards/BoardPage'
import { ProjectPage } from './projects/ProjectPage'
import { ProjectsPage } from './projects/ProjectsPage'

// Every address in the app (docs/web-app.md, section 2).
export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/sign-up', element: <SignUpPage /> },
  {
    element: <RequireSignedIn />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/projects" replace /> },
          { path: '/projects', element: <ProjectsPage /> },
          { path: '/:code', element: <ProjectPage /> },
          { path: '/:code/boards/:boardId', element: <BoardPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
