import type { ReactNode } from 'react'

type Tone = 'light' | 'dark'

/**
 * Shared header for the numbered homepage scenes ("02 · Your Private Escape").
 * Purely presentational: sections keep their own ids, copy and data.
 */
export function SceneHeader({
  index,
  eyebrow,
  title,
  tone = 'light',
  align = 'left',
  className = '',
  children,
}: {
  index: string
  eyebrow: string
  title: ReactNode
  tone?: Tone
  align?: 'left' | 'center'
  className?: string
  children?: ReactNode
}) {
  const dark = tone === 'dark'
  return (
    <div className={`reveal ${align === 'center' ? 'mx-auto text-center' : ''} max-w-2xl ${className}`}>
      <div className={`flex items-center gap-4 ${align === 'center' ? 'justify-center' : ''}`}>
        <span className={`scene-index ${dark ? 'text-cream-50/70' : 'text-forest-400'}`} aria-hidden="true">
          {index}
        </span>
        <span className={`h-px w-8 ${dark ? 'bg-cream-50/25' : 'bg-forest-900/15'}`} aria-hidden="true" />
        <div className={`eyebrow ${dark ? 'text-cream-100/60' : ''}`}>{eyebrow}</div>
      </div>
      <h2 className={`display text-4xl sm:text-5xl lg:text-6xl mt-5 ${dark ? 'text-cream-50' : 'text-forest-900'}`}>{title}</h2>
      {children && (
        <div className={`mt-6 leading-relaxed ${dark ? 'text-cream-100/75' : 'text-forest-800/80'}`}>{children}</div>
      )}
    </div>
  )
}
