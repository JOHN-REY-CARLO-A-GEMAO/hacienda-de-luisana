import { useRef } from 'react'
import { SmartImage } from './SmartImage'
import { useParallax, usePrefersReducedMotion } from '../lib/motion'

/**
 * A clipped photograph that drifts slightly slower than the page (scroll
 * parallax). Falls back to a plain framed image under reduced motion. The
 * frame owns the size/rounding; the media layer is ~124% tall so the shift
 * never exposes an edge.
 */
export function ParallaxImage({
  src,
  alt,
  className = '',
  range = 0.08,
  loading = 'lazy',
  children,
}: {
  src: string
  alt: string
  /** Frame classes: size, rounding, shadow (and `absolute` when placed manually). */
  className?: string
  /** Max shift as a fraction of the frame height. */
  range?: number
  loading?: 'lazy' | 'eager'
  children?: React.ReactNode
}) {
  const media = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  useParallax(media, range, !reduced)
  const classes = className.split(/\s+/)
  const positioned = classes.includes('absolute') || classes.includes('fixed') || classes.includes('sticky')
  return (
    <div className={`parallax-frame ${positioned ? '' : 'relative'} ${className}`}>
      <div ref={media} className="parallax-media">
        <SmartImage src={src} alt={alt} loading={loading} className="h-full w-full object-cover" />
      </div>
      {children}
    </div>
  )
}
