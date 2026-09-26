// ----------------------------------------------------------------------------
// The interactive Guest tour — engine
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// A small state machine that runs the tour script (steps.ts) against the live
// website. It navigates to the route a step lives on, finds the step's anchor
// (`data-tour="…"`) in the real page, keeps a spotlight over it while the Guest
// scrolls or resizes, and listens — without ever intercepting — for the
// interaction the step asks for: a real click, real dates, a real checkbox.
// Events are observed in the capture phase and left untouched, so the
// highlighted control always behaves exactly as it would without a tour.
// ----------------------------------------------------------------------------

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Rect, TourStep } from './types'

/** Custom window event the app may raise to satisfy an `event` step. */
export const TOUR_EVENT = 'hdl-tour'

export function emitTourEvent(name: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { name } }))
}

export type TourContextValue = {
  running: boolean
  step: TourStep
  index: number
  total: number
  /** Spotlight rect (viewport coords, padded), or null when nothing is highlighted. */
  rect: Rect | null
  /** The step's anchor could not be found; the card degraded gracefully. */
  missing: boolean
  /** True while the step still waits for the Guest to use the highlighted control. */
  awaiting: boolean
  awaitingHint: string | null
  /** (Re)start the tour from step one. */
  start: () => void
  /** Continue an informational step / skip an interactive one. */
  next: () => void
  back: () => void
  /** Finish early and remember the tour as done. */
  skip: () => void
  /** Close without remembering — the tour offers itself again next visit. */
  exit: () => void
  /**
   * Viewport space the overlay's own card takes (the docked bottom sheet on
   * phones, the fixed site header on top). The overlay writes it; the engine
   * scrolls each step's control into the part of the screen that is left.
   */
  insets: React.MutableRefObject<ViewportInsets>
}

export type ViewportInsets = { top: number; bottom: number }

const TourContext = createContext<TourContextValue | null>(null)

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within TourProvider')
  return ctx
}

/* --------------------------------------------------------------------------
 * Target resolution
 * ------------------------------------------------------------------------ */

const PAD = 6

function isVisible(el: HTMLElement): boolean {
  if (typeof el.getClientRects !== 'function' || el.getClientRects().length === 0) return false
  const r = el.getBoundingClientRect()
  if (r.width <= 2 || r.height <= 2) return false
  try {
    const cs = window.getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
  } catch {
    /* jsdom and friends */
  }
  return true
}

function findTarget(step: TourStep): HTMLElement | null {
  if (typeof document === 'undefined' || !step.targets) return null
  for (const name of step.targets) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
      if (isVisible(el)) return el
    }
  }
  return null
}

function paddedRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return {
    top: Math.max(0, r.top - PAD),
    left: Math.max(0, r.left - PAD),
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  }
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

function fieldValue(field: string): string {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-tour-field="${field}"]`)
  return el?.value ?? ''
}

/* jsdom (and very old webviews) lack rAF; a setTimeout shim keeps the
   spotlight loop alive everywhere. */
const requestFrame: (cb: (t: number) => void) => number =
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
    ? (cb) => window.requestAnimationFrame(cb)
    : (cb) => window.setTimeout(() => cb(Date.now()), 16) as unknown as number

const cancelFrame: (id: number) => void =
  typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
    ? (id) => window.cancelAnimationFrame(id)
    : (id) => window.clearTimeout(id)

function scrollTowards(el: HTMLElement, insets: ViewportInsets) {
  try {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return // no layout (jsdom) — nothing to scroll to
    const vh = window.innerHeight || 800
    /* The band of the screen not covered by the site header or the tour card. */
    const freeTop = insets.top
    const free = Math.max(160, vh - insets.bottom - freeTop)
    if (r.top > freeTop + free * 0.15 && r.bottom < freeTop + free * 0.75) return
    /* Centre the control in the free band; a control taller than the band
       sits with its top just inside it instead, so its first fields show. */
    const delta =
      r.height > free * 0.6 ? r.top - (freeTop + 16) : r.top + r.height / 2 - (freeTop + free / 2)
    if (Math.abs(delta) < 2) return
    if (typeof window.scrollBy === 'function') window.scrollBy({ top: delta, behavior: 'smooth' })
    else if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch {
    /* scrolling is a courtesy, never a failure */
  }
}

/** How long a step looks for its anchor before degrading to a plain card. */
const MISSING_GRACE_MS = 2400

export function TourProvider({
  steps,
  autoOpen = false,
  onDone,
  onExit,
  children,
}: {
  steps: TourStep[]
  /** Open the tour on mount (first visit). */
  autoOpen?: boolean
  /** The tour was finished or skipped — persist completion here. */
  onDone: () => void
  /** Closed without completing; nothing is remembered. */
  onExit: () => void
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [running, setRunning] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [missing, setMissing] = useState(false)
  const insets = useRef<ViewportInsets>({ top: 0, bottom: 0 })

  const step = steps[Math.min(index, steps.length - 1)]

  /* Live refs so long-lived listeners always see the freshest values. */
  const stepRef = useRef(step)
  stepRef.current = step
  const indexRef = useRef(index)
  indexRef.current = index
  const missingRef = useRef(missing)
  missingRef.current = missing

  const go = useCallback((nextIndex: number) => {
    setMissing(false)
    setIndex(nextIndex)
  }, [])

  const finish = useCallback(() => {
    setRunning(false)
    onDone()
  }, [onDone])

  const exit = useCallback(() => {
    setRunning(false)
    onExit()
  }, [onExit])

  const start = useCallback(() => {
    setMissing(false)
    setIndex(0)
    setRunning(true)
  }, [])

  const next = useCallback(() => {
    if (indexRef.current >= steps.length - 1) finish()
    else go(indexRef.current + 1)
  }, [steps.length, finish, go])

  const back = useCallback(() => {
    if (indexRef.current > 0) go(indexRef.current - 1)
  }, [go])

  const nextRef = useRef(next)
  nextRef.current = next

  /* First-visit auto-open. */
  useEffect(() => {
    if (autoOpen) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Keep the promised route: a step that lives on another page takes the
     Guest there itself, so the tour cannot sit on the wrong screen. */
  useEffect(() => {
    if (!running || !step.route) return
    if (location.pathname !== step.route) navigate(step.route)
  }, [running, step, location.pathname, navigate])

  /* Spotlight tracking: an rAF loop while the tour runs keeps the highlight
     glued to its element through scrolling, resizing and layout shifts. */
  useEffect(() => {
    if (!running) {
      setRect(null)
      setMissing(false)
      return
    }
    let rafId = 0
    const startedAt = Date.now()
    const tick = () => {
      const current = stepRef.current
      const el = findTarget(current)
      if (el) {
        const r = paddedRect(el)
        setRect((prev) => (sameRect(prev, r) ? prev : r))
      } else {
        setRect((prev) => (prev === null ? prev : null))
        if (Date.now() - startedAt > MISSING_GRACE_MS && current.targets) setMissing(true)
      }
      rafId = requestFrame(tick)
    }
    rafId = requestFrame(tick)
    return () => cancelFrame(rafId)
  }, [running, index])

  /* Bring the freshly highlighted control into view on each new step. */
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => {
      const el = findTarget(stepRef.current)
      if (el) scrollTowards(el, insets.current)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [running, index])

  /* Advance only from the step that actually fired — a late event from a step
     already left behind must not skip the next one. */
  const advanceFrom = useCallback(
    (fromIndex: number, delayMs: number) => {
      window.setTimeout(() => {
        if (indexRef.current === fromIndex) nextRef.current()
      }, delayMs)
    },
    [],
  )

  /* Re-evaluate satisfiable steps once on activation: pressing Back onto a
     step whose gesture already happened (dates still filled, terms still
     ticked) must not strand the Guest waiting for an event that won't refire. */
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => {
      const s = stepRef.current
      const aw = s.await
      if (missingRef.current || !aw) return
      if (aw.type === 'fields') {
        const reqs = aw.fields
        const all: Record<string, string> = {}
        for (const r of reqs) all[r.field] = fieldValue(r.field)
        if (reqs.length > 0 && reqs.every((r) => r.ok(all[r.field] ?? '', all))) {
          advanceFrom(indexRef.current, 250)
        }
      } else if (aw.type === 'checked' && s.targets) {
        for (const name of s.targets) {
          const box = document.querySelector<HTMLInputElement>(
            `[data-tour="${name}"] input[type="checkbox"], [data-tour="${name}"] input[type="radio"]`,
          )
          if (box?.checked) {
            advanceFrom(indexRef.current, 250)
            break
          }
        }
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [running, index, location.pathname, advanceFrom])

  /* The interaction listeners. Nothing is ever prevented or stopped: the
     highlighted control behaves exactly as it does without a tour. */
  useEffect(() => {
    if (!running) return

    const interactive = () => {
      const s = stepRef.current
      return Boolean(s.await && s.await.type !== 'none' && !missingRef.current)
    }

    const targetName = (e: Event): string | null => {
      const el = (e.target as Element | null)?.closest?.('[data-tour]')
      return el?.getAttribute('data-tour') ?? null
    }

    const onClick = (e: Event) => {
      const s = stepRef.current
      if (!interactive() || s.await!.type !== 'click' || !s.targets) return
      const name = targetName(e)
      if (name && s.targets.includes(name)) advanceFrom(indexRef.current, 300)
    }

    const onChecked = (e: Event) => {
      const s = stepRef.current
      if (!interactive() || s.await!.type !== 'checked' || !s.targets) return
      const name = targetName(e)
      if (!name || !s.targets.includes(name)) return
      const box = e.target as HTMLInputElement
      /* Heard on both `change` and `click`: browsers toggle a checkbox in the
         legacy pre-activation phase, so `checked` already reads true here. */
      if ((box.type === 'checkbox' || box.type === 'radio') && box.checked) {
        advanceFrom(indexRef.current, 250)
      }
    }

    const checkFields = () => {
      const s = stepRef.current
      const aw = s.await
      if (!interactive() || !aw || aw.type !== 'fields') return
      const reqs = aw.fields
      const all: Record<string, string> = {}
      for (const r of reqs) all[r.field] = fieldValue(r.field)
      if (reqs.every((r) => r.ok(all[r.field] ?? '', all))) advanceFrom(indexRef.current, 250)
    }

    const onTourEvent = (e: Event) => {
      const s = stepRef.current
      const aw = s.await
      if (!interactive() || !aw || aw.type !== 'event') return
      if ((e as CustomEvent).detail?.name === aw.name) advanceFrom(indexRef.current, 250)
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('change', onChecked, true)
    document.addEventListener('click', onChecked, true)
    document.addEventListener('input', checkFields, true)
    document.addEventListener('change', checkFields, true)
    window.addEventListener(TOUR_EVENT, onTourEvent)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('change', onChecked, true)
      document.removeEventListener('click', onChecked, true)
      document.removeEventListener('input', checkFields, true)
      document.removeEventListener('change', checkFields, true)
      window.removeEventListener(TOUR_EVENT, onTourEvent)
    }
  }, [running, advanceFrom])

  const value = useMemo<TourContextValue>(() => {
    const interactive = Boolean(step.await && step.await.type !== 'none' && !missing)
    return {
      running,
      step,
      index,
      total: steps.length,
      rect,
      missing,
      awaiting: interactive,
      awaitingHint: interactive ? step.actionHint ?? null : null,
      start,
      next,
      back,
      skip: finish,
      exit,
      insets,
    }
  }, [running, step, index, steps.length, rect, missing, start, next, back, finish, exit])

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}
