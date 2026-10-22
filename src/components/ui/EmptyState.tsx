import type { ComponentType, ReactNode } from 'react'

/**
 * The empty state used by every list on the site.
 *
 * It answers three questions in the same order everywhere: what is missing,
 * why it might be missing, and what the visitor can do next. A list with no
 * action is a dead end, so `actions` is encouraged — but a screen that truly has
 * nothing to offer may omit it.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  actions,
  compact = false,
  className = '',
}: {
  icon?: ComponentType<{ size?: number; className?: string }>
  title: string
  body?: ReactNode
  actions?: ReactNode
  /** Inside a card or drawer, where the full-page padding would be excessive. */
  compact?: boolean
  className?: string
}) {
  return (
    <div className={`text-center ${compact ? 'py-10 px-4' : 'card p-10 sm:p-14'} ${className}`}>
      {Icon && (
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-cream-100 text-forest-700">
          <Icon size={26} />
        </div>
      )}
      <h2 className={compact ? 'font-serif text-xl text-forest-900' : 'h2'}>{title}</h2>
      {body && (
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-forest-800/80">{body}</p>
      )}
      {actions && <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">{actions}</div>}
    </div>
  )
}
