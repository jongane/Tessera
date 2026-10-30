// Shown while a page's data loads. Screen readers announce it politely.
export function Loading() {
  return (
    <p role="status" className="p-6 text-muted">
      Loading…
    </p>
  )
}
