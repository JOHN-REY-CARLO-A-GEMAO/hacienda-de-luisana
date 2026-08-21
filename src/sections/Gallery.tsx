import { useEffect, useMemo, useState, useCallback } from 'react'
import { GALLERY, GalleryImage } from '../config/site'
import { SmartImage } from '../components/SmartImage'
import { Close, ArrowRight } from '../lib/icons'

const CATEGORIES = ['All', 'Hacienda', 'Main House', 'Camping', 'Outdoors', 'Food & Gatherings', 'Nearby Adventures'] as const

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

  useEffect(() => {
    if (openIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [openIdx, close, next, prev])

  return (
    <section id="gallery" className="py-24 lg:py-36 bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 reveal">
          <div>
            <div className="eyebrow">Gallery</div>
            <h2 className="display text-4xl sm:text-5xl lg:text-6xl mt-4 text-forest-900">
              A Glimpse of the
              <br />
              <span className="italic font-light">Hacienda</span>
            </h2>
          </div>

          <div className="-mx-5 lg:mx-0 overflow-x-auto no-scrollbar">
            <div className="px-5 lg:px-0 flex gap-2 min-w-max">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`px-4 py-2 rounded-full text-xs uppercase tracking-eyebrow border transition ${
                    cat === c
                      ? 'bg-forest-800 text-cream-50 border-forest-800'
                      : 'bg-white text-forest-800 border-forest-900/10 hover:border-forest-800/50'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 columns-2 md:columns-3 lg:columns-4 gap-4 [column-fill:_balance]">
          {filtered.map((g, i) => (
            <button
              key={g.id}
              onClick={() => setOpenIdx(i)}
              className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-2xl group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600"
              aria-label={`Open ${g.caption}`}
            >
              <SmartImage
                src={g.url}
                alt={g.caption}
                aspect={g.aspect === 'tall' ? '3 / 4' : g.aspect === 'wide' ? '4 / 3' : '1 / 1'}
                className="w-full object-cover transition-transform duration-[1400ms] ease-out-expo group-hover:scale-[1.05]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-forest-950/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
              <div className="absolute bottom-3 left-3 right-3 text-left text-cream-50 text-xs opacity-0 group-hover:opacity-100 transition">
                {g.caption}
              </div>
            </button>
          ))}
        </div>
      </div>

      {openIdx !== null && (
        <Lightbox
          image={filtered[openIdx]}
          index={openIdx}
          total={filtered.length}
          onClose={close}
          onPrev={prev}
          onNext={next}
        />
      )}
    </section>
  )
}

function Lightbox({
  image, index, total, onClose, onPrev, onNext,
}: {
  image: GalleryImage
  index: number
  total: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-forest-950/95 backdrop-blur-sm flex flex-col animate-fade-in"
      role="dialog"
      aria-modal="true"
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
          src={image.url}
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
        <button onClick={onPrev} className="btn bg-cream-100/10 text-cream-100">Prev</button>
        <button onClick={onNext} className="btn bg-cream-100/10 text-cream-100">Next</button>
      </div>
    </div>
  )
}
