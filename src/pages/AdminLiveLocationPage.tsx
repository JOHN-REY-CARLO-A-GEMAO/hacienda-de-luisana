// ----------------------------------------------------------------------------
// The Admin's live-location reader, on the web.
//
// The Guest's control says "The Admin can see your location while this is on."
// This page is what makes that sentence true from a browser as well as from the
// mobile app. It reads the same two stores the app does — the consent in
// Firestore, the position in the Realtime Database — and draws a position only
// when `checkFix` accepts it against that consent (src/lib/liveLocationReader.ts).
//
// It is deliberately plain: coordinates, accuracy, how old the fix is, how long
// is left. No map. A tile layer is a third-party request and a decision about
// which vendor sees a Guest's position; the Admin's map already exists in the
// Flutter app (docs/LIMITATIONS.md), and this page's job is to answer "where are
// they, now" without becoming a place that stores where they were. A link out to
// a map service carries the coordinate in the URL, so it is one press, made by a
// person, and never a background fetch.
//
// Who may open it: `/admin/:convoId` carries the `guest-location:read`
// permission, which only the Admin role holds. That hiding is a courtesy —
// `firestore.rules` and `database.rules.json` are the enforcement, and both of
// them answer a Guest's request with a refusal whether or not this page exists.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Card, Container, Page, PageHeader } from '../components/ui'
import { MapPin, ArrowRight } from '../lib/icons'
import { BUSINESS } from '../config/site'
import {
  STRAIGHT_LINE_CAVEAT,
  formatAge,
  formatCountdown,
  isExpired,
  proximitySentence,
  secondsLeft,
} from '../lib/liveLocationPolicy'
import {
  directionsUrl,
  readerStopMessage,
  watchLiveLocation,
  type ReaderFrame,
} from '../lib/liveLocationReader'

/**
 * Point B: the hacienda's own pin, from the site config — the same constant the
 * Location page and every directions link already use. It is a business
 * address, not a Guest's position, and it never enters the stream.
 */
const HACIENDA: { lat: number; lng: number } = {
  lat: BUSINESS.coordinates.lat,
  lng: BUSINESS.coordinates.lng,
}

export function AdminLiveLocationPage() {
  const { convoId = '' } = useParams<{ convoId: string }>()
  const [frame, setFrame] = useState<ReaderFrame | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const handleRef = useRef<{ close: () => void } | null>(null)

  // One watch per conversation, closed the moment the conversation changes or
  // the page goes away: closing the page IS "stop watching", exactly as it is
  // in the Admin app's panel.
  useEffect(() => {
    if (!convoId) return
    setFrame(null)
    const handle = watchLiveLocation({
      convoId,
      now: () => Date.now(),
      onFrame: (next) => setFrame(next),
      destination: HACIENDA,
    })
    handleRef.current = handle
    return () => {
      handle.close()
      handleRef.current = null
    }
  }, [convoId])

  // The countdown and the staleness label both need a clock that ticks, and the
  // window closing must end the watch here too rather than wait for a write that
  // will never come.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])

  const session = frame && 'session' in frame ? frame.session : null
  const expired = session ? isExpired(session.expires_at_ms, nowMs) : false

  const { mapHref, routeHref } = useMemo(() => {
    if (!frame || frame.kind !== 'live') return { mapHref: null, routeHref: null }
    const from = { lat: frame.fix.lat, lng: frame.fix.lng }
    return {
      // A link, not an embed: the coordinate leaves this page only when a person
      // presses it, which is the difference between showing a position and
      // publishing one to a tile server.
      mapHref: `https://www.openstreetmap.org/?mlat=${from.lat}&mlon=${from.lng}#map=17/${from.lat}/${from.lng}`,
      // Point A → point B, computed by a real routing engine in a tab the Admin
      // chose to open. This is the *only* way the road distance is obtained, and
      // it is why no routing API is called from the app.
      routeHref: directionsUrl(from, HACIENDA),
    }
  }, [frame])

  return (
    <Page>
      <Container>
        <PageHeader
          eyebrow="Admin"
          title="Live location"
          lead={
            <>
              A Guest's position, while they are sharing one. Nothing here is stored: the consent is a
              document that says who and until when, and the position is a node that is overwritten
              every few seconds and unreadable the moment the window closes.
            </>
          }
        />

        {!convoId && (
          <Alert tone="danger" className="mt-8" title="No conversation named">
            <p>Open this from a conversation, so there is a consent to read.</p>
          </Alert>
        )}

        {convoId && (
          <Card className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[11px] text-forest-700/80 break-all">{convoId}</p>
              {session && !expired && (
                <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 tabular-nums">
                  {formatCountdown(session.expires_at_ms, nowMs)} remaining
                </span>
              )}
              {session && expired && (
                <span className="badge bg-amber-50 text-amber-800 border border-amber-200">Window closed</span>
              )}
            </div>

            <div className="mt-5" aria-live="polite">
              <ReaderBody frame={frame} nowMs={nowMs} mapHref={mapHref} routeHref={routeHref} />
            </div>
          </Card>
        )}

        <p className="mt-6 text-xs leading-relaxed text-forest-700/80">
          The guest may stop sharing at any moment. Nothing on this page survives the window: the
          position is refused by the database's own rules once the session ends, and there is no
          history to read afterwards — not here, not in the app, not in the console's query tools.
        </p>
      </Container>
    </Page>
  )
}

function ReaderBody({
  frame,
  nowMs,
  mapHref,
  routeHref,
}: {
  frame: ReaderFrame | null
  nowMs: number
  mapHref: string | null
  routeHref: string | null
}) {
  if (!frame) {
    return <p className="text-sm text-forest-700">Reading the consent…</p>
  }

  if (frame.kind === 'no-session') {
    return (
      <p className="text-sm text-forest-700">
        This Guest is not sharing a live location right now. The panel will fill in by itself when
        they start.
      </p>
    )
  }

  if (frame.kind === 'waiting') {
    return (
      <p className="text-sm text-forest-700">
        The Guest is sharing, and their device has not reported a position yet. This is normal for
        the first few seconds, and indoors it can take longer.
      </p>
    )
  }

  if (frame.kind === 'ended') {
    return (
      <Alert tone={frame.reason === 'denied' ? 'danger' : 'info'} title="Not watching">
        <p>{readerStopMessage(frame.reason)}</p>
        {frame.fix && (
          <p className="mt-2 text-xs opacity-80">
            Last accepted position: {frame.fix.lat.toFixed(5)}, {frame.fix.lng.toFixed(5)} —{' '}
            {formatAge(frame.fix.at_ms, nowMs)}.
          </p>
        )}
      </Alert>
    )
  }

  const { fix, stale, proximity } = frame
  const left = secondsLeft(frame.session.expires_at_ms, nowMs)
  const atProperty = proximity?.kind === 'at-property'

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium text-forest-900">
        <MapPin size={16} className="shrink-0 text-forest-600" />
        <span>
          {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
        </span>
        <span className="text-forest-600">±{Math.round(fix.accuracy_m)} m</span>
      </div>

      {/* Point A → point B. The sentence is built by the policy module, so the
          wording that stops an owner reading this as road distance is unit
          tested rather than retyped here. */}
      {proximity && (
        <div className="mt-3">
          {atProperty ? (
            <Alert tone="success" className="text-xs">
              <p>{proximitySentence(proximity)}</p>
            </Alert>
          ) : (
            <>
              <p className="text-sm font-medium text-forest-900">
                {proximity.kind === 'away' ? (
                  <>
                    {proximitySentence(proximity)}{' '}
                    <span className="text-forest-600 tabular-nums">({proximity.bearing.point})</span>
                  </>
                ) : (
                  proximitySentence(proximity)
                )}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-forest-600">
                {STRAIGHT_LINE_CAVEAT}
              </p>
            </>
          )}
        </div>
      )}

      <p className={`mt-2 text-xs ${stale ? 'text-amber-800' : 'text-forest-700'}`}>
        {stale ? 'This position may be out of date: ' : ''}
        Last updated {formatAge(fix.at_ms, nowMs)}
        {stale ? ' — the device has stopped reporting, and the position shown is the last one it sent.' : ''}
      </p>

      <p className="mt-1 text-xs text-forest-600 tabular-nums">
        {left > 0 ? `${Math.floor(left / 60)}m ${left % 60}s left` : 'Window closed'} · fix #{fix.seq}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {routeHref && (
          <a className="btn-primary btn-sm" href={routeHref} target="_blank" rel="noreferrer">
            <ArrowRight size={14} /> Driving directions to the Hacienda
          </a>
        )}
        {mapHref && (
          <a className="btn-ghost btn-sm" href={mapHref} target="_blank" rel="noreferrer">
            <MapPin size={14} /> Open in OpenStreetMap
          </a>
        )}
      </div>
    </div>
  )
}
