import { Link, useParams } from 'react-router'

// Stands in for the board view, which comes in the next pull request
// (docs/web-app.md, section 10, step 4).
export function BoardPage() {
  const { code = '' } = useParams()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-muted">
        <Link to={`/${code}`} className="hover:text-ink">
          Back to the project
        </Link>
      </nav>
      <h1 className="text-2xl font-bold">Board</h1>
      <p className="text-muted">The board view is coming in the next update.</p>
    </div>
  )
}
