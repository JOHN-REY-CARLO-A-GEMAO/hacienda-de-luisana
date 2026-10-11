import { useEffect, useState } from 'react'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { formatHoldCountdown } from '../../lib/booking'
import type { Booking } from '../../lib/storage'

const TICK_MS = 30 * 1000

/**
 * How long this Booking's Date hold has left.
 *
 * The countdown is read from the same stored field and the same rule the Admin's
 * surfaces use, so a Guest and the Admin are never looking at different answers
 * (ticket #12). It stops counting once the Admin has acted: an approved Booking's
 * dates are firmly held and there is nothing left to run down.
 */
export function HoldCountdown({ booking }: { booking: Booking }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const remaining = cloudBookingsDB.holdRemaining(booking, now)
    if (remaining <= 0) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [booking, now])

  const readsAs = cloudBookingsDB.readStatus(booking, now)
  const remaining = cloudBookingsDB.holdRemaining(booking, now)

  if (readsAs === 'Expired') {
    return (
      <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800 leading-relaxed">
        <strong className="block">Your Date hold ran out.</strong>
        Nobody reviewed the request within 24 hours, so those dates went back into
        the pool. Send a new request for the dates you want — nothing about this
        one can be revived.
      </div>
    )
  }

  if (remaining <= 0) {
    // Approved and beyond: the dates are the Guest's, so there is no countdown.
    return null
  }

  return (
    <div className="rounded-2xl bg-cream-50 border border-forest-900/10 px-4 py-3 text-xs text-forest-800 leading-relaxed">
      <span className="text-[10px] uppercase tracking-eyebrow text-forest-600 font-semibold block">
        Your dates are held
      </span>
      <span className="font-serif text-lg text-forest-900 font-semibold">
        {formatHoldCountdown(remaining)}
      </span>{' '}
      <span className="text-forest-700/80">left for the Hacienda to review.</span>
      <span className="block mt-1 text-forest-700/70">
        After that the dates go back to other guests, so keep an eye on this page.
      </span>
    </div>
  )
}
