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

function ReplayButton() {
  const tour = useTour()
  if (tour.running) return null
  return (
    <button
      type="button"
      onClick={tour.start}
      className="fixed bottom-20 right-4 z-30 text-[11px] px-3 py-2 rounded-full bg-forest-900 text-cream-50 shadow-card hover:bg-forest-800 transition-colors lg:bottom-6"
    >
      Replay tutorial
    </button>
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
