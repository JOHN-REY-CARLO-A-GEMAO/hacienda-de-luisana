import { useEffect, useState } from 'react'
import { MINIMUM_BOOKING_LEAD_TIME_DAYS, minimumCheckInDate } from '../lib/booking'
import { bookingPolicyDB } from '../lib/bookingPolicyDB'

/** Live policy plus a calendar minimum that refreshes on focus and at midnight. */
export function useBookingPolicy() {
  const [days, setDays] = useState(MINIMUM_BOOKING_LEAD_TIME_DAYS)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => bookingPolicyDB.subscribe(setDays), [])
  useEffect(() => {
    const refresh = () => setNow(new Date())
    // Asia/Manila is UTC+08:00 without daylight saving. Schedule the next
    // business midnight, not the user's local midnight. Focus covers suspended
    // tabs; a render's validation and the submission re-check use a fresh clock.
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const instant = Date.now()
      const manilaClock = instant + 8 * 60 * 60 * 1000
      const untilMidnight = 86_400_000 - (manilaClock % 86_400_000)
      timer = setTimeout(() => { refresh(); schedule() }, untilMidnight)
    }
    schedule()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return { minimumBookingLeadTimeDays: days, earliestCheckIn: minimumCheckInDate(now, days) }
}
