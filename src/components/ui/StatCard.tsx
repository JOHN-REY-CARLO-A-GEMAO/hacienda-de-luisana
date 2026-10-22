import type { ComponentType, ReactNode } from 'react'

/**
 * A single metric. The Guest account's three counters and the Admin app's
 * dashboard tiles say the same kind of thing, so they look the same kind of
 * thing: a quiet label, one number, an icon that carries the tone.
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
    neutral: 'bg-cream-100 text-forest-700',
    pending: 'bg-amber-100 text-amber-700',
    success: 'bg-emerald-100 text-emerald-700',
  }[tone]

  return (
    <div className="card-tight flex items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <div className="data-label">{label}</div>
        <div className="mt-1 font-serif text-3xl leading-none text-forest-900">{value}</div>
        {hint && <div className="mt-1.5 text-[11px] text-forest-600">{hint}</div>}
      </div>
      {Icon && (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${toneClass}`} aria-hidden="true">
          <Icon size={20} />
        </span>
      )}
    </div>
  )
}
