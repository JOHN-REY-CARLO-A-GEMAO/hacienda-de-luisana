import { useState, useMemo } from 'react'
import { asset } from '../lib/asset'

type Props = {
  src: string
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  aspect?: string
  fetchpriority?: 'high' | 'low' | 'auto'
}

/**
 * Image that gracefully falls back to a warm placeholder if the file is
 * missing. Owners can drop new images into /public/images without changing
 * component code.
 */
export function SmartImage({ src, alt, className = '', loading = 'lazy', aspect }: Props) {
  const [errored, setErrored] = useState(false)
  const resolvedSrc = useMemo(() => asset(src), [src])

  if (errored) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`relative overflow-hidden bg-gradient-to-br from-forest-100 via-cream-100 to-earth-100 ${className}`}
        style={aspect ? { aspectRatio: aspect } : undefined}
      >
        <div className="absolute inset-0 opacity-40" style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, rgba(56,93,55,.35), transparent 40%), radial-gradient(circle at 75% 65%, rgba(169,126,82,.25), transparent 45%)'
        }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-forest-700/50 text-xs uppercase tracking-eyebrow text-center px-4">
            {alt}
          </div>
        </div>
      </div>
    )
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => setErrored(true)}
      className={className}
      style={aspect ? { aspectRatio: aspect } : undefined}
    />
  )
}
