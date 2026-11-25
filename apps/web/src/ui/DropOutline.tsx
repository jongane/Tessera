// Drawn over a panel while files are dragged over it. It sits on the panel,
// which must be positioned (relative).
export function DropOutline() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-accent bg-surface/80">
      <p className="rounded-lg bg-surface px-4 py-2 text-lg font-semibold text-ink">
        Drop files to attach
      </p>
    </div>
  )
}
