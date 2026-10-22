import type { ReactNode } from 'react'

/**
 * The standard white surface.
 *
 * `card` is the page-level panel (24px radius, hairline border, soft shadow);
 * `tight` is the in-card panel used for rows, summaries and repeated items.
 * The shadow belongs to the page panel only — nesting a second shadow inside a
 * card is what made the old account page look busy.
 */
export type CardProps = {
  children: ReactNode
  /** `card` (default) for a page panel, `tight` for an inner block. */
  variant?: 'card' | 'tight'
  /** Padding preset. `none` lets the child own its edges (lists, media). */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  className?: string
  as?: 'div' | 'section' | 'article' | 'aside' | 'li'
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className'>

const PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-6 sm:p-8',
} as const

export function Card({
  children,
  variant = 'card',
  padding = 'md',
  className = '',
  as: Tag = 'div',
  ...rest
}: CardProps) {
  return (
    <Tag className={`${variant === 'card' ? 'card' : 'card-tight'} ${PADDING[padding]} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}
