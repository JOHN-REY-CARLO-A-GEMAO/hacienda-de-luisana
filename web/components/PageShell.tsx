import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from '../lib/icons'

/**
 * The frame every dedicated page wears: one `h1`, an eyebrow, a lead paragraph,
 * and a closing booking invitation.
 *
 * The dedicated pages exist so the homepage can stay short, which only works if
 * they read as pages rather than as leftover sections — so the heading level,
 * the top spacing that clears the fixed bar, and the closing call to action are
 * decided once here instead of nine times.
 *
 * Children are laid out full-bleed on purpose: the sections being reused already
 * own their container width and vertical rhythm, and re-wrapping them here would
 * double the gutters and flatten the page.
 */
export function PageShell({
  eyebrow,
  title,
  lead,
  children,
  cta,
}: {
  eyebrow: string
  title: ReactNode
  lead?: ReactNode
  children: ReactNode
  /** Overrides the default "Check Availability" invitation at the foot. */
  cta?: ReactNode
}) {
  return (
    <div className="pt-28 lg:pt-36 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <header>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="display text-4xl sm:text-5xl lg:text-6xl mt-3 text-forest-900">{title}</h1>
          {lead && <div className="mt-5 text-forest-800/80 leading-relaxed">{lead}</div>}
        </header>
      </div>

      {children}

      <div className="mx-auto max-w-3xl px-5 lg:px-8 mt-16 pt-10 border-t border-forest-900/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
        <p className="text-sm text-forest-800/80 max-w-md leading-relaxed">
          Ready when you are — pick your dates and the Hacienda confirms availability and the final
          quote with you before anything is reserved.
        </p>
        {cta ?? (
          <Link to="/book" className="btn-primary group shrink-0">
            Check Availability
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
        )}
      </div>
    </div>
  )
}