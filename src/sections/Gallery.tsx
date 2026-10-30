import { Container } from '../components/ui'
import { useOverlay } from '../components/ui/overlay'
import { useEffect, useMemo, useRef, useState, useCallback, type RefObject } from 'react'
import { GALLERY, GalleryImage } from '../config/site'
import { asset } from '../lib/asset'
import { SmartImage } from '../components/SmartImage'
import { SceneHeader } from '../components/Scene'
import { Close, ArrowRight } from '../lib/icons'

const CATEGORIES = ['All', 'Hacienda', 'Main House', 'Annex', 'Camping', 'Outdoors', 'Food & Gatherings', 'Nearby Adventures'] as const

// A filter a guest can click that then shows nothing is a dead end, so the row
// carries only the categories the Gallery actually holds. "Food & Gatherings"
// and "Nearby Adventures" appear here on their own — the moment such a photo is
// added to GALLERY in src/config/site.ts — with no change to this component.
export const TABS = CATEGORIES.filter((c) => c === 'All' || GALLERY.some((g) => g.category === c))

export function Gallery() {
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>('All')
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  const filtered = useMemo(
    () => (cat === 'All' ? GALLERY : GALLERY.filter((g) => g.category === cat)),
    [cat],
  )

  const close = useCallback(() => setOpenIdx(null), [])
  const next = useCallback(
    () => setOpenIdx((i) => (i === null ? null : (i + 1) % filtered.length)),
    [filtered.length],
  )
  const prev = useCallback(
    () => setOpenIdx((i) => (i === null ? null : (i - 1 + filtered.length) % filtered.length)),
    [filtered.length],
  )

  // Escape, the scroll lock and the focus trap belong to the shared overlay
  // (`useOverlay`); this handles only the keys that are the lightbox's own.
  useEffect(() => {
    if (openIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIdx, next, prev])

  const lightboxRef = useRef<HTMLDivElement>(null)
  useOverlay(openIdx !== null, close, lightboxRef)

  return (
    <section id="gallery" className="section-full bg-cream-50 dark:bg-forest-950 transition-colors duration-300">
      <Container width="wide">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <SceneHeader index="04" eyebrow="Gallery" title={<>A Glimpse of the<br /><span className="italic font-normal">Hacienda</span></>} />

          <div className="-mx-5 min-w-0 lg:mx-0 overflow-x-auto no-scrollbar">
            <div className="px-5 lg:px-0 flex gap-2 min-w-max">
              {TABS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  aria-pressed={cat === c}
                  className={`px-4 py-2 rounded-full text-xs uppercase tracking-eyebrow border transition ${
                    cat === c
                      ? 'bg-forest-800 text-cream-50 border-forest-800 dark:bg-cream-100 dark:text-forest-950 dark:border-cream-100'
                      : 'bg-white text-forest-800 border-forest-900/10 hover:border-forest-800/50 dark:bg-forest-900 dark:text-cream-100 dark:border-cream-100/20 dark:hover:border-cream-100/60'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((g, i) => (
            <button
              key={g.id}
              onClick={() => setOpenIdx(i)}
              className="block w-full overflow-hidden rounded-2xl group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 dark:focus-visible:ring-brass-400 aspect-[4/3] bg-white dark:bg-forest-900 shadow-card lg:hover:shadow-depth lg:hover:-translate-y-1 transition-all duration-700 ease-out-expo"
              aria-label={`Open ${g.caption}`}
            >
              <SmartImage
                src={g.url}
                alt={g.caption}
                aspect="4 / 3"
                className="w-full h-full object-cover transition-transform duration-[1400ms] ease-out-expo group-hover:scale-[1.05]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-forest-950/90 via-forest-950/10 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3 text-left text-cream-50 text-xs">
                {g.caption}
              </div>
            </button>
          ))}
        </div>
      </Container>

      {openIdx !== null && (
        <Lightbox
          image={filtered[openIdx]}
          index={openIdx}
          total={filtered.length}
          onClose={close}
          onPrev={prev}
          onNext={next}
          panel={lightboxRef}
        />
      )}
    </section>
  )
}

function Lightbox({
  image, index, total, onClose, onPrev, onNext, panel,
}: {
  image: GalleryImage
  index: number
  total: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  panel: RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={panel}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-forest-950/95 backdrop-blur-sm outline-none animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`${image.category} — photograph ${index + 1} of ${total}`}
    >
      <div className="flex items-center justify-between px-5 lg:px-8 h-16 text-cream-100">
        <div className="text-xs uppercase tracking-eyebrow text-cream-100/70">
          {image.category} • {index + 1}/{total}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-2 rounded-full hover:bg-cream-100/10 transition"
        >
          <Close size={22} />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-5 lg:px-14 pb-6 relative">
        <button
          onClick={onPrev}
          aria-label="Previous"
          className="hidden md:flex absolute left-4 lg:left-8 top-1/2 -translate-y-1/2 p-3 rounded-full bg-cream-100/10 hover:bg-cream-100/20 text-cream-100 transition rotate-180"
        >
          <ArrowRight size={22} />
        </button>

        <img
          src={asset(image.url)}
          alt={image.caption}
          className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-soft"
        />

        <button
          onClick={onNext}
          aria-label="Next"
          className="hidden md:flex absolute right-4 lg:right-8 top-1/2 -translate-y-1/2 p-3 rounded-full bg-cream-100/10 hover:bg-cream-100/20 text-cream-100 transition"
        >
          <ArrowRight size={22} />
        </button>
      </div>

      <div className="px-5 lg:px-8 pb-6 text-center text-cream-100/85 text-sm">
        {image.caption}
      </div>

      <div className="md:hidden flex justify-center gap-4 pb-8">
        <button onClick={onPrev} className="btn-secondary btn-sm">Prev</button>
        <button onClick={onNext} className="btn-secondary btn-sm">Next</button>
      </div>
    </div>
  )
}
