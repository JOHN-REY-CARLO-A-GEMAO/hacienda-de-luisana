// ----------------------------------------------------------------------------
// The interactive Guest tutorial — mount point
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// Not a slideshow: a guided walkthrough of the real Guest UI. The engine
// (src/tutorial) highlights the actual Booking button, date fields, terms
// checkbox and so on, and waits for the Guest to use each one before moving
// on. Completion is remembered in the same cookie the old slideshow used, so
// returning Guests are not asked again; "Replay tutorial" starts it over.
// ----------------------------------------------------------------------------

import { useCallback } from 'react'
import { COOKIE, getCookie, setCookie } from '../lib/cookies'
import { GUEST_TOUR_STEPS } from '../tutorial/steps'
import { TourProvider, useTour } from '../tutorial/TourEngine'
import { TourOverlay } from '../tutorial/TourOverlay'
import { Help } from '../lib/icons'

/** localStorage mirrors the cookie: some in-app webviews drop cookies. */
const LS_KEY = 'hdl_tutorial_done'

function tourCompleted(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY) === '1') return true
  } catch {
    /* private modes */
  }
  return getCookie(COOKIE.tutorialDone) === '1'
}

function rememberTourCompleted() {
  setCookie(COOKIE.tutorialDone, '1', { days: 180, sameSite: 'Lax' })
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, '1')
  } catch {
    /* private modes */
  }
}

/**
 * The way back into the tour.
 *
 * It used to be one fixed pill at `bottom-20 — 80 px up the screen, in the middle
 * of the reading band — where it covered the A-House price and the second line of
 * the Team Building description as they scrolled past. Making it smaller only
 * moves the problem: this site right-aligns prices and runs paragraphs to the
 * full column width, so any control floating over the page sits on top of some
 * text at some scroll position, and the bottom of the viewport is where a phone
 * reads.
 *
 * So on a phone the way back is part of the page, not over it: a full-width row
 * at the foot of every page, where nothing can slide underneath it, sized for a
 * thumb and inside the safe area on a notched screen. From `lg` up the layout has
 * margins a floating pill can sit in without covering the column, and that is
 * what a pointer expects to find in the corner.
 *
 * Both carry the same accessible name; only one of them is rendered at a time
 * (`display: none` also takes the other one out of the accessibility tree).
 */
const REPLAY_LABEL = 'How to Book: Replay tutorial'

function ReplayButton() {
  const tour = useTour()
  if (tour.running) return null
  return (
    <>
      {/* Phone and tablet: the last row of the document, after the footer. */}
      <div className="lg:hidden border-t border-forest-900/10 bg-cream-50 dark:border-cream-100/10 dark:bg-forest-950">
        <div className="mx-auto max-w-7xl px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={tour.start}
            aria-label={REPLAY_LABEL}
            title="How to Book: Launch the interactive guide"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-forest-900/15 px-4 py-3 text-xs font-medium text-forest-800 transition hover:border-forest-800/40 hover:bg-white dark:border-cream-100/15 dark:text-cream-100 dark:hover:bg-forest-900"
          >
            <Help size={16} className="text-forest-500 dark:text-cream-200/70" />
            <span>Replay the How to Book tour</span>
          </button>
        </div>
      </div>

      {/* Desktop: a pill in the margin, clear of the reading column. */}
      <button
        type="button"
        onClick={tour.start}
        aria-label={REPLAY_LABEL}
        title="How to Book: Launch the interactive guide"
        className="hidden lg:inline-flex fixed bottom-6 right-4 z-30 items-center gap-1.5 rounded-full border border-cream-100/20 bg-forest-800 px-3.5 py-2 text-xs font-medium text-cream-50 shadow-float transition-all duration-300 hover:bg-forest-900 dark:bg-forest-700 dark:hover:bg-forest-600"
      >
        <span className="text-sage-300">How to Book ·</span>
        <span>Replay tutorial</span>
      </button>
    </>
  )
}

export function Tutorial({ force }: { force?: boolean }) {
  const done = useCallback(() => rememberTourCompleted(), [])
  const exited = useCallback(() => {
    /* Exit (× / Esc) remembers nothing — the tour offers itself next visit. */
  }, [])

  return (
    <TourProvider steps={GUEST_TOUR_STEPS} autoOpen={Boolean(force) || !tourCompleted()} onDone={done} onExit={exited}>
      <TourOverlay />
      <ReplayButton />
    </TourProvider>
  )
}
