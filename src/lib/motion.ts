/**
 * Motion utilities for the immersive (CSS-only) depth layer.
 *
 * Everything here is decorative: hooks write `transform` styles onto DOM nodes
 * and never touch application state, routing or business logic. All effects
 *
 *   - are skipped entirely when the visitor prefers reduced motion,
 *   - use one shared passive scroll listener + one requestAnimationFrame tick,
 *   - remove their listeners and reset inline styles on unmount,
 *   - degrade to "no effect" in environments without matchMedia (jsdom).
 */
import { useEffect, useState, type RefObject } from 'react'

const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

export function useMediaQuery(query: string, fallback = false): boolean {
  const [on, setOn] = useState(() => (canQuery() ? window.matchMedia(query).matches : fallback))
  useEffect(() => {
    if (!canQuery()) return
    const mql = window.matchMedia(query)
    const update = () => setOn(mql.matches)
    update()
    // Safari < 14 only knows addListener/removeListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update)
      return () => mql.removeEventListener('change', update)
    }
    mql.addListener(update)
    return () => mql.removeListener(update)
  }, [query])
  return on
}

/** True when the OS/browser asks for reduced motion — parallax, tilt and Ken Burns are off. */
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')

/** True on touch-first devices; pointer-follow effects are disabled there (no hover-only UX). */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')

/** Pointer-driven depth (tilt / mouse parallax) — fine pointer, hover capable, motion allowed. */
export function usePointerDepthEnabled(): boolean {
  const reduced = usePrefersReducedMotion()
  const coarse = useCoarsePointer()
  const hover = useMediaQuery('(hover: hover)')
  return !reduced && !coarse && hover
}

/* ------------------------------------------------------------------ */
/* Shared scroll ticker: one passive listener, one rAF per frame.       */
/* ------------------------------------------------------------------ */
type Tick = () => void
const subscribers = new Set<Tick>()
let frame = 0

function flush() {
  frame = 0
  subscribers.forEach((tick) => tick())
}
function schedule() {
  if (frame) return
  frame = window.requestAnimationFrame(flush)
}
function attach() {
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
}
function detach() {
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
  if (frame) {
    window.cancelAnimationFrame(frame)
    frame = 0
  }
}

/** Run `tick` on every scroll/resize frame (batched). Returns an unsubscribe. */
export function onScrollFrame(tick: Tick): () => void {
  if (typeof window === 'undefined') return () => {}
  if (subscribers.size === 0) attach()
  subscribers.add(tick)
  schedule()
  return () => {
    subscribers.delete(tick)
    if (subscribers.size === 0) detach()
  }
}

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/**
 * Scroll progress of an element through the viewport: -1 when its centre is a
 * full half-viewport below the fold, 0 when centred, +1 when it has left above.
 */
export function viewportProgress(rect: DOMRect, viewportHeight: number): number {
  const centre = rect.top + rect.height / 2
  const travel = viewportHeight / 2 + rect.height / 2
  return travel > 0 ? clamp((viewportHeight / 2 - centre) / travel, -1, 1) : 0
}

/** `.parallax-media` bleeds 16% above and below its frame; shifts stay inside that. */
export const MAX_PARALLAX_RANGE = 0.12

/**
 * Parallax for media inside an `overflow-hidden` frame (the element's parent).
 * The media is 128% tall (see `.parallax-media`) so the shift never reveals
 * its edges. `range` is the max shift as a fraction of frame height and is
 * capped at MAX_PARALLAX_RANGE.
 */
export function useParallax(ref: RefObject<HTMLElement>, range = 0.1, enabled = true) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const frameEl = el.parentElement ?? el
    const safeRange = Math.min(Math.abs(range), MAX_PARALLAX_RANGE)
    const tick = () => {
      const vh = window.innerHeight || 1
      const rect = frameEl.getBoundingClientRect()
      if (rect.bottom < -vh || rect.top > vh * 2) return // far off-screen: skip the write
      // Never shift further than the media actually overhangs the frame
      // (borders shrink the percentage bleed), so no edge is ever exposed.
      const bleed = Math.max(0, (el.offsetHeight - rect.height) / 2 - 1)
      const y = clamp(viewportProgress(rect, vh) * safeRange * rect.height, -bleed, bleed)
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`
    }
    const off = onScrollFrame(tick)
    return () => {
      off()
      el.style.transform = ''
    }
  }, [ref, range, enabled])
}

/**
 * Pointer tilt for cards. Writes CSS custom properties (consumed by `.tilt`)
 * instead of transforms so the card's own transitions keep working. Enabled
 * only for fine pointers with motion allowed; touch devices keep a flat card.
 */
export function useTilt(ref: RefObject<HTMLElement>, enabled: boolean, max = 5) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let raf = 0
    let next: { x: number; y: number } | null = null
    const apply = () => {
      raf = 0
      if (!next) return
      const { x, y } = next
      el.style.setProperty('--tilt-x', `${(-(y - 0.5) * 2 * max).toFixed(2)}deg`)
      el.style.setProperty('--tilt-y', `${((x - 0.5) * 2 * max).toFixed(2)}deg`)
      el.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`)
      el.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`)
      el.style.setProperty('--shift-x', `${(-(x - 0.5) * 12).toFixed(1)}px`)
      el.style.setProperty('--shift-y', `${(-(y - 0.5) * 12).toFixed(1)}px`)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      next = { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }
      if (!raf) raf = window.requestAnimationFrame(apply)
    }
    const reset = () => {
      next = null
      if (raf) {
        window.cancelAnimationFrame(raf)
        raf = 0
      }
      el.style.removeProperty('--tilt-x')
      el.style.removeProperty('--tilt-y')
      el.style.removeProperty('--shift-x')
      el.style.removeProperty('--shift-y')
      el.style.setProperty('--glare-x', '50%')
      el.style.setProperty('--glare-y', '50%')
    }
    el.classList.add('tilt-live')
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', reset)
    el.addEventListener('pointercancel', reset)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', reset)
      el.removeEventListener('pointercancel', reset)
      el.classList.remove('tilt-live')
      reset()
    }
  }, [ref, enabled, max])
}

/**
 * Layered hero depth: scroll parallax (all pointer types) plus a soft
 * mouse-follow offset on fine pointers. Everything is transform/opacity only,
 * runs on the shared rAF tick, and stops once the hero has scrolled out.
 *
 *  - `section`: the hero (measures height / receives pointer events)
 *  - `back`:    background photo wrapper — moves slowest
 *  - `fore`:    foreground foliage — moves fastest, opposite direction
 *  - `content`: headline + CTA block — drifts and fades gently as you leave
 */
export function useHeroDepth(
  sectionRef: RefObject<HTMLElement>,
  backRef: RefObject<HTMLElement>,
  foreRef: RefObject<HTMLElement>,
  contentRef: RefObject<HTMLElement>,
  opts: { reducedMotion: boolean; pointer: boolean },
) {
  const { reducedMotion, pointer } = opts
  useEffect(() => {
    const section = sectionRef.current
    const back = backRef.current
    const fore = foreRef.current
    const content = contentRef.current
    if (!section || !back || !fore || !content || reducedMotion) return

    let px = 0
    let py = 0
    let scrollY = 0
    let raf = 0

    const paint = () => {
      raf = 0
      const h = section.offsetHeight || 1
      const s = clamp(scrollY, 0, h)
      const t = s / h
      back.style.transform = `translate3d(${(-px * 10).toFixed(1)}px, ${(s * 0.22 - py * 6).toFixed(1)}px, 0) scale(1.08)`
      fore.style.transform = `translate3d(${(px * 24).toFixed(1)}px, ${(-s * 0.1 + py * 14).toFixed(1)}px, 0)`
      content.style.transform = `translate3d(0, ${(s * 0.12).toFixed(1)}px, 0)`
      content.style.opacity = String(clamp(1 - t * 1.4, 0, 1))
    }
    const request = () => {
      if (!raf) raf = window.requestAnimationFrame(paint)
    }
    const offScroll = onScrollFrame(() => {
      const y = window.scrollY || 0
      if (y > (section.offsetHeight || 0) + 200 && scrollY > (section.offsetHeight || 0) + 200) return
      scrollY = y
      request()
    })

    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return
      const w = window.innerWidth || 1
      const h = window.innerHeight || 1
      px = clamp(e.clientX / w - 0.5, -0.5, 0.5)
      py = clamp(e.clientY / h - 0.5, -0.5, 0.5)
      request()
    }
    const onLeave = () => {
      px = 0
      py = 0
      request()
    }
    if (pointer) {
      section.addEventListener('pointermove', onMove, { passive: true })
      section.addEventListener('pointerleave', onLeave)
    }
    return () => {
      offScroll()
      section.removeEventListener('pointermove', onMove)
      section.removeEventListener('pointerleave', onLeave)
      if (raf) window.cancelAnimationFrame(raf)
      back.style.transform = ''
      fore.style.transform = ''
      content.style.transform = ''
      content.style.opacity = ''
    }
  }, [sectionRef, backRef, foreRef, contentRef, reducedMotion, pointer])
}
