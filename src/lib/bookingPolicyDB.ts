// Read the guest booking policy through the existing site_config architecture.
// Only Admins may write this document (firestore.rules). No second settings
// store: demo mode uses the same default as a missing cloud document.
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { configuredBookingLeadTimeDays, MINIMUM_BOOKING_LEAD_TIME_DAYS } from './booking'

const COLLECTION = 'site_config'
const DOC_ID = 'booking'
const isCloud = isFirebaseConfigured && Boolean(db)

export const bookingPolicyDB = {
  async getMinimumLeadTimeDays(): Promise<number> {
    if (!isCloud || !db) return MINIMUM_BOOKING_LEAD_TIME_DAYS
    try {
      // Pre-upload/pre-write checks must not use an out-of-date offline cache
      // after the Admin changes the policy. Firestore rules still decide.
      const snap = await getDocFromServer(doc(db, COLLECTION, DOC_ID))
      return configuredBookingLeadTimeDays(snap.exists() ? snap.data() : null)
    } catch {
      throw new Error('Booking dates could not be checked right now. Please try again.')
    }
  },

  /**
   * The Guest-facing policy decisions that live in this document, from **one**
   * read: the minimum lead time, whether a price must be attested before a
   * Booking may be written (ADR-0019), and whether callable-only availability
   * and booking submission enforcement has been switched on (ADR-0020).
   *
   * A single read is not a micro-optimisation. All answers have to describe the
   * same moment: a Guest whose dates were judged against the 30-day default while
   * enforcement was judged against a newer document would be told one policy and
   * written under another. Keeping both switches off by default lets static web
   * builds and `firestore.rules` deploy safely on Spark before Cloud Functions
   * are deployed.
   */
  async getGuestPolicy(): Promise<{
    minimumLeadTimeDays: number
    quotesRequired: boolean
    callableBookingRequired: boolean
  }> {
    if (!isCloud || !db) {
      return {
        minimumLeadTimeDays: MINIMUM_BOOKING_LEAD_TIME_DAYS,
        quotesRequired: false,
        callableBookingRequired: false,
      }
    }
    try {
      const snap = await getDocFromServer(doc(db, COLLECTION, DOC_ID))
      const data = snap.exists() ? snap.data() : undefined
      return {
        minimumLeadTimeDays: configuredBookingLeadTimeDays(data ?? null),
        quotesRequired: data?.quotes_required === true,
        callableBookingRequired: data?.callable_booking_required === true,
      }
    } catch {
      throw new Error('Booking dates could not be checked right now. Please try again.')
    }
  },

  subscribe(callback: (days: number) => void): () => void {
    if (!isCloud || !db) {
      callback(MINIMUM_BOOKING_LEAD_TIME_DAYS)
      return () => {}
    }
    return onSnapshot(
      doc(db, COLLECTION, DOC_ID),
      (snap) => callback(configuredBookingLeadTimeDays(snap.exists() ? snap.data() : null)),
      () => callback(MINIMUM_BOOKING_LEAD_TIME_DAYS),
    )
  },
}
