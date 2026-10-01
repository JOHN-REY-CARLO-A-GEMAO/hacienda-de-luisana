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
