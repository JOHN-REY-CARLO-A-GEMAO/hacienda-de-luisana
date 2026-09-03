import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ACCOMMODATIONS, AMENITIES } from '../../config/site'
import { SmartImage } from '../../components/SmartImage'
import { AMENITY_ICONS, ArrowRight, Bed, Users } from '../../lib/icons'
import { Screen, ScreenTitle } from '../components/Screen'

export function StayScreen() {
  return (
    <Screen>
      <ScreenTitle eyebrow="Accommodations" title="Stay your way">
        <p className="mt-2 text-sm text-forest-800/80 leading-relaxed">
          A private main house for the whole group, or a quieter camping stay under the trees.
        </p>
      </ScreenTitle>

      <div className="space-y-5">
        {ACCOMMODATIONS.filter((a) => a.active).map((a) => (
          <StayCard key={a.id} id={a.id} />
        ))}
      </div>
    </Screen>
  )
}

function StayCard({ id }: { id: string }) {
  const a = ACCOMMODATIONS.find((x) => x.id === id)
  const [idx, setIdx] = useState(0)
  if (!a) return null
  const img = a.images[idx] || a.images[0]

  return (
    <article className="bg-white rounded-[24px] overflow-hidden border border-forest-900/5 shadow-card">
      <div className="relative">
        <SmartImage src={img} alt={a.name} className="h-48 w-full object-cover" />
        {a.images.length > 1 ? (
          <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5">
            {a.images.map((src, i) => (
              <button
                key={src}
                type="button"
                aria-label={`Photo ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setIdx(i)
                }}
                className={`h-1.5 rounded-full transition ${
                  i === idx ? 'w-5 bg-cream-50' : 'w-1.5 bg-cream-50/50'
                }`}
              />
            ))}
          </div>
        ) : null}
        <div className="absolute top-3 left-3 z-10 flex gap-1.5">
          <span className="rounded-full bg-cream-50/95 text-forest-900 text-[10px] uppercase tracking-eyebrow px-2.5 py-1">
            {a.shortName}
          </span>
          {a.availableUnits ? (
            <span className="rounded-full bg-forest-800/90 text-cream-50 text-[10px] uppercase tracking-eyebrow px-2.5 py-1">
              {a.availableUnits} units
            </span>
          ) : null}
        </div>
        {a.images.length > 1 ? (
          <button
            type="button"
            className="absolute inset-0 z-0"
            aria-label="Next photo"
            onClick={() => setIdx((i) => (i + 1) % a.images.length)}
          />
        ) : null}
      </div>

      <div className="p-5">
        <h2 className="font-serif text-2xl text-forest-900">{a.name}</h2>
        <p className="mt-2 text-sm text-forest-800/80 leading-relaxed">{a.description}</p>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-forest-800">
          <span className="inline-flex items-center gap-1.5">
            <Users size={14} className="text-forest-600" /> {a.capacityLabel}
          </span>
          {a.id === 'main-house' ? (
            <span className="inline-flex items-center gap-1.5">
              <Bed size={14} className="text-forest-600" /> Private house
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {a.amenities.map((k) => {
            const meta = AMENITIES.find((x) => x.key === k)
            const Icon = AMENITY_ICONS[k]
            if (!meta) return null
            return (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full border border-forest-900/10 bg-forest-50 text-forest-800 px-2.5 py-1 text-[11px]"
              >
                {Icon ? <Icon size={12} className="text-forest-600" /> : null}
                {meta.label}
              </span>
            )
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-forest-900/5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-eyebrow text-forest-600">
              {a.priceIsPlaceholder ? 'Placeholder rate' : 'Rate'}
            </div>
            <div className="font-serif text-xl text-forest-900 mt-0.5">
              {a.priceLabel || 'Contact us'}
            </div>
          </div>
          <Link
            to={`/app/book?accommodation=${a.id}`}
            className="btn bg-forest-800 text-cream-50 hover:bg-forest-900 h-10 px-4 text-sm"
          >
            Book
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </article>
  )
}
