import type { ReactNode } from 'react'

/**
 * The frame every page sits in: cream ground, the top space that clears the
 * fixed navigation, and room at the foot for the tutorial button.
 *
 * This was the single most repeated line in the site — the same eight utility
 * classes were copied into nine pages and `PageShell`. It is one component now,
 * so a change to the height of the fixed bar (or the page background) is a
 * change in one place. A page that needs a stacking context for a full-bleed
 * band passes `className="relative"`; there is deliberately no other variant.
 */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`min-h-screen bg-cream-50 pb-24 pt-28 text-forest-900 lg:pt-36 ${className}`}>
      {children}
    </div>
  )
}
