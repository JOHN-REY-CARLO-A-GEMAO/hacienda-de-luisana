import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GALLERY, type GalleryImage } from '../config/site'
import { asset } from '../lib/asset'
import { SmartImage } from '../components/SmartImage'
import { SceneHeader } from '../components/Scene'
import { ArrowRight, Close } from '../lib/icons'

/**
 * Scene 07 — the gallery preview.
 *
 * A fixed selection of photographs with the lightbox and nothing else. The
 * filter row and the whole set are on /gallery: a preview that carries the
 * filters would carry the full gallery's weight with it, and a visitor who
 * wants to browse by category has already decided they want to browse.
 *
 * The pictures are a hand-picked slice rather than the head of `GALLERY`,
 * because the head of `GALLERY` is grouped by category for the filter row and
 * its order is not a judgement about which photograph sells the place.
 */

/** One from each category, so the preview shows the range rather than a run. */
const PREVIEW_IDS = ['g07', 'g01', 'g02', 'g05', 'g03', 'g14'] as const

/** How many of those to show. Six reads as a taster without becoming a wall. */
const PREVIEW_COUNT = 6

export function GalleryPreview() {
  const [open, setOpen] = useState<GalleryImage | null>(null)
  const shown = PREVIEW_IDS.map((id) => GALLERY.find((g) => g.id === id)).filter(
    (g): g is GalleryImage => Boolean(g),
  )

  return (
    <section id="gallery" className="py-20 lg:py-28 bg-cream-50">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <SceneHeader index="07" eyebrow="Gallery" title="A Glimpse of the Hacienda" />
          <Link to="/gallery" className="reveal btn-ghost shrink-0 group self-start lg:self-auto lg:mb-2">
            See all {GALLERY.length} photos
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-3 gap-4">
          {shown.slice(0, PREVIEW_COUNT).map((g) => (
            <button
              key={g.id}
              onClick={() => setOpen(g)}
              className="block w-full overflow-hidden rounded-2xl group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-600 aspect-[4/3] bg-white shadow-card lg:hover:shadow-depth transition-all duration-700 ease-out-expo"
              aria-label={`Open ${g.caption}`}
            >
              <SmartImage
                src={g.url}
                alt={g.caption}
                aspect="4 / 3"
                className="w-full h-full object-cover transition-transform duration-[1400ms] ease-out-expo group-hover:scale-[1.05]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-forest-950/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
              <div className="absolute bottom-3 left-3 right-3 text-left text-cream-50 text-xs opacity-0 group-hover:opacity-100 transition">
                {g.caption}
              </div>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-forest-950/95 backdrop-blur-sm flex items-center justify-center animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={open.caption}
        >
          <button
            onClick={() => setOpen(null)}
            className="absolute top-5 right-5 p-2 rounded-full text-cream-100 hover:bg-cream-100/10 transition"
            aria-label="Close"
          >
            <Close size={22} />
          </button>
          <img
            src={asset(open.url)}
            alt={open.caption}
            className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-soft"
          />
          <div className="absolute bottom-6 left-5 right-5 text-center text-cream-100/85 text-sm px-5">
            {open.caption}
            <Link to="/gallery" className="mt-2 block text-cream-50 underline underline-offset-4">
              See all {GALLERY.length} photos
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}