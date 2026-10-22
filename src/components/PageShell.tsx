import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from '../lib/icons'
import { Container, Page, PageHeader, type Width } from './ui'

/**
 * The frame every public page wears: one `h1`, an eyebrow, a lead paragraph,
 * and a closing booking invitation.
 *
 * The dedicated pages exist so the homepage can stay short, which only works if
 * they read as pages rather than as leftover sections — so the heading level,
 * the top spacing that clears the fixed bar, and the closing call to action are
 * decided once here instead of nine times.
 *
 * `width` is the single reading column for the header and the closing band. The
 * sections a page mounts keep their own full-bleed containers on purpose:
 * re-wrapping them would double the gutters and flatten the page.
 */
export function PageShell({
  eyebrow,
  title,
  lead,
  children,
  cta,
  width = 'narrow',
}: {
  eyebrow: string
  title: ReactNode
  lead?: ReactNode
  children: ReactNode
  /** Overrides the default "Check Availability" invitation at the foot. */
  cta?: ReactNode
  /** The reading column for the header and footer band. */
  width?: Extract<Width, 'narrow' | 'content'>
}) {
  return (
    <Page>
      <Container width={width}>
        <PageHeader eyebrow={eyebrow} title={title} lead={lead} />
      </Container>

      {children}

      <Container width={width} className="mt-16 border-t border-forest-900/10 pt-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-sm leading-relaxed text-forest-800/80">
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
      </Container>
    </Page>
  )
}
