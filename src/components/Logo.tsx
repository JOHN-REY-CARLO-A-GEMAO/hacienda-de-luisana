export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const color = tone === 'light' ? 'text-cream-50' : 'text-forest-900'
  const sub = tone === 'light' ? 'text-cream-100/80' : 'text-forest-600'
  return (
    <div className={`flex items-center gap-2 min-[360px]:gap-2.5 sm:gap-3 min-w-0 ${color}`}>
      <svg className="shrink-0 w-6 h-6 sm:w-7 sm:h-7" width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path
          d="M8 30 L8 18 L20 8 L32 18 L32 30 Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M14 30v-8h12v8" stroke="currentColor" strokeWidth="1.4" />
        <path d="M20 8 v-4 M17 5 l3 -1 3 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <div className="leading-tight min-w-0">
        {/* A step smaller below `sm` so the logo, the compact booking button
            and the menu button share one row on a narrow phone without
            overlapping or forcing a horizontal scroll. */}
        <div className="font-serif text-[13px] min-[360px]:text-base sm:text-lg tracking-tight whitespace-nowrap truncate">
          Hacienda de LuisAna
        </div>
        <div className={`hidden sm:block text-[10px] uppercase tracking-eyebrow ${sub}`}>Luisiana • Laguna</div>
      </div>
    </div>
  )
}
