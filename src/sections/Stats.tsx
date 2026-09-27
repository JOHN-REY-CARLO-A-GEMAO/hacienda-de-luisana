import { STATS } from '../config/site'

/** Facts strip that closes Scene 02 — values come from site config only. */
export function Stats() {
  return (
    <section className="relative bg-forest-900 text-cream-100 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(60% 120% at 0% 50%, rgba(154,184,149,0.25), transparent 60%), radial-gradient(50% 120% at 100% 50%, rgba(208,180,110,0.18), transparent 60%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-14 lg:py-20">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-y-10">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={`reveal text-center px-4 ${i > 0 ? 'md:border-l md:border-cream-100/15' : ''}`}
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <div className="font-serif text-5xl lg:text-6xl text-cream-50">{s.value}</div>
              <div className="mt-2 text-[11px] uppercase tracking-eyebrow text-cream-100/70">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
