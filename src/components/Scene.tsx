import { createContext, useContext, type ReactNode } from 'react'

type Tone = 'light' | 'dark'

/**
 * Whether the page numbers its sections.
 *
 * The homepage is a sequence — scene 03 follows scene 02 — so the numeral earns
 * its place there. The same section mounted on /stay or /faqs is not the fifth
 * thing on that page, and printing "05" beside it was the clearest sign that a
 * homepage had been pasted into a page. The provider is what tells the shared
 * section header which of the two it is in.
 */
const SceneNumbering = createContext(false)

export function SceneNumberingProvider({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  return <SceneNumbering.Provider value={enabled}>{children}</SceneNumbering.Provider>
}

/**
 * Shared header for a marketing section ("02 · Your Private Escape").
 *
 * Sizes sit deliberately below the page's `h1` — a section heading larger than
 * the title of the page it is on inverts the hierarchy the detail pages rely on.
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
  const numbered = useContext(SceneNumbering) && index !== '—'

  return (
    <div className={`reveal ${align === 'center' ? 'mx-auto text-center' : ''} max-w-2xl ${className}`}>
      <div className={`flex items-center gap-4 ${align === 'center' ? 'justify-center' : ''}`}>
        {numbered && (
          <>
            <span className={`scene-index ${dark ? 'text-cream-50/70' : 'text-forest-400 dark:text-sage-400'}`} aria-hidden="true">
              {index}
            </span>
            <span className={`h-px w-8 ${dark ? 'bg-cream-50/25' : 'bg-forest-900/15 dark:bg-cream-100/15'}`} aria-hidden="true" />
          </>
        )}
        <div className={`eyebrow ${dark ? 'text-cream-100/60' : 'text-forest-600 dark:text-sage-400'}`}>{eyebrow}</div>
      </div>
      <h2 className={`display mt-4 text-3xl sm:text-4xl lg:text-5xl ${dark ? 'text-cream-50' : 'text-forest-900 dark:text-cream-50'}`}>
        {title}
      </h2>
      {children && (
        <div className={`mt-5 leading-relaxed ${dark ? 'text-cream-100/75' : 'text-forest-800/80 dark:text-cream-100/80'}`}>
          {children}
        </div>
      )}
    </div>
  )
}
