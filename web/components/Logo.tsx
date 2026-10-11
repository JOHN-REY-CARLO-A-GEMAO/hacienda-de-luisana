export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const color = tone === 'light' ? 'text-cream-50' : 'text-forest-900'
  const sub = tone === 'light' ? 'text-cream-100/80' : 'text-forest-600'
  return (
    <div className={`flex items-center gap-3 ${color}`}>
      <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path
          d="M8 30 L8 18 L20 8 L32 18 L32 30 Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M14 30v-8h12v8" stroke="currentColor" strokeWidth="1.4" />
        <path d="M20 8 v-4 M17 5 l3 -1 3 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <div className="leading-tight">
        <div className="font-serif text-lg tracking-tight">Hacienda de LuisAna</div>
        <div className={`text-[10px] uppercase tracking-eyebrow ${sub}`}>Luisiana • Laguna</div>
      </div>
    </div>
  )
}
