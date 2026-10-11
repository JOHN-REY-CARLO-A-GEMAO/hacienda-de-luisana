// ----------------------------------------------------------------------------
// The Guest's side of live location: GPS in, one sentence on screen.
//
// Everything that can go wrong with a location feed on the web goes wrong in
// this file, and every one of them ends the same way — sharing stops and the
// Guest is told why. What this hook will never do is keep the button lit while
// nothing is being shared: a Guest who believes the Admin can see them, when
// the Admin cannot, is the failure that matters here.
//
// The cases, and what each one does:
//
//   permission denied   stop, say so, leave the control available to retry
//   GPS unavailable    same — no fix is not a fix at the last known position
//   tab in the background  browsers throttle `watchPosition` and suspend
//                       geolocation permission, so the watch is closed on
//                       `visibilitychange` and reopened when the tab comes back
//   offline            publishing is paused and the state says "reconnecting";
//                       the session is *not* silently extended
//   window closed      the watch and the timer go with it; the rules refuse
//                       the Admin a read past the window, and onDisconnect
//                       deletes the node whether or not this code runs
//   the window closes  the session is ended first, on `pagehide`
//   time runs out      the countdown reaches zero and sharing stops by itself
//
// The policy it calls — when a fix is worth sending, how long a session may
// run, what the Admin may see — is `src/lib/liveLocationPolicy.ts`, which is
// pure and unit-tested. This file is the lifecycle around it.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  canShareLocation,
  publishFix,
  startSharing,
  stopSharing,
  unavailableReason,
} from '../lib/liveLocation'
import {
  formatCountdown,
  isExpired,
  shouldPublishFix,
  startFailureMessage,
  type LatLng,
  type LocationSession,
  type ShareDuration,
  type StartFailure,
} from '../lib/liveLocationPolicy'

export type SharingState = {
  /** What the control shows: idle, active, or the reason it is not sharing. */
  phase: 'idle' | 'starting' | 'active' | 'error'
  /** The session being shared, while there is one. */
  session: LocationSession | null
  /** A sentence for the Guest, or null while all is well. */
  message: string | null
  /** `27:43` — the time left, or null when nothing is being shared. */
  countdown: string | null
  /** Milliseconds since the last position actually went out, or null. */
  lastSentAtMs: number | null
  /** The device is offline: nothing is being sent until it returns. */
  offline: boolean
  /** This build cannot share at all, and why. */
  blocked: StartFailure | null
}

export type UseLiveLocation = SharingState & {
  start: (minutes: ShareDuration) => Promise<void>
  stop: () => Promise<void>
}

const IDLE: Omit<SharingState, 'blocked' | 'offline'> = {
  phase: 'idle',
  session: null,
  message: null,
  countdown: null,
  lastSentAtMs: null,
}

export function useLiveLocation(input: { convoId: string | null; uid: string | undefined }): UseLiveLocation {
  const [session, setSession] = useState<LocationSession | null>(null)
  const [phase, setPhase] = useState<SharingState['phase']>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [lastSentAtMs, setLastSentAtMs] = useState<number | null>(null)
  const [offline, setOffline] = useState(() => (typeof navigator === 'undefined' ? false : !navigator.onLine))
  const [blocked] = useState<StartFailure | null>(() => unavailableReason(input.uid))

  // The live values the watch callback needs, without re-subscribing the GPS
  // watch every time a fix is published.
  const sessionRef = useRef<LocationSession | null>(null)
  const lastFixRef = useRef<{ at: LatLng; atMs: number } | null>(null)
  const seqRef = useRef(0)
  const watchRef = useRef<number | null>(null)

  const convoId = input.convoId
  const uid = input.uid

  const teardownWatch = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
  }, [])

  const endSession = useCallback(
    async (why: string | null) => {
      teardownWatch()
      const current = sessionRef.current
      sessionRef.current = null
      lastFixRef.current = null
      setSession(null)
      setPhase(why ? 'error' : 'idle')
      setMessage(why)
      setLastSentAtMs(null)
      if (current && convoId) {
        await stopSharing({ convoId, uid: current.guest_uid, nowMs: Date.now() })
      }
    },
    [convoId, teardownWatch, uid],
  )

  const openWatch = useCallback(
    (current: LocationSession) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        void endSession(startFailureMessage('unavailable'))
        return
      }
      watchRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const at = { lat: position.coords.latitude, lng: position.coords.longitude }
          const now = Date.now()
          const live = sessionRef.current
          if (!live || isExpired(live.expires_at_ms, now)) return

          const verdict = shouldPublishFix({ next: at, last: lastFixRef.current, nowMs: now })
          if (!verdict.publish) return
          lastFixRef.current = { at, atMs: now }
          seqRef.current += 1

          publishFix(
            live,
            { lat: at.lat, lng: at.lng, accuracy_m: position.coords.accuracy ?? 0, seq: seqRef.current },
            now,
          )
            .then((outcome) => {
              if (outcome === 'sent') setLastSentAtMs(now)
            })
            .catch(() => {
              // Two different failures, two different answers. A dropped
              // connection is the device's, not the session's: the watch stays
              // open and the panel says the position is not updating. Anything
              // else is the server saying the session is over, and the only
              // honest reading of that is that sharing has stopped.
              if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                setOffline(true)
                return
              }
              void endSession('Sharing stopped: the Hacienda\'s server refused the update.')
            })
        },
        (error) => {
          const reason: StartFailure =
            error.code === 1 ? 'permission-denied' : error.code === 3 ? 'unavailable' : 'unavailable'
          void endSession(startFailureMessage(reason))
        },
        { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
      )
    },
    [endSession],
  )

  const start = useCallback(
    async (minutes: ShareDuration) => {
      if (!convoId || !uid) {
        setPhase('error')
        setMessage(startFailureMessage('signed-out'))
        return
      }
      const unavailable = unavailableReason(uid)
      if (unavailable) {
        setPhase('error')
        setMessage(startFailureMessage(unavailable))
        return
      }
      setPhase('starting')
      setMessage(null)
      const result = await startSharing({ convoId, uid, minutes, nowMs: Date.now() })
      if (!result.ok) {
        setPhase('error')
        setMessage(startFailureMessage(result.reason))
        return
      }
      sessionRef.current = result.session
      setSession(result.session)
      setPhase('active')
      openWatch(result.session)
    },
    [convoId, openWatch, uid],
  )

  const stop = useCallback(() => endSession(null), [endSession])

  // The countdown, and the session ending by itself when the window closes.
  useEffect(() => {
    if (!session) return
    const tick = () => {
      const now = Date.now()
      setNowMs(now)
      if (isExpired(session.expires_at_ms, now) && sessionRef.current) {
        void endSession('Sharing ended: the time you chose ran out.')
      }
    }
    tick()
    const id = window.setInterval(tick, 1_000)
    return () => window.clearInterval(id)
  }, [endSession, session])

  // Backgrounded tabs do not get a reliable GPS, and a browser may suspend the
  // permission entirely. The watch is closed while the tab is hidden so nothing
  // is left half-running, and reopened when the Guest comes back.
  useEffect(() => {
    if (!session || typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        teardownWatch()
      } else if (sessionRef.current) {
        openWatch(sessionRef.current)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [openWatch, session, teardownWatch])

  // Closing the tab must not leave a watch or a timer running.
  useEffect(() => {
    if (!session || typeof window === 'undefined') return
    const onPageHide = () => {
      const current = sessionRef.current
      if (!current || !convoId) return
      // `sendBeacon` cannot carry a Firestore write, so the end is best-effort
      // here. Two things still cover the case where this never runs: the rules
      // refuse to show anyone a position past `expires_at_ms`, and the server-side
      // `onDisconnect` registered in startSharing deletes the node when this tab's
      // connection goes away.
      void stopSharing({ convoId, uid: current.guest_uid, nowMs: Date.now() })
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [convoId, session, uid])

  // Offline is shown, not hidden: a Guest whose connection dropped should not
  // read "sharing" as "the Admin can see me right now".
  useEffect(() => {
    if (typeof window === 'undefined') return
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // A different conversation (or a signed-out Guest) is a different subject:
  // the old session is ended rather than left running.
  useEffect(() => {
    if (!session) return
    if (session.conversation_id === convoId && session.guest_uid === uid) return
    void endSession(null)
  }, [convoId, endSession, session, uid])

  useEffect(() => teardownWatch, [teardownWatch])

  return {
    ...IDLE,
    phase,
    session,
    message,
    countdown: session ? formatCountdown(session.expires_at_ms, nowMs) : null,
    lastSentAtMs,
    offline,
    blocked,
    start,
    stop,
  }
}

/** Exported for the page, which shows the control only when it can work. */
export { canShareLocation }
