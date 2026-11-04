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
  estimateClockSkew,
  publishFixReported,
  resumeSharing,
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
  /** This conversation's earlier session is being read back, on mount. */
  resuming: boolean
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
  /**
   * The database's error code for the last refused publish, or null.
   *
   * `null` while `lastSentAtMs` is also null means the GPS genuinely has not
   * answered. A code here means a position *was* produced and the write was
   * refused — a different fault with a different fix, and the Guest deserves to
   * be told which one they have.
   */
  fixError: string | null
  /** This build cannot share at all, and why. */
  blocked: StartFailure | null
}

export type UseLiveLocation = SharingState & {
  start: (minutes: ShareDuration) => Promise<void>
  stop: () => Promise<void>
}

const IDLE: Omit<SharingState, 'blocked' | 'offline' | 'resuming' | 'fixError'> = {
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
  // Why the last publish did not land. Without this, "the GPS has not answered
  // yet" and "every write is being refused" are the same screen — and the
  // Guest's own banner said "Locating GPS…" in both, forever.
  const [fixError, setFixError] = useState<string | null>(null)
  // Recomputed rather than frozen: this is "can this build share, *now*, for
  // *this* person", and a session that restores a second after the first render
  // must not leave the control permanently disabled with a stale reason.
  const blocked = unavailableReason(input.uid)
  const [resuming, setResuming] = useState(false)

  // The live values the watch callback needs, without re-subscribing the GPS
  // watch every time a fix is published.
  const sessionRef = useRef<LocationSession | null>(null)
  const lastFixRef = useRef<{ at: LatLng; atMs: number } | null>(null)
  const seqRef = useRef(0)
  const watchRef = useRef<number | null>(null)
  const currentSubject = useRef(input)
  currentSubject.current = input
  const mounted = useRef(true)
  const startGeneration = useRef(0)

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
      setFixError(null)
      startGeneration.current += 1
      if (current) {
        await stopSharing({ convoId: current.conversation_id, uid: current.guest_uid, nowMs: Date.now() }).catch(() => {})
      }
    },
    [teardownWatch],
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

          publishFixReported(
            live,
            { lat: at.lat, lng: at.lng, accuracy_m: position.coords.accuracy ?? 0, seq: seqRef.current },
            now,
          )
            .then(({ outcome, code }) => {
              if (outcome === 'sent') {
                setLastSentAtMs(now)
                setFixError(null)
                return
              }
              if (outcome === 'stopped') {
                void endSession('Sharing stopped: the Hacienda\'s server refused the update.')
                return
              }
              // 'retry' — the write did not land, and that is not the same as
              // the session being over. The last fix is forgotten so the very
              // next GPS tick is eligible again (a fix that failed because it
              // was "not far enough" would otherwise never be retried), the
              // watch stays open, and the panel tells the Guest what is true:
              // the position is not updating. Ending the share over one bad
              // write was the bug — a transient refusal killed a session that
              // was working a second earlier.
              lastFixRef.current = null
              setOffline(true)
              setFixError(outcome === 'retry' ? (code ?? 'unknown') : null)
            })
            .catch(() => {
              // `publishFix` answers rather than throws; this is the belt to
              // that braces: an SDK failure outside its try is still only a
              // missed fix, never proof the session ended.
              lastFixRef.current = null
              setOffline(true)
              setFixError('unknown')
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
      const generation = ++startGeneration.current
      setPhase('starting')
      setMessage(null)
      setFixError(null)
      // Ask the server the time before stating a window on its clock. Best
      // effort by construction: `estimateClockSkew` returns null when the probe
      // cannot run, and `startSharing` then falls back to the device's clock
      // with a wider guard band.
      const skew = await estimateClockSkew(uid)
      if (!mounted.current || generation !== startGeneration.current) return
      const result = await startSharing({ convoId, uid, minutes, nowMs: Date.now(), skew })
      if (!mounted.current || generation !== startGeneration.current || currentSubject.current.convoId !== convoId || currentSubject.current.uid !== uid) {
        if (result.ok) void stopSharing({ convoId: result.session.conversation_id, uid: result.session.guest_uid, nowMs: Date.now() }).catch(() => {})
        return
      }
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

  /**
   * Take up a session the store already has — after a reload, a restore from
   * the back/forward cache, or a second tab — instead of starting a second one.
   *
   * Two things make this safe rather than a hole in "the Guest pressed Stop":
   * `resumeSharing` only returns a session whose `active` is true, whose window
   * is open, and whose `guest_uid` is this Guest's; and the secret comes back
   * from the document, so the fixes that follow are the ones the Admin can
   * correlate. The server-side disconnect cleanup is armed again here, because
   * the connection that registered it is gone.
   */
  const adopt = useCallback(
    (pending: LocationSession) => {
      sessionRef.current = pending
      lastFixRef.current = null
      setSession(pending)
      setPhase('active')
      setMessage(null)
      setLastSentAtMs(null)
      setFixError(null)
      openWatch(pending)
    },
    [openWatch],
  )

  // Nothing in memory survives a reload, so the store is asked on mount (and
  // whenever the Guest switches conversation): is there a consent for this
  // conversation that I may carry on with? Before this, a refresh either ended
  // the share or left a live consent the Admin could read while the Guest's own
  // screen said nothing was being shared.
  useEffect(() => {
    if (!convoId || !uid) return
    if (unavailableReason(uid)) return
    let cancelled = false
    const generation = startGeneration.current
    setResuming(true)
    void (async () => {
      const pending = await resumeSharing({ convoId, uid, nowMs: Date.now() })
      if (cancelled || !mounted.current) return
      // A start, a stop, or a change of subject that happened while the read was
      // in flight wins: this only fills an empty panel.
      if (generation !== startGeneration.current) return
      if (currentSubject.current.convoId !== convoId || currentSubject.current.uid !== uid) return
      if (sessionRef.current) return
      setResuming(false)
      if (!pending) return
      void import('../lib/liveLocation').then(({ armDisconnectCleanup }) =>
        armDisconnectCleanup(pending.conversation_id, pending.guest_uid),
      )
      adopt(pending)
    })()
    return () => {
      cancelled = true
    }
  }, [adopt, convoId, uid])

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
    const onPageHide = (event: PageTransitionEvent) => {
      // A page going into the back/forward cache is not gone — it is frozen
      // with its state intact and will be resumed exactly as it was. Ending the
      // share there would end it every time the Guest followed a link and
      // pressed Back, which is not what "I closed the page" means.
      if (event.persisted) return
      const current = sessionRef.current
      if (!current) return
      // `sendBeacon` cannot carry a Firestore write, so the end is best-effort
      // here. Two things still cover the case where this never runs: the rules
      // refuse to show anyone a position past `expires_at_ms`, and the server-side
      // `onDisconnect` registered in startSharing deletes the node when this tab's
      // connection goes away.
      void stopSharing({ convoId: current.conversation_id, uid: current.guest_uid, nowMs: Date.now() }).catch(() => {})
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

  // Invalidate an unfinished start when the selected subject changes.
  useEffect(() => () => { startGeneration.current += 1 }, [convoId, uid])
  useEffect(() => { setPhase((value) => value === 'starting' ? 'idle' : value) }, [convoId, uid])

  // A different conversation (or a signed-out Guest) is a different subject:
  // the old session is ended rather than left running.
  useEffect(() => {
    if (session && session.conversation_id === convoId && session.guest_uid === uid) return
    if (session) void endSession(null)
  }, [convoId, endSession, session, uid])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      startGeneration.current += 1
      teardownWatch()
      const current = sessionRef.current
      sessionRef.current = null
      if (current) void stopSharing({ convoId: current.conversation_id, uid: current.guest_uid, nowMs: Date.now() }).catch(() => {})
    }
  }, [teardownWatch])

  return {
    ...IDLE,
    phase,
    resuming,
    session,
    message,
    countdown: session ? formatCountdown(session.expires_at_ms, nowMs) : null,
    lastSentAtMs,
    offline,
    fixError,
    blocked,
    start,
    stop,
  }
}

/** Exported for the page, which shows the control only when it can work. */
export { canShareLocation }
