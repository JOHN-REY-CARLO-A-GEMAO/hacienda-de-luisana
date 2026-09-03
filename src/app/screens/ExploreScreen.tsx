import { useCallback, useEffect, useMemo, useState } from 'react'
import { BUSINESS, GALLERY, NEARBY, type GalleryImage } from '../../config/site'
import { SmartImage } from '../../components/SmartImage'
import { ArrowRight, Close, Compass, MapPin } from '../../lib/icons'
import { Screen, ScreenTitle } from '../components/Screen'

type Tab = 'photos' | 'nearby' | 'map'

const TABS: { id: Tab; label: string }[] = [
  { id: 'photos', label: 'Photos' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'map', label: 'Map' },
]

export function ExploreScreen() {
  const [tab, setTab] = useState<Tab>('photos')
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const close = useCallback(() => setOpenIdx(null), [])
  const next = useCallback(
    () => setOpenIdx((i) => (i === null ? null : (i + 1) % GALLERY.length)),
    [],
  )
  const prev = useCallback(
    () => setOpenIdx((i) => (i === null ? null : (i - 1 + GALLERY.length) % GALLERY.length)),
    [],
  )

  useEffect(() => {
    if (openIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIdx, close, next, prev])

  const { lat, lng } = BUSINESS.coordinates
  const mapSrc = useMemo(
    () => `https://www.google.com/maps?q=${lat},${lng}&z=13&output=embed`,
    [lat, lng],
  )

  return (
    <Screen>
      <ScreenTitle eyebrow="Explore" title="The Hacienda & around" />

      <div className="flex gap-1.5 p-1 rounded-full bg-cream-100/80 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-full py-2 text-xs font-medium transition ${
              tab === t.id ? 'bg-forest-800 text-cream-50 shadow-sm' : 'text-forest-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'photos' ? (
        <div className="grid grid-cols-2 gap-2">
          {GALLERY.map((g, i) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setOpenIdx(i)}
              className="relative overflow-hidden rounded-2xl text-left"
              aria-label={g.caption}
            >
              <SmartImage
                src={g.url}
                alt={g.caption}
                aspect={g.aspect === 'wide' ? '4 / 3' : '3 / 4'}
                className="w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'nearby' ? (
        <div className="space-y-3">
          {NEARBY.map((n) => (
            <a
              key={n.id}
              href={n.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex gap-3 bg-white rounded-2xl overflow-hidden border border-forest-900/5"
            >
              <SmartImage src={n.image} alt={n.name} className="w-24 h-24 object-cover shrink-0" />
              <div className="py-3 pr-3 flex-1 min-w-0">
                <div className="font-serif text-lg text-forest-900 leading-tight">{n.name}</div>
                <p className="mt-1 text-xs text-forest-800/75 line-clamp-2">{n.description}</p>
                <div className="mt-1.5 text-[10px] uppercase tracking-eyebrow text-forest-600 inline-flex items-center gap-1">
                  <Compass size={11} /> Open in Maps
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {tab === 'map' ? (
        <div className="space-y-3">
          <div className="rounded-[22px] overflow-hidden border border-forest-900/5 bg-white">
            <iframe
              title="Hacienda de LuisAna on Google Maps"
              src={mapSrc}
              className="w-full h-64 border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
          <div className="bg-forest-900 text-cream-100 rounded-[22px] p-5">
            <div className="eyebrow text-cream-100/60">Address</div>
            <p className="mt-2 font-serif text-xl leading-snug">{BUSINESS.address.formatted}</p>
            <a
              href={BUSINESS.contact.directions}
              target="_blank"
              rel="noreferrer"
              className="btn bg-cream-50 text-forest-900 hover:bg-white mt-5 h-11"
            >
              <MapPin size={16} /> Get directions
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      ) : null}

      {openIdx !== null ? (
        <Lightbox image={GALLERY[openIdx]} index={openIdx} total={GALLERY.length} onClose={close} onPrev={prev} onNext={next} />
      ) : null}
    </Screen>
  )
}

function Lightbox({
  image,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  image: GalleryImage
  index: number
  total: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-forest-950/96 flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 h-14 text-cream-100 pt-[env(safe-area-inset-top)]">
        <div className="text-[11px] uppercase tracking-eyebrow text-cream-100/70">
          {image.category} · {index + 1}/{total}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-cream-100/10">
          <Close size={20} />
        </button>
      </div>
      <button type="button" className="flex-1 flex items-center justify-center px-4" onClick={onNext} aria-label="Next photo">
        <img src={image.url} alt={image.caption} className="max-h-[70vh] max-w-full object-contain rounded-lg" />
      </button>
      <p className="px-5 pb-2 text-center text-cream-100/85 text-sm">{image.caption}</p>
      <div className="flex justify-center gap-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onPrev} className="btn bg-cream-100/10 text-cream-100 h-10 px-5">
          Prev
        </button>
        <button type="button" onClick={onNext} className="btn bg-cream-100/10 text-cream-100 h-10 px-5">
          Next
        </button>
      </div>
    </div>
  )
}
