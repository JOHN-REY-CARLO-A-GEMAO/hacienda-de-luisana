// ----------------------------------------------------------------------------
// The interactive Guest tour — overlay
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The spotlight layer: four dim panels frame a see-through window around the
// highlighted control, so the real element stays fully interactive while the
// rest of the page is shielded from stray taps. The tooltip card explains what
// the control does and why, and holds the tour's navigation (Skip / Back /
// Continue / Exit). On phones the card docks as a bottom sheet; on larger
// screens it floats beside the highlight — below, above, right or left,
// whichever fits — and if nothing fits, the page is nudged so the highlighted
// control is never left under the card.
//
// Hit-testing note: the overlay's root is `pointer-events: none`. Only the dim
// panels and the card take pointer events, so a tap inside the window lands
// on the real control underneath — a full-viewport root that took events
// would swallow it, whatever the panels leave open.
// ----------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTour } from './TourEngine'
import type { Rect } from './types'

const TIP_WIDTH = 400
/** Beside a wide highlight the card may slim down to this rather than cover it. */
const TIP_MIN_WIDTH = 280
const TIP_FALLBACK_H = 320
const GAP = 14
const MARGIN = 12
/** The fixed site header (h-16 / lg:h-20) plus breathing room. */
const HEADER_CLEARANCE = 96

type Side = 'below' | 'above' | 'right' | 'left' | 'fallback'
type Placement = { side: Side; top: number; left: number; width: number }

/** Where the card goes on a wide screen: the first side with room for it. */
export function placeCard(rect: Rect, tipH: number, vw: number, vh: number): Placement {
  const w = Math.min(TIP_WIDTH, vw - 2 * MARGIN)
  const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - w - MARGIN, x))
  const clampY = (y: number) => Math.max(MARGIN, Math.min(vh - tipH - MARGIN, y))
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const bottom = rect.top + rect.height
  const right = rect.left + rect.width

  if (bottom + GAP + tipH <= vh - MARGIN) {
    return { side: 'below', top: bottom + GAP, left: clampX(centerX - w / 2), width: w }
  }
  if (rect.top - GAP - tipH >= MARGIN) {
    return { side: 'above', top: rect.top - GAP - tipH, left: clampX(centerX - w / 2), width: w }
  }
  const roomRight = vw - MARGIN - (right + GAP)
  if (roomRight >= TIP_MIN_WIDTH) {
    return { side: 'right', top: clampY(centerY - tipH / 2), left: right + GAP, width: Math.min(w, roomRight) }
  }
  const roomLeft = rect.left - GAP - MARGIN
  if (roomLeft >= TIP_MIN_WIDTH) {
    const width = Math.min(w, roomLeft)
    return { side: 'left', top: clampY(centerY - tipH / 2), left: rect.left - GAP - width, width }
  }
  /* Nothing fits clear of the highlight (a panel wider and taller than the
     room around it): sit low and to the right so the panel's opening — where
     its heading and figures are — stays readable, and let the nudge scroll
     the highlight clear when it can. */
  return { side: 'fallback', top: clampY(bottom + GAP), left: clampX(vw - w - MARGIN), width: w }
}

/**
 * How far to scroll (positive = down) so `target` is clear of `card`, or 0
 * when they do not overlap. Moves the control into whichever free strip —
 * above the card or below it — has more room, and never under the header.
 */
export function nudgeDelta(target: Rect, card: Rect, vh: number): number {
  const tBottom = target.top + target.height
  const cBottom = card.top + card.height
  const overlapX = target.left < card.left + card.width && target.left + target.width > card.left
  const overlapY = target.top < cBottom && tBottom > card.top
  if (!overlapX || !overlapY) return 0

  const roomAbove = card.top - HEADER_CLEARANCE
  const roomBelow = vh - MARGIN - cBottom
  if (roomAbove >= roomBelow) {
    /* Bring the control's bottom above the card; keep its top under the header. */
    return Math.min(tBottom + GAP - card.top, target.top - HEADER_CLEARANCE)
  }
  /* Bring the control's top below the card; keep its bottom on screen. */
  return Math.max(target.top - cBottom - GAP, tBottom - (vh - MARGIN))
}

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

  const vw = typeof window !== 'undefined' ? window.innerWidth || 1024 : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight || 768 : 768
  const narrow = vw < 640

  /* Tell the engine how much of the screen the card takes, so its scroll puts
     each control in the free part: the whole card on phones (docked), only the
     header elsewhere (the card floats beside the highlight). */
  const insets = tour.insets
  useLayoutEffect(() => {
    if (!tour.running) return
    const cardH = tipRef.current?.offsetHeight || tipH
    insets.current = { top: HEADER_CLEARANCE, bottom: narrow ? cardH + 2 * MARGIN : 0 }
  })

  /* Latest highlight for the nudge timer below. */
  const rectRef = useRef<Rect | null>(tour.rect)
  rectRef.current = tour.rect

  /* One nudge per step, once the engine's own scroll has settled: if the card
     still covers the highlighted control, scroll the page until it doesn't. */
  useEffect(() => {
    if (!tour.running || tour.missing) return
    if (typeof window.requestAnimationFrame !== 'function' || typeof window.scrollBy !== 'function') return
    let raf = 0
    let lastY = window.scrollY
    let stable = 0
    let frames = 0
    const tick = () => {
      const y = window.scrollY
      stable = Math.abs(y - lastY) < 1 ? stable + 1 : 0
      lastY = y
      frames += 1
      const settled = stable >= 8 && frames >= 20 // ≈130 ms still, ≥330 ms since the step began
      const waiting = (!settled || rectRef.current === null) && frames < 120 // give up after ≈2 s
      if (waiting) {
        raf = window.requestAnimationFrame(tick)
        return
      }
      const target = rectRef.current
      const card = tipRef.current?.getBoundingClientRect()
      if (!target || !card || card.width === 0 || card.height === 0) return
      const delta = nudgeDelta(target, { top: card.top, left: card.left, width: card.width, height: card.height }, window.innerHeight)
      if (Math.abs(delta) >= 2) window.scrollBy({ top: delta, behavior: 'smooth' })
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [tour.running, tour.index, tour.missing])

  if (!tour.running) return null

  const { rect, step, index, total } = tour
  const isLast = index === total - 1

  /* Card placement: docked bottom-sheet on phones, floating beside the
     highlight on larger screens, centered when there is no highlight. */
  let tipStyle: React.CSSProperties
  if (narrow) {
    tipStyle = { left: MARGIN, right: MARGIN, bottom: 'max(12px, env(safe-area-inset-bottom))' }
  } else if (!rect) {
    tipStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: Math.min(TIP_WIDTH, vw - 32) }
  } else {
    const p = placeCard(rect, tipH, vw, vh)
    tipStyle = { width: p.width, top: p.top, left: p.left }
  }

  const dim = 'absolute pointer-events-auto bg-forest-950/55 backdrop-blur-[2px]'
  const body = tour.missing && step.fallbackBody ? step.fallbackBody : step.body

  return (
    <div
      className="fixed inset-0 z-[70] pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Guest tour: ${step.title}`}
    >
      {/* Dim panels — they absorb stray clicks; the window over the target
          stays fully interactive because the root itself takes no events. */}
      {rect ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, right: 0, height: rect.top }} />
          <div className={dim} style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
          <div className={dim} style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <div className={dim} style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />
          <div
            aria-hidden
            className="absolute rounded-2xl border-2 border-cream-200/95 pointer-events-none tour-ring"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
        </>
      ) : (
        <div className={`${dim} inset-0`} />
      )}

      {/* The tooltip card */}
      <div
        ref={tipRef}
        data-tour-card
        className="absolute pointer-events-auto bg-white rounded-[24px] shadow-card border border-forest-900/10 p-5 sm:p-6 max-h-[56vh] sm:max-h-[72vh] overflow-y-auto"
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
