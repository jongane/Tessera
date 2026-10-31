import { Navigate } from 'react-router'
import { lastBoardPath } from '../boards/last-board'

// The last board used, or the project list the first time
// (docs/web-app.md, section 2).
export function HomePage() {
  return <Navigate to={lastBoardPath() ?? '/projects'} replace />
}
