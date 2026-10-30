import { Link } from 'react-router'

export function NotFoundPage({
  title = 'Page not found',
  text = 'This address doesn’t lead anywhere. It may have changed, or you may not have access to it.',
}: {
  title?: string
  text?: string
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted">{text}</p>
      <p>
        <Link to="/projects" className="font-semibold text-accent">
          Go to your projects
        </Link>
      </p>
    </div>
  )
}
