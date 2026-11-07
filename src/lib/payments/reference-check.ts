// -----------------------------------------------------------------------------
// One reference, one payment — the Guest-side check.
//
// A Guest may only read their own Bookings, and the Admin's reference catalogue
// (`payment_references`) is closed to Guests, so the website cannot answer
// "has this reference been used?" on its own. Two paths, in this order:
//
//   1. **The callable** — `paymentReferenceStatus` answers with the Booking that
//      already carries the reference, if any. It is the only answer that can see
//      other Guests' Bookings.
//   2. **This browser's own Bookings** — demo mode, and a Guest's own other
//      stays, where the answer is right there.
//
// `unchecked` is a third answer and a real one: an undeployed function or a
// dropped connection does not mean the reference is free. The form still refuses
// a duplicate it is told about, and the authoritative refusal is made by
// `submitBooking` inside the transaction that creates the Booking — which no
// caller can walk around.
// -----------------------------------------------------------------------------

import { isFirebaseConfigured } from '../firebase'
import { cloudBookingsDB } from '../firestoreBookings'
import { ensureGuestUid } from '../guestAuth'
import { backendCallable } from '../functionsClient'
import { normalizePaymentReference } from './receipt-rules'

export type ReferenceCheck =
  | { status: 'available'; checked: true }
  | { status: 'duplicate'; checked: true; bookingId: string; reference: string }
  | { status: 'unchecked'; checked: false; reason: string }

/** A Booking field that can carry a reference, whichever version wrote it. */
type ReferenceBearingBooking = {
  id: string
  payment_reference?: string
  ocr_reference?: string
}

/**
 * The first Booking in `bookings` whose reference folds to the same key,
 * ignoring `excludeId` — the Booking a re-send belongs to.
 */
export function findReferenceOwner(
  bookings: readonly ReferenceBearingBooking[],
  reference: string,
  excludeId?: string,
): string | null {
  const key = normalizePaymentReference(reference)
  if (!key) return null
  for (const booking of bookings) {
    if (excludeId && booking.id === excludeId) continue
    for (const raw of [booking.payment_reference, booking.ocr_reference]) {
      if (typeof raw === 'string' && normalizePaymentReference(raw) === key) return booking.id
    }
  }
  return null
}

type StatusReply = {
  duplicate?: boolean
  bookingId?: string | null
  reference?: string | null
}

/**
 * Ask whether a reference is already filed.
 *
 * Never throws: a failed check is `unchecked` with a reason, which the form shows
 * as "we could not confirm this reference is new" rather than as a duplicate or
 * as a clearance.
 */
export async function checkPaymentReference(input: {
  reference: string
  /** The Booking a re-send belongs to; that Booking is not a duplicate of itself. */
  bookingId?: string
}): Promise<ReferenceCheck> {
  const reference = input.reference.trim()
  if (!normalizePaymentReference(reference)) {
    return { status: 'unchecked', checked: false, reason: 'No reference number to check.' }
  }

  // Demo mode: every Booking this browser holds is readable.
  if (!isFirebaseConfigured || !cloudBookingsDB.isCloud) {
    try {
      const owner = findReferenceOwner(await cloudBookingsDB.list(), reference, input.bookingId)
      return owner
        ? { status: 'duplicate', checked: true, bookingId: owner, reference }
        : { status: 'available', checked: true }
    } catch {
      return { status: 'unchecked', checked: false, reason: 'This browser could not read its own Bookings.' }
    }
  }

  // Cloud mode: the Guest's own Bookings first, so a re-send or a second stay
  // with the same reference is caught even while offline.
  try {
    const uid = await ensureGuestUid().catch(() => null)
    const mine = await cloudBookingsDB.listMine(uid)
    const own = findReferenceOwner(mine, reference, input.bookingId)
    if (own) return { status: 'duplicate', checked: true, bookingId: own, reference }
  } catch {
    // A failed own-Booking read is not fatal: the callable below sees more.
  }

  try {
    const callable = backendCallable<{ reference: string }, StatusReply>('paymentReferenceStatus')
    const reply = await callable({ reference })
    const data = reply.data ?? {}
    if (data.duplicate && data.bookingId && data.bookingId !== input.bookingId) {
      return { status: 'duplicate', checked: true, bookingId: data.bookingId, reference }
    }
    return { status: 'available', checked: true }
  } catch {
    return {
      status: 'unchecked',
      checked: false,
      reason:
        'The reference could not be checked against other Bookings right now. The booking will still be refused if the reference is already used.',
    }
  }
}
