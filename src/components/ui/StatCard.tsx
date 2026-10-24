import type { ComponentType, ReactNode } from 'react'

/**
 * One count on a Guest's own page.
 *
 * It used to be a tile: a boxed card with a coloured disc beside the number,
 * three of them in a row, identical but for the figure. Three identical tiles
 * say "dashboard" before they say anything about a stay, and the discs competed
 * with the status colours that do carry meaning.
 *
 * So a count is now drawn the same way as every other fact on the page — a
 * label, a number in the display face, a hairline under it — and only the
 * numeral takes a colour, and only for the two counts that make a claim: a
 * request still waiting, and a stay coming up.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: ReactNode
  icon?: ComponentType<{ size?: number; className?: string }>
  tone?: 'neutral' | 'pending' | 'success'
  hint?: string
}) {
  const toneClass = {
    neutral: 'text-forest-900 dark:text-cream-50',
    pending: 'text-amber-700 dark:text-amber-300',
    success: 'text-emerald-800 dark:text-emerald-300',
  }[tone]

  return (
    <div className="flex items-start justify-between gap-4 border-t border-forest-900/8 py-2.5 first:border-t-0 dark:border-cream-100/10">
      <div className="min-w-0">
        <div className="guest-label flex items-center gap-1.5">
          {Icon && <Icon size={13} className="shrink-0 text-forest-500 dark:text-sage-400" aria-hidden="true" />}
          {label}
        </div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-forest-600/85 dark:text-sage-400/85">{hint}</div>}
      </div>
      <div className={`guest-num shrink-0 text-2xl leading-none ${toneClass}`}>{value}</div>
    </div>
  )
}
