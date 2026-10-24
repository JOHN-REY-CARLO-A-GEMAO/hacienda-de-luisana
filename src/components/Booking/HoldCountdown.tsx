import { useEffect, useState } from 'react'
import { cloudBookingsDB } from '../../lib/firestoreBookings'
import { formatHoldCountdown } from '../../lib/booking'
import type { Booking } from '../../lib/storage'
import { Alert } from '../ui'

const TICK_MS = 30 * 1000

/**
 * How long this Booking's Date hold has left.
 *
 * The countdown is read from the same stored field and the same rule the Admin's
 * surfaces use, so a Guest and the Admin are never looking at different answers
 * (ticket #12). It stops counting once the Admin has acted: an approved Booking's
 * dates are firmly held and there is nothing left to run down.
 *
 * The time left is the only number on the page a Guest cannot get back, so it is
 * the one thing here set large and in the display face. Everything around it
 * explains what the number costs them if it runs out.
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
      <Alert tone="danger" className="text-xs" title="Your Date hold ran out.">
        <>
          Nobody reviewed the request within 24 hours, so those dates went back into the pool. Send a
          new request for the dates you want — nothing about this one can be revived.
        </>
      </Alert>
    )
  }

  if (remaining <= 0) {
    // Approved and beyond: the dates are the Guest's, so there is no countdown.
    return null
  }

  return (
    <div className="guest-inset flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3.5">
      <div className="min-w-0">
        <p className="guest-label">Your dates are held for</p>
        <p className="guest-num mt-0.5 text-3xl leading-none text-forest-900 dark:text-cream-50">
          {formatHoldCountdown(remaining)}
        </p>
      </div>
      <p className="min-w-[14rem] flex-1 text-xs leading-relaxed text-forest-800/85 dark:text-cream-100/75">
        That is how long the Hacienda has to review this request. If it runs out the dates go back to
        other guests, so keep an eye on this page.
      </p>
    </div>
  )
}
