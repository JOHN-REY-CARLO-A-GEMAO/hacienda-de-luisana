/**
 * Loading, in the two shapes the site needs.
 *
 * `Spinner` is for an action in flight inside a control (a button waiting on a
 * network call); `LoadingPanel` is for a page or list whose content is not here
 * yet. The words are always visible — a spinner alone tells a screen-reader
 * user nothing — and the region is polite so it announces itself once.
 */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}

export function LoadingPanel({
  label = 'Loading…',
  /** Drops the panel's own surface, for a page or card that already has one. */
  bare = false,
  className = '',
}: {
  label?: string
  bare?: boolean
  className?: string
}) {
  return (
    <div
      className={`flex items-center justify-center gap-3 px-6 py-10 text-sm text-forest-700 ${
        bare ? '' : 'rounded-2xl border border-forest-900/5 bg-white/60'
      } ${className}`}
      role="status"
      aria-live="polite"
    >
      <Spinner size={18} className="text-forest-600" />
      <span>{label}</span>
    </div>
  )
}

/** A plain block of skeleton lines, for a list whose shape is already known. */
export function SkeletonLines({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-4 animate-pulse rounded-full bg-forest-900/5" style={{ width: `${90 - index * 12}%` }} />
      ))}
    </div>
  )
}
