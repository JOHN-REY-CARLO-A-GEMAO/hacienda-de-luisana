import type { ReactNode } from 'react'

/**
 * The four content widths the website uses, named by purpose rather than by a
 * Tailwind number.
 *
 * Every page picks one; a page never invents a fifth. `narrow` is for reading
 * (legal, FAQ, status), `content` for the signed-in pages and forms, `wide` for
 * the marketing sections that already own full-bleed layouts, and `form` for a
 * single column of controls (sign-in, lookup).
 */
export const WIDTHS = {
  form: 'max-w-xl',
  narrow: 'max-w-3xl',
  content: 'max-w-5xl',
  wide: 'max-w-7xl',
} as const

export type Width = keyof typeof WIDTHS

export function Container({
  width = 'content',
  className = '',
  children,
}: {
  width?: Width
  className?: string
  children: ReactNode
}) {
  return <div className={`mx-auto ${WIDTHS[width]} px-5 lg:px-8 ${className}`}>{children}</div>
}
