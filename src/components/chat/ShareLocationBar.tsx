import { useState } from 'react'
import { SHARE_DURATIONS, type ShareDuration } from '../../lib/liveLocationPolicy'
import type { UseLiveLocation } from '../../hooks/useLiveLocation'
import { MapPin } from '../../lib/icons'

/** Explicit, time-limited consent for sharing a location in this conversation. */
export function ShareLocationBar({ sharing }: { sharing: UseLiveLocation }) {
  const [choosing, setChoosing] = useState(false)

  if (sharing.phase === 'active' && sharing.session) return null

  return (
    <div className="messages-location-control">
      <button
        type="button"
        className="messages-attach"
        disabled={Boolean(sharing.blocked) || sharing.phase === 'starting' || sharing.resuming}
        title={sharing.blocked ? 'Live location is not available on this deployment.' : 'Share live location'}
        aria-label="Share live location"
        aria-expanded={choosing}
        onClick={() => setChoosing((open) => !open)}
        data-tour="share-location"
      >
        <MapPin size={18} />
      </button>
      {choosing && (
        <div className="messages-location-menu" role="group" aria-label="Live location duration">
          <p>Share your live location with the Admin for:</p>
          {SHARE_DURATIONS.map((minutes) => (
            <button key={minutes} type="button" className="btn-quiet btn-sm"
              disabled={sharing.phase === 'starting'}
              onClick={() => { setChoosing(false); void sharing.start(minutes as ShareDuration) }}>
              {minutes} minutes
            </button>
          ))}
          <button type="button" className="btn-ghost btn-sm" onClick={() => setChoosing(false)}>Cancel</button>
          <p>Sharing stops automatically when the time runs out.</p>
        </div>
      )}
      {sharing.phase === 'error' && sharing.message && (
        <p className="messages-location-error" role="alert">{sharing.message}</p>
      )}
    </div>
  )
}
