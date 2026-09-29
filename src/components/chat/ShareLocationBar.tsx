// ----------------------------------------------------------------------------
// 📍 Share Live Location — the Guest's control, in the chat composer.
//
// One button, one sentence, one countdown. When nothing is being shared the
// control says what will happen before it happens; when something is, it says
// who can see it and how long is left, and offers the way to stop.
//
// It is deliberately the same component in the same place the Admin answers it:
// inside the conversation. Live location is a thing you say to the person you
// are talking to, not a separate screen and a separate permission.
// ----------------------------------------------------------------------------

import { useState } from 'react'
import {
  SHARE_DURATIONS,
  type ShareDuration,
} from '../../lib/liveLocationPolicy'
import type { UseLiveLocation } from '../../hooks/useLiveLocation'

export function ShareLocationBar({ sharing }: { sharing: UseLiveLocation }) {
  const [choosing, setChoosing] = useState(false)

  if (sharing.phase === 'active' && sharing.session) {
    return (
      <div
        className="mt-3 rounded-[20px] border border-forest-900/10 bg-cream-100 p-3"
        role="status"
        data-tour="live-location-active"
      >
        <div className="flex items-center gap-2 text-sm text-forest-900">
          <span className="inline-block h-2 w-2 rounded-full bg-forest-700 animate-pulse" aria-hidden="true" />
          <span className="font-medium">📍 Sharing live location</span>
        </div>
        <p className="mt-1 text-xs text-forest-800/80">
          The Admin can see your location while this is on.
          {sharing.offline && ' You are offline, so the position is not updating.'}
        </p>
        <p className="mt-1 text-xs text-forest-800/80">
          Expires in: <span className="font-medium tabular-nums">{sharing.countdown}</span>
          {sharing.lastSentAtMs ? ' · sending' : ''}
        </p>
        <button type="button" className="btn-primary text-xs mt-3" onClick={() => void sharing.stop()}>
          Stop Sharing
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2">
      {sharing.phase === 'error' && sharing.message && (
        <p className="text-xs text-red-700 mb-2" role="alert">
          {sharing.message}
        </p>
      )}
      {choosing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[20px] border border-forest-900/10 bg-white p-3">
          <span className="text-xs text-forest-800/80">Share for</span>
          {SHARE_DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="btn-ghost text-xs"
              disabled={sharing.phase === 'starting'}
              onClick={() => {
                setChoosing(false)
                void sharing.start(minutes as ShareDuration)
              }}
            >
              {minutes} minutes
            </button>
          ))}
          <button type="button" className="btn-ghost text-xs" onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={Boolean(sharing.blocked) || sharing.phase === 'starting'}
          title={sharing.blocked ? 'Live location is not available on this deployment.' : undefined}
          onClick={() => setChoosing(true)}
          data-tour="share-location"
        >
          {sharing.phase === 'starting' ? 'Starting…' : '📍 Live Location'}
        </button>
      )}
      <p className="mt-1 text-[11px] text-forest-700/60">
        Sharing is off until you choose a time, and stops on its own when it runs out.
      </p>
    </div>
  )
}
