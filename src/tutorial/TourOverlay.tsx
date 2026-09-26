// ----------------------------------------------------------------------------
// The interactive Guest tour — overlay
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The spotlight layer: four dim panels frame a see-through window around the
// highlighted control, so the real element stays fully interactive while the
// rest of the page is shielded from stray taps. The tooltip card explains what
// the control does and why, and holds the tour's navigation (Skip / Back /
// Continue / Exit). On phones the card docks as a bottom sheet; on larger
// screens it floats beside the highlight.
// ----------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react'
import { useTour } from './TourEngine'

const TIP_WIDTH = 400
const TIP_FALLBACK_H = 320

export function TourOverlay() {
  const tour = useTour()
  const tipRef = useRef<HTMLDivElement | null>(null)
  const [tipH, setTipH] = useState(TIP_FALLBACK_H)
  const [, setViewportTick] = useState(0)

  /* Re-measure the card whenever the step changes. */
  useEffect(() => {
    const el = tipRef.current
    if (!el) return
    const measure = () => setTipH(el.offsetHeight || TIP_FALLBACK_H)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tour.index, tour.missing])

  /* Re-position when the viewport itself changes. */
  useEffect(() => {
    const onResize = () => setViewportTick((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* Escape exits without remembering — the polite way out. */
  useEffect(() => {
    if (!tour.running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tour.exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour])

  if (!tour.running) return null

  const vw = window.innerWidth || 1024
  const vh = window.innerHeight || 768
  const { rect, step, index, total } = tour
  const isLast = index === total - 1
  const narrow = vw < 640

  /* Card placement: docked bottom-sheet on phones, floating beside the
     highlight on larger screens, centered when there is no highlight. */
  let tipStyle: React.CSSProperties
  if (narrow) {
    tipStyle = { left: 12, right: 12, bottom: 'max(12px, env(safe-area-inset-bottom))' }
  } else if (!rect) {
    tipStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: Math.min(TIP_WIDTH, vw - 32) }
  } else {
    const w = Math.min(TIP_WIDTH, vw - 24)
    const gap = 14
    const fitsBelow = rect.top + rect.height + gap + tipH < vh - 12
    const fitsAbove = rect.top - gap - tipH > 12
    const top = fitsBelow
      ? rect.top + rect.height + gap
      : fitsAbove
        ? rect.top - gap - tipH
        : Math.max(12, Math.min(vh - tipH - 12, rect.top + rect.height + gap))
    const centerX = rect.left + rect.width / 2
    tipStyle = {
      width: w,
      top,
      left: Math.max(12, Math.min(vw - w - 12, centerX - w / 2)),
    }
  }

  const dim = 'bg-forest-950/55 backdrop-blur-[2px]'
  const body = tour.missing && step.fallbackBody ? step.fallbackBody : step.body

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`Guest tour: ${step.title}`}>
      {/* Dim panels — they absorb stray clicks; the window over the target
          stays fully interactive. */}
      {rect ? (
        <>
          <div className={`absolute ${dim}`} style={{ top: 0, left: 0, right: 0, height: rect.top }} />
          <div className={`absolute ${dim}`} style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
          <div className={`absolute ${dim}`} style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <div
            className={`absolute ${dim}`}
            style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }}
          />
          <div
            aria-hidden
            className="absolute rounded-2xl border-2 border-cream-200/95 pointer-events-none tour-ring"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
        </>
      ) : (
        <div className={`absolute inset-0 ${dim}`} />
      )}

      {/* The tooltip card */}
  <div
        ref={tipRef}
        className="absolute bg-white rounded-[24px] shadow-card border border-forest-900/10 p-5 sm:p-6 max-h-[72vh] overflow-y-auto"
        style={tipStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="eyebrow">
            {step.eyebrow ?? 'Guest tour'} · Step {index + 1} of {total}
          </div>
          <button
            type="button"
            onClick={tour.exit}
            aria-label="Exit the tour"
            title="Exit (Esc) — the tour will offer itself again next visit"
            className="text-forest-500 hover:text-forest-900 -mt-1 -mr-1 px-2 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <h2 className="font-serif text-xl sm:text-2xl mt-1.5 text-forest-900">{step.title}</h2>
        <p className="mt-3 text-sm text-forest-800 leading-relaxed">{body}</p>

        {step.why && (
          <p className="mt-3 text-xs text-forest-700/80 leading-relaxed rounded-xl bg-cream-100/80 border border-forest-900/5 px-3 py-2.5">
            <span className="font-semibold text-forest-800">Why it matters:</span> {step.why}
          </p>
        )}

        {tour.awaiting && tour.awaitingHint && (
          <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-forest-50 bg-forest-700 rounded-full px-3 py-2">
            <span aria-hidden className="tour-nudge">☝</span> {tour.awaitingHint}
          </p>
        )}
        {tour.missing && step.targets && (
          <p className="mt-3 text-[11px] text-forest-600">
            The control this step highlights isn’t on screen right now — no problem, you can simply read along.
          </p>
        )}

        {/* Progress */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === index ? 'w-6 bg-forest-700' : i < index ? 'w-2.5 bg-forest-500/70' : 'w-2.5 bg-forest-900/15'
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!isLast && (
            <button type="button" className="btn-ghost text-xs" onClick={tour.skip}>
              Skip tour
            </button>
          )}
          {index > 0 && (
            <button type="button" className="btn-ghost text-xs" onClick={tour.back}>
              Back
            </button>
          )}

          <span className="flex-1" />

          {tour.awaiting ? (
            <button type="button" className="text-xs underline text-forest-600 hover:text-forest-900" onClick={tour.next}>
              Skip this step
            </button>
          ) : (
            <button type="button" autoFocus className="btn-primary text-xs" onClick={tour.next}>
              {isLast ? 'Finish' : step.continueLabel ?? 'Next'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
