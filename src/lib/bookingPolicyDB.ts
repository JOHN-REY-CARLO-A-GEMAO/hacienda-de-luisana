// Read the guest booking policy through the existing site_config architecture.
// Only Admins may write this document (firestore.rules). No second settings
// store: demo mode uses the same default as a missing cloud document.
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import {
  configuredBookingLeadTimeDays,
  configuredBookingsOpenUntil,
  MINIMUM_BOOKING_LEAD_TIME_DAYS,
  NO_BOOKINGS_CUTOFF,
} from './booking'

const COLLECTION = 'site_config'
const DOC_ID = 'booking'
const isCloud = isFirebaseConfigured && Boolean(db)

/** The Guest-facing policy decisions stored in `site_config/booking`. */
export type GuestBookingPolicy = {
  minimumLeadTimeDays: number
  /** Last bookable check-in date, or '' when the Hacienda has no cut-off. */
  bookingsOpenUntil: string
  quotesRequired: boolean
  callableBookingRequired: boolean
}

const OPEN_POLICY: GuestBookingPolicy = {
  minimumLeadTimeDays: MINIMUM_BOOKING_LEAD_TIME_DAYS,
  bookingsOpenUntil: NO_BOOKINGS_CUTOFF,
  quotesRequired: false,
  callableBookingRequired: false,
}

/** One mapping for the server read, the subscription and the demo default. */
function policyFrom(data: Record<string, unknown> | undefined): GuestBookingPolicy {
  return {
    minimumLeadTimeDays: configuredBookingLeadTimeDays(data ?? null),
    bookingsOpenUntil: configuredBookingsOpenUntil(data ?? null),
    quotesRequired: data?.quotes_required === true,
    callableBookingRequired: data?.callable_booking_required === true,
  }
}

export const bookingPolicyDB = {
  /**
   * The Guest-facing policy decisions that live in this document, from **one**
   * read: the minimum lead time, the last bookable check-in, whether a price
   * must be attested before a Booking may be written (ADR-0019), and whether
   * callable-only availability and booking submission enforcement has been
   * switched on (ADR-0020).
   *
   * A single read is not a micro-optimisation. All answers have to describe the
   * same moment: a Guest whose dates were judged against the 30-day default while
   * enforcement was judged against a newer document would be told one policy and
   * written under another. Keeping both switches off by default lets static web
   * builds and `firestore.rules` deploy safely on Spark before Cloud Functions
   * are deployed.
   */
  async getGuestPolicy(): Promise<GuestBookingPolicy> {
    if (!isCloud || !db) return { ...OPEN_POLICY }
    try {
      const snap = await getDocFromServer(doc(db, COLLECTION, DOC_ID))
      return policyFrom(snap.exists() ? snap.data() : undefined)
    } catch {
      throw new Error('Booking dates could not be checked right now. Please try again.')
    }
  },

  /**
   * Live policy for the calendar. The cut-off is part of the same callback as
   * the lead time: a Guest who sees one change must see the other from the same
   * document version, or the calendar can paint a date open that the validator
   * behind Continue already refuses.
   */
  subscribePolicy(callback: (policy: GuestBookingPolicy) => void): () => void {
    if (!isCloud || !db) {
      callback({ ...OPEN_POLICY })
      return () => {}
    }
    return onSnapshot(
      doc(db, COLLECTION, DOC_ID),
      (snap) => callback(policyFrom(snap.exists() ? snap.data() : undefined)),
      () => callback({ ...OPEN_POLICY }),
    )
  },
}
