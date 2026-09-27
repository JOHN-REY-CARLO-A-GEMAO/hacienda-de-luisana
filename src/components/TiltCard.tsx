import { useRef, type ElementType, type ReactNode } from 'react'
import { usePointerDepthEnabled, useTilt } from '../lib/motion'

/**
 * Card wrapper with a subtle pointer tilt + moving highlight on fine pointers.
 * On touch devices and under reduced motion it renders a flat, ordinary card.
 * Content is never hidden behind the effect — it is transform-only and the
 * card's children stay fully interactive.
 */
export function TiltCard({
  as: Tag = 'div',
  className = '',
  max = 4,
  children,
  ...rest
}: {
  as?: ElementType
  className?: string
  max?: number
  children: ReactNode
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null)
  const enabled = usePointerDepthEnabled()
  useTilt(ref, enabled, max)
  return (
    <Tag ref={ref} className={`tilt ${className}`} data-tilt={enabled ? 'on' : 'off'} {...rest}>
      {children}
    </Tag>
  )
}
