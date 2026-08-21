import { STATS } from '../config/site'

export function Stats() {
  return (
    <section className="bg-forest-900 text-cream-100">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-14 lg:py-20">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-y-10">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={`text-center px-4 ${
                i > 0 ? 'md:border-l md:border-cream-100/15' : ''
              }`}
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
