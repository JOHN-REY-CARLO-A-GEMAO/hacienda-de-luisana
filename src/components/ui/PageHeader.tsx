import type { ReactNode } from 'react'

/**
 * One page header for every page: eyebrow, one `h1`, an optional lead, and the
 * page's primary actions.
 *
 * Before this existed, nine pages each wrote their own `eyebrow` + `<h1>`
 * combination and drifted on spacing, size and whether a lead paragraph was
 * there. A page now states its heading once and gets the same vertical rhythm
 * everywhere — public pages, the Guest's account, the booking flow and the
 * utility screens.
 *
 * `title` is a node so a heading may carry a serif italic accent the way the
 * Hacienda's own material does, but the size and weight belong to this
 * component and are not overridden per page.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
  aside,
  className = '',
}: {
  eyebrow: string
  title: ReactNode
  lead?: ReactNode
  /** Primary action(s) for the page, right-aligned from `sm` up. */
  actions?: ReactNode
  /** Secondary content on the same row (a badge, a progress step). */
  aside?: ReactNode
  className?: string
}) {
  return (
    <header className={`flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="h1 mt-3">{title}</h1>
        {lead && <div className="prose-lead max-w-2xl">{lead}</div>}
        {aside && <div className="mt-4">{aside}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">{actions}</div>}
    </header>
  )
}
