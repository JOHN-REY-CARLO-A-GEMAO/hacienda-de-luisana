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
import { SHARE_DURATIONS, type ShareDuration } from '../../lib/liveLocationPolicy'
import type { UseLiveLocation } from '../../hooks/useLiveLocation'
import { MapPin } from '../../lib/icons'

export function ShareLocationBar({ sharing }: { sharing: UseLiveLocation }) {
  const [choosing, setChoosing] = useState(false)

  if (sharing.phase === 'active' && sharing.session) {
    const hasPublished = sharing.lastSentAtMs !== null
    return (
      <div className="messages-location-active" role="status" data-tour="live-location-active">
        <div className="messages-location-active-heading">
          <MapPin size={16} className="messages-location-active-icon" />
          <span>{hasPublished ? 'Sharing live location' : 'Finding your location…'}</span>
        </div>
        <p className="messages-location-active-copy">
          {hasPublished
            ? 'The Admin can see your location while this is on.'
            : 'The private session was created. No position has been sent yet; keep this page open while your device finds one.'}
          {sharing.offline && ' You are offline, so the position is not updating.'}
        </p>
        <div className="messages-location-active-footer">
          <p className="messages-location-expiry">
            Expires in: <span className="font-medium tabular-nums">{sharing.countdown}</span>
            {sharing.lastSentAtMs ? ' · sending' : ''}
          </p>
          <button type="button" className="btn-quiet btn-sm" onClick={() => void sharing.stop()}>
            Stop Sharing
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="messages-location">
      {sharing.phase === 'error' && sharing.message && (
        <p className="messages-location-error" role="alert">
          {sharing.message}
        </p>
      )}
      {choosing ? (
        <div className="messages-location-choice" role="group" aria-label="Live location duration">
          <span className="messages-location-choice-label">Share for</span>
          {SHARE_DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="btn-quiet btn-sm"
              disabled={sharing.phase === 'starting'}
              onClick={() => {
                setChoosing(false)
                void sharing.start(minutes as ShareDuration)
              }}
            >
              {minutes} minutes
            </button>
          ))}
          <button type="button" className="btn-ghost btn-sm" onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={Boolean(sharing.blocked) || sharing.phase === 'starting'}
          title={sharing.blocked ? 'Live location is not available on this deployment.' : undefined}
          onClick={() => setChoosing(true)}
          data-tour="share-location"
        >
          {sharing.phase === 'starting' ? (
            'Starting…'
          ) : (
            <>
              <MapPin size={15} />
              Live Location
            </>
          )}
        </button>
      )}
      <p className="messages-location-hint">
        Sharing is off until you choose a time, and stops on its own when it runs out.
      </p>
    </div>
  )
}
