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
   * The two Guest-facing policy decisions that live in this document, from **one**
   * read: the minimum lead time, and whether a price must be attested before a
   * Booking may be written (ADR-0019).
   *
   * A single read is not a micro-optimisation. Both answers have to describe the
   * same moment: a Guest whose dates were judged against the 30-day default while
   * the attestation requirement was judged against a newer document would be told
   * one policy and written under another. It also keeps a submit to one round trip
   * to `site_config/booking`, which is what the rules will read a third time when
   * they evaluate the write.
   */
  async getGuestPolicy(): Promise<{ minimumLeadTimeDays: number; quotesRequired: boolean }> {
    if (!isCloud || !db) return { minimumLeadTimeDays: MINIMUM_BOOKING_LEAD_TIME_DAYS, quotesRequired: false }
    try {
      const snap = await getDocFromServer(doc(db, COLLECTION, DOC_ID))
      const data = snap.exists() ? snap.data() : undefined
      return {
        minimumLeadTimeDays: configuredBookingLeadTimeDays(data ?? null),
        quotesRequired: data?.quotes_required === true,
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
