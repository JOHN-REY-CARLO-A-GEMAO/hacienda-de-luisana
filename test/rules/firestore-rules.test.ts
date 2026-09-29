/**
 * `firestore.rules`, executed.
 *
 * Every case below is a request built from the shapes the applications write,
 * run through `test/rules/engine.ts` against the repository's real rules file.
 * The engine's own semantics are pinned in `engine.test.ts`; what is under test
 * here is the policy. Cases whose answer depends on a semantics question the
 * public reference does not settle are marked `SEMANTICS` and are also in
 * `test/emulator/firestore.emulator.test.ts`, which is the canonical check.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate, ruleTimestamp, type DocData, type Store } from './engine'
import {
  ADMIN_UID,
  BOOKING_ID,
  CONVO_ID,
  GUEST_UID,
  OTHER_GUEST_UID,
  accessLogDoc,
  adminVerifyPatch,
  allowlistedAdmin,
  anonymousGuest,
  bookingDoc,
  conversationDoc,
  emailGuest,
  guestPaymentPatch,
  locationSessionDoc,
  messageDoc,
  paidBookingDoc,
  promotedAdmin,
  request,
  reviewDoc,
  storeWith,
} from './context'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')

/**
 * The documents the rules read through `get()`: the Profiles that decide roles,
 * and the conversation whose `guest_uid` decides who may read its messages.
 */
const profiles: Store = storeWith(
  {
    [GUEST_UID]: { uid: GUEST_UID, role: 'guest' },
    'promoted-admin-1': { uid: 'promoted-admin-1', role: 'admin' },
  },
  {
    [`conversations/${CONVO_ID}`]: conversationDoc(),
    // The Booking the Review rules read through `get()`: the Guest's own, and
    // finished, which is what a Review is allowed to be about.
    [`bookings/${BOOKING_ID}`]: bookingDoc({ status: 'Completed', kyc_status: 'approved' }),
  },
)

const allow = (partial: Parameters<typeof request>[0], store: Store = profiles) =>
  evaluate(request(partial), rules, { store }).allow

const deny = (partial: Parameters<typeof request>[0], store: Store = profiles) =>
  evaluate(request(partial), rules, { store }).allow === false

// ---------------------------------------------------------------------------
// Authentication and roles
// ---------------------------------------------------------------------------

describe('auth: who is asking', () => {
  const booking = bookingDoc()

  it('lets a signed-out visitor create a Pending Booking once the screenshot is attached', () => {
    expect(allow({
      path: 'bookings/new-booking',
      method: 'create',
      auth: null,
      requestData: bookingDoc({
        payment_status: 'pending',
        payment_proof_url: 'payments/guest-uid-1/proof.jpg',
        amount_claimed: 5000,
      }),
    })).toBe(true)
  })

  it('refuses a Booking created without the identity it will belong to (ADR-0004)', () => {
    expect(deny({ path: 'bookings/new-booking', method: 'create', auth: null, requestData: bookingDoc({ uid: '' }) })).toBe(true)
  })

  it('lets an anonymous Guest read their own Booking', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: anonymousGuest(), resourceData: booking })).toBe(true)
  })

  it('refuses an anonymous Guest somebody else\'s Booking', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: booking })).toBe(true)
  })

  it('refuses a signed-out visitor a Booking', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: null, resourceData: booking })).toBe(true)
  })

  it('lets the allowlisted Admin read any Booking', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: allowlistedAdmin(), resourceData: booking })).toBe(true)
  })

  it('lets an Admin promoted by their Profile read any Booking', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: promotedAdmin(), resourceData: booking })).toBe(true)
  })

  it('refuses an unknown signed-in account that owns nothing', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: emailGuest('stranger-1'), resourceData: booking })).toBe(true)
  })

  it('treats a role it does not recognise as Guest, not as Admin', () => {
    // The retired 'host' value must not grant anything (CONTEXT.md § Role).
    const legacy = storeWith({ [GUEST_UID]: { uid: GUEST_UID, role: 'host' } })
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: booking }, legacy)).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: anonymousGuest(), resourceData: booking }, legacy)).toBe(true)
  })
})

describe('profiles: the collection roles rest on', () => {
  it('lets a person read their own Profile, and the Admin read anybody\'s', () => {
    const profile = { uid: GUEST_UID, role: 'guest', display_name: 'Ana' }
    expect(allow({ path: `profiles/${GUEST_UID}`, method: 'get', auth: anonymousGuest(), resourceData: profile })).toBe(true)
    expect(allow({ path: `profiles/${GUEST_UID}`, method: 'get', auth: allowlistedAdmin(), resourceData: profile })).toBe(true)
    expect(deny({ path: `profiles/${GUEST_UID}`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: profile })).toBe(true)
  })

  it('lets a person correct their own name, but never their own role', () => {
    const profile = { uid: GUEST_UID, role: 'guest', display_name: 'Ana' }
    expect(allow({ path: `profiles/${GUEST_UID}`, method: 'update', auth: anonymousGuest(), resourceData: profile, requestData: { ...profile, display_name: 'Ana R.' } })).toBe(true)
    expect(deny({ path: `profiles/${GUEST_UID}`, method: 'update', auth: anonymousGuest(), resourceData: profile, requestData: { ...profile, role: 'admin' } })).toBe(true)
  })

  it('lets only the Admin open a Profile for somebody else', () => {
    const created = { uid: OTHER_GUEST_UID, role: 'guest' }
    expect(deny({ path: `profiles/${OTHER_GUEST_UID}`, method: 'create', auth: anonymousGuest(), requestData: created })).toBe(true)
    expect(allow({ path: `profiles/${OTHER_GUEST_UID}`, method: 'create', auth: allowlistedAdmin(), requestData: created })).toBe(true)
  })

  it('does not let the Admin delete their own Profile', () => {
    const profile = { uid: ADMIN_UID, role: 'admin' }
    expect(deny({ path: `profiles/${ADMIN_UID}`, method: 'delete', auth: allowlistedAdmin(), resourceData: profile })).toBe(true)
    expect(allow({ path: `profiles/${OTHER_GUEST_UID}`, method: 'delete', auth: allowlistedAdmin(), resourceData: { uid: OTHER_GUEST_UID, role: 'guest' } })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

describe('bookings: ownership', () => {
  const booking = bookingDoc()

  it('lets a Guest read their own Booking', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: emailGuest(), resourceData: booking })).toBe(true)
  })

  it('refuses a Guest another Guest\'s Booking', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: booking })).toBe(true)
  })

  it('lets the Admin read, update and delete Bookings', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: allowlistedAdmin(), resourceData: booking })).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'delete', auth: allowlistedAdmin(), resourceData: booking })).toBe(true)
  })

  it('refuses a Guest a delete', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'delete', auth: emailGuest(), resourceData: booking })).toBe(true)
  })
})

describe('bookings: what a Guest may change', () => {
  // A proof upload happens inside Payment Pending, so the stored Booking this
  // branch is asked to change is already there (approval opens payment —
  // Government ID KYC removed 2026-09-27).
  const booking = bookingDoc({ status: 'Payment Pending' })
  const own = { path: `bookings/${BOOKING_ID}`, method: 'update' as const, auth: emailGuest(), resourceData: booking }

  it('accepts the self-serve patch the website sends when proof is uploaded', () => {
    expect(allow({ ...own, requestData: guestPaymentPatch() })).toBe(true)
  })

  /**
   * Was FINDING (high) in the first verification pass: the self-serve key list
   * included `payment_status` and the rule checked *which* keys a Guest touched,
   * never the values — so a Guest could set `payment_status: 'verified'` from a
   * browser console. The rule now constrains the value itself: a Guest may write
   * `unpaid` or `pending`, nothing else.
   */
  it('refuses a Guest who sets their own payment_status to verified', () => {
    expect(deny({ ...own, requestData: guestPaymentPatch({ payment_status: 'verified' }) })).toBe(true)
  })

  it('refuses a Guest who writes the Admin\'s verification fields', () => {
    expect(deny({ ...own, requestData: guestPaymentPatch({ amount_verified: 8500 }) })).toBe(true)
    expect(deny({ ...own, requestData: guestPaymentPatch({ payment_verified_at: '2026-10-01T00:00:00Z' }) })).toBe(true)
    expect(deny({ ...own, requestData: guestPaymentPatch({ payment_verified_by: ADMIN_UID }) })).toBe(true)
  })

  it('refuses a Guest who tries to bring the retired KYC fields back', () => {
    expect(deny({ ...own, requestData: guestPaymentPatch({ kyc_status: 'approved' }) })).toBe(true)
    expect(deny({ ...own, requestData: guestPaymentPatch({ kyc_reject_reason: 'nope' }) })).toBe(true)
  })

  it('refuses a Guest who un-verifies money the Admin already verified', () => {
    const paid = paidBookingDoc()
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: paid,
        requestData: { ...paid, payment_status: 'pending', payment_proof_url: 'payments/x/y/proof.jpg' },
      }),
    ).toBe(true)
  })

  it('bounds the refund a Guest may record when they withdraw a paid Booking', () => {
    const paid = paidBookingDoc()
    const settlement = { stayTotal: 9000, stayRefund: 3250, depositHeld: 2000, damageDeduction: 0, depositRefund: 2000, refundTotal: 5250 }
    const withdrawn = { ...paid, status: 'Cancelled', cancellation_reason: 'changed plans', refund_status: 'initiated', refund_total: 5250, refund_breakdown: settlement }
    expect(
      allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: paid, requestData: withdrawn }),
    ).toBe(true)
    // More than the Admin verified came in: refused.
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: paid,
        requestData: { ...withdrawn, refund_total: 999999, refund_breakdown: { ...settlement, refundTotal: 999999 } },
      }),
    ).toBe(true)
    // A breakdown that disagrees with the total: refused.
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: paid,
        requestData: { ...withdrawn, refund_total: 100, refund_breakdown: settlement },
      }),
    ).toBe(true)
    // `refunded` says the money is back with the Guest — that is the Admin's.
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: { ...withdrawn },
        requestData: { ...withdrawn, refund_status: 'refunded' },
      }),
    ).toBe(true)
    // The Admin records the fact, when it becomes true.
    expect(
      allow({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: withdrawn,
        requestData: { ...withdrawn, refund_status: 'refunded' },
      }),
    ).toBe(true)
  })

  it('lets the Guest of a verified Booking still withdraw it', () => {
    const paid = paidBookingDoc()
    expect(
      allow({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: paid,
        requestData: { ...paid, status: 'Cancelled', cancellation_reason: 'changed plans' },
      }),
    ).toBe(true)
  })

  it('refuses a Guest who clears the Admin\'s rejection note without attaching a new proof', () => {
    const rejected = bookingDoc({ status: 'Payment Pending', payment_status: 'rejected', payment_reject_reason: 'unreadable' })
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: rejected,
        requestData: { ...rejected, payment_reject_reason: null },
      }),
    ).toBe(true)
    expect(
      allow({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: rejected,
        requestData: {
          ...rejected,
          payment_status: 'pending',
          payment_reject_reason: null,
          payment_proof_url: 'payments/x/y/proof2.jpg',
        },
      }),
    ).toBe(true)
  })

  it('refuses a Guest who moves their own Booking to Reserved', () => {
    expect(deny({ ...own, requestData: guestPaymentPatch({ status: 'Reserved' }) })).toBe(true)
  })

  it('refuses a Guest who writes a field the lifecycle does not lend them', () => {
    expect(deny({ ...own, requestData: { ...guestPaymentPatch(), refund_status: 'paid' } })).toBe(true)
    expect(deny({ ...own, requestData: { ...guestPaymentPatch(), guests: 8 } })).toBe(true)
  })

  it('refuses a Guest who re-points their Booking at another identity', () => {
    expect(deny({ ...own, requestData: { ...guestPaymentPatch(), uid: OTHER_GUEST_UID } })).toBe(true)
  })

  it('refuses a Guest a status that un-does an Admin decision', () => {
    const reserved = bookingDoc({ status: 'Reserved' })
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: reserved, requestData: { ...reserved, status: 'Pending' } })).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: reserved, requestData: { ...reserved, status: 'Cancelled', cancellation_reason: 'changed plans' } })).toBe(true)
  })

  it('refuses a Guest whose Booking is not theirs, however small the patch', () => {
    expect(deny({ ...own, auth: emailGuest(OTHER_GUEST_UID), requestData: guestPaymentPatch() })).toBe(true)
  })

  it('refuses a signed-out visitor any update', () => {
    expect(deny({ ...own, auth: null, requestData: guestPaymentPatch() })).toBe(true)
  })
})

describe('bookings: what the Admin may change', () => {
  const pending = bookingDoc()

  it('accepts the Admin patch that verifies a payment and reserves the stay', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: guestPaymentPatch(), requestData: adminVerifyPatch({ status: 'Reserved' }) })).toBe(true)
  })

  it('refuses a retired status, and accepts Approved only when the screenshot was verified', () => {
    // Marker-less Approved is not a confirmation. KYC Submitted stays retired.
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: pending, requestData: bookingDoc({ status: 'Approved' }) })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: pending, requestData: bookingDoc({ status: 'KYC Submitted' }) })).toBe(true)
    expect(allow({
      path: `bookings/${BOOKING_ID}`,
      method: 'update',
      auth: allowlistedAdmin(),
      resourceData: bookingDoc({
        status: 'Pending',
        payment_proof_url: 'payments/guest-uid-1/proof.jpg',
        payment_status: 'pending',
        amount_claimed: 5000,
      }),
      requestData: bookingDoc({
        status: 'Approved',
        payment_proof_url: 'payments/guest-uid-1/proof.jpg',
        payment_status: 'verified',
        amount_claimed: 5000,
        amount_verified: 5000,
        payment_verified_at: '2026-09-24T03:00:00.000Z',
        payment_verified_by: ADMIN_UID,
      }),
    })).toBe(true)
    // A document stored mid-KYC before the removal can still be opened for payment.
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: bookingDoc({ status: 'KYC Submitted' }), requestData: bookingDoc({ status: 'Payment Pending' }) })).toBe(true)
  })

  /**
   * Was FINDING (medium) in the first verification pass: the rule was described
   * as "Reserved needs verified money", but what it enforced was the *previous
   * status*, so a Booking in Payment Pending could be taken to Reserved with the
   * money still `pending`. `reservedIsPaidFor()` is now the first clause of the
   * update rule and binds every writer.
   */
  it('refuses Reserved while the money is still unverified, whoever asks', () => {
    const pending = bookingDoc({ status: 'Payment Pending', payment_status: 'pending' })
    const reserved = bookingDoc({ status: 'Reserved', payment_status: 'pending' })
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: pending, requestData: reserved })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: pending, requestData: reserved })).toBe(true)
    // And it cannot be reached from a Booking that never got as far as payment.
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: bookingDoc({ status: 'Approved' }),
        requestData: bookingDoc({ status: 'Reserved' }),
      }),
    ).toBe(true)
    // Pending + unverified money is refused; the same from-status with the
    // verification in the same write is the legitimate move.
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: bookingDoc({ status: 'Pending' }),
        requestData: adminVerifyPatch(),
      }),
    ).toBe(true)
  })

  it('accepts Reserved from Payment Pending once the money is verified — with the marker', () => {
    const submitted = guestPaymentPatch()
    expect(
      allow({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: submitted,
        requestData: adminVerifyPatch(),
      }),
    ).toBe(true)
    // The same move on a document that already carries the marker, touching
    // something else, stays possible.
    const paid = paidBookingDoc({ status: 'Payment Pending' })
    expect(
      allow({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: paid,
        requestData: { ...paid, status: 'Reserved' },
      }),
    ).toBe(true)
  })

  it('refuses a verification nobody signed: `verified` without the marker', () => {
    const submitted = guestPaymentPatch()
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: submitted,
        requestData: { ...submitted, status: 'Reserved', payment_status: 'verified' },
      }),
    ).toBe(true)
    // An amount alone is not a verification either: the instant and the
    // verifier have to travel with it.
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: submitted,
        requestData: { ...adminVerifyPatch(), payment_verified_at: '', payment_verified_by: '' },
      }),
    ).toBe(true)
  })

  it('refuses a verification signed in another Admin\'s name', () => {
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: guestPaymentPatch(),
        requestData: adminVerifyPatch({ payment_verified_by: 'someone-else' }),
      }),
    ).toBe(true)
  })

  it('refuses a Guest the Admin\'s verification patch', () => {
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: guestPaymentPatch(),
        requestData: adminVerifyPatch(),
      }),
    ).toBe(true)
  })

  it('refuses a status leaving a terminal one', () => {
    for (const terminal of ['Rejected', 'Cancelled', 'Completed', 'Expired']) {
      expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: bookingDoc({ status: terminal }), requestData: bookingDoc({ status: 'Pending' }) })).toBe(true)
    }
  })
})

describe('bookings/{id}/activity: the append-only record', () => {
  const entry = (actor: string, actorId: string): DocData => ({
    booking_id: BOOKING_ID,
    action: 'Submit',
    from_status: null,
    to_status: 'Pending',
    actor,
    actor_id: actorId,
    at: '2026-09-24T02:00:00.000Z',
  })

  /**
   * An entry as `submissionEntry` writes it — no `uid` of its own, because the
   * app never puts one there. Both read cases below were once asserted against a
   * hand-written `uid` on the entry, which is a shape nothing in the codebase
   * produces: the rule read `resource.data`, so it was false in production while
   * the test said true. `activityLogDB.append` reads the log to pick the next
   * sequence number, so that refusal made every Guest append fall back to
   * localStorage and left the Admin looking at an empty audit trail.
   */
  it('lets the Guest it belongs to read the log', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'get', auth: emailGuest(), resourceData: entry('guest', GUEST_UID) })).toBe(true)
  })

  it('lets the Admin read the log', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'get', auth: allowlistedAdmin(), resourceData: entry('admin', ADMIN_UID) })).toBe(true)
  })

  it('refuses another Guest the log', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: entry('guest', GUEST_UID) })).toBe(true)
  })

  it('refuses the log of a Booking that has been deleted out from under it', () => {
    expect(deny({ path: `bookings/never-existed/activity/entry-1`, method: 'get', auth: emailGuest(), resourceData: entry('guest', GUEST_UID) })).toBe(true)
  })

  /**
   * The rule never compared the parent Booking to the writer, so a Guest who knew
   * (or guessed) another Guest's booking id could append entries to that Booking's
   * audit trail. The submitter's own entry is the one they may write.
   */
  it('lets a Guest file entries in their own Booking only', () => {
    const otherGuestsBooking = 'booking-2'
    const store: Store = {
      ...profiles,
      [`bookings/${otherGuestsBooking}`]: bookingDoc({ uid: OTHER_GUEST_UID, ref_id: otherGuestsBooking }),
    }
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-9`, method: 'create', auth: emailGuest(), requestData: entry('guest', GUEST_UID) })).toBe(true)
    expect(allow({ path: `bookings/${otherGuestsBooking}/activity/entry-9`, method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: { ...entry('guest', OTHER_GUEST_UID), booking_id: otherGuestsBooking } }, store)).toBe(true)
    expect(deny({ path: `bookings/${otherGuestsBooking}/activity/entry-9`, method: 'create', auth: emailGuest(), requestData: { ...entry('guest', GUEST_UID), booking_id: otherGuestsBooking } }, store)).toBe(true)
  })

  /**
   * Was FINDING (medium) in the first verification pass: the rule forced `actor`
   * to be the writer's own role but never compared `actor_id` with the writer's
   * uid, so an entry could carry somebody else's id. Both roles and both
   * identities are checked now.
   */
  it('refuses an entry a Guest files in another Guest\'s name', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-2`, method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: entry('guest', GUEST_UID) })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-2b`, method: 'create', auth: emailGuest(), requestData: entry('guest', OTHER_GUEST_UID) })).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-2c`, method: 'create', auth: emailGuest(), requestData: entry('guest', GUEST_UID) })).toBe(true)
  })

  it('refuses an entry an Admin files in somebody else\'s name', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-2d`, method: 'create', auth: allowlistedAdmin(), requestData: entry('admin', GUEST_UID) })).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-2e`, method: 'create', auth: allowlistedAdmin(), requestData: entry('admin', ADMIN_UID) })).toBe(true)
  })

  it('lets the Admin record the system\'s own act, and nobody else', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-2f`, method: 'create', auth: allowlistedAdmin(), requestData: entry('system', 'system') })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-2g`, method: 'create', auth: emailGuest(), requestData: entry('system', 'system') })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-2h`, method: 'create', auth: allowlistedAdmin(), requestData: entry('system', ADMIN_UID) })).toBe(true)
  })

  it('refuses an entry an Admin signs as if a Guest wrote it', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-3`, method: 'create', auth: allowlistedAdmin(), requestData: entry('guest', GUEST_UID) })).toBe(true)
  })

  it('refuses an entry about a different Booking than the one it sits under', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-4`, method: 'create', auth: allowlistedAdmin(), requestData: { ...entry('admin', ADMIN_UID), booking_id: 'other-booking' } })).toBe(true)
  })

  it('never lets anybody edit or delete the record, Admin included', () => {
    const existing = entry('admin', ADMIN_UID)
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'update', auth: allowlistedAdmin(), resourceData: existing, requestData: { ...existing, action: 'rewritten' } })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'delete', auth: allowlistedAdmin(), resourceData: existing })).toBe(true)
  })

  /**
   * Was SEMANTICS: the create rule read `role()` for a Guest, and `role()` reads
   * the token's `email` claim, which an anonymous Guest does not carry — so the
   * answer turned on whether a missing claim raises or reads as null, and on the
   * strict reading a Guest's own submission entry would have been refused.
   *
   * The rule no longer reads a role for a Guest: the Guest branch compares
   * `actor_id` with `request.auth.uid`, which every signed-in identity has. The
   * case is now definite, and asserted under both readings.
   */
  it('lets an anonymous Guest file their own entry — under either reading of a missing claim', () => {
    const write = { path: `bookings/${BOOKING_ID}/activity/entry-5`, method: 'create' as const, auth: anonymousGuest(), requestData: entry('guest', GUEST_UID) }
    expect(evaluate(request(write), rules, { store: profiles }).allow).toBe(true)
    expect(evaluate(request(write), rules, { store: profiles, semantics: { missingKeys: 'null' } }).allow).toBe(true)
  })

  it('lets a signed-out visitor write exactly the submission entry', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-6`, method: 'create', auth: null, requestData: entry('guest', GUEST_UID) })).toBe(true)
    // …and nothing else: the unauthenticated path exists for a Booking made
    // before anybody signed in, so it may file the submission entry only.
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-7`, method: 'create', auth: null, requestData: { ...entry('guest', GUEST_UID), action: 'Approve' } })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-8`, method: 'create', auth: null, requestData: { ...entry('admin', ADMIN_UID), action: 'Approve' } })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('payments: proof and verification', () => {
  const awaiting = bookingDoc({ status: 'Payment Pending', payment_plan: 'Full Payment', payment_status: 'pending' })

  it('lets a Guest submit proof: reference, amount and the proof URL', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: awaiting, requestData: guestPaymentPatch() })).toBe(true)
  })

  it('refuses a Guest who marks the payment verified — from pending, from rejected, from unpaid', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: awaiting, requestData: guestPaymentPatch({ payment_status: 'verified' }) })).toBe(true)
    const rejected = bookingDoc({ status: 'Payment Pending', payment_status: 'rejected', payment_reject_reason: 'unreadable' })
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: rejected,
        requestData: guestPaymentPatch({ payment_status: 'verified' }),
      }),
    ).toBe(true)
    const unpaid = bookingDoc({ status: 'Payment Pending', payment_status: 'unpaid' })
    expect(
      deny({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: emailGuest(),
        resourceData: unpaid,
        requestData: guestPaymentPatch({ payment_status: 'verified' }),
      }),
    ).toBe(true)
  })

  it('refuses a Guest who files a verification, in any of its spellings', () => {
    for (const field of ['amount_verified', 'payment_verified_at', 'payment_verified_by', 'verification_status', 'verified_by', 'verified_at', 'admin_decision']) {
      expect(
        deny({
          path: `bookings/${BOOKING_ID}`,
          method: 'update',
          auth: emailGuest(),
          resourceData: awaiting,
          requestData: guestPaymentPatch({ [field]: 'x' }),
        }),
      ).toBe(true)
    }
  })

  it('refuses a Booking created already claiming a payment state it cannot have', () => {
    expect(
      deny({
        path: 'bookings/new-booking',
        method: 'create',
        auth: anonymousGuest(),
        requestData: bookingDoc({ payment_status: 'verified' }),
      }),
    ).toBe(true)
    expect(
      deny({
        path: 'bookings/new-booking',
        method: 'create',
        auth: anonymousGuest(),
        requestData: bookingDoc({ payment_status: 'pending' }),
      }),
    ).toBe(true)
    expect(
      deny({
        path: 'bookings/new-booking',
        method: 'create',
        auth: anonymousGuest(),
        requestData: bookingDoc(),
      }),
    ).toBe(true)
    expect(
      allow({
        path: 'bookings/new-booking',
        method: 'create',
        auth: anonymousGuest(),
        requestData: bookingDoc({
          payment_status: 'pending',
          payment_proof_url: 'payments/guest-uid-1/proof.jpg',
          amount_claimed: 5000,
        }),
      }),
    ).toBe(true)
  })

  it('refuses a Guest touching any verification field', () => {
    for (const field of ['amount_verified', 'payment_verified_at', 'payment_verified_by', 'refund_status', 'refund_total']) {
      expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: awaiting, requestData: guestPaymentPatch({ [field]: 'x' }) })).toBe(true)
    }
  })

  it('lets the Admin verify or reject', () => {
    const submitted = guestPaymentPatch()
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: submitted, requestData: adminVerifyPatch() })).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: submitted, requestData: { ...submitted, payment_status: 'rejected', payment_reject_reason: 'reference not on the list' } })).toBe(true)
  })

  it('refuses the whole forged verification, status and amount together', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: awaiting, requestData: { ...guestPaymentPatch(), payment_status: 'verified', amount_verified: 8500 } })).toBe(true)
  })
})

describe('payment_references: the Admin catalogue', () => {
  const reference = { reference: 'GCASH-123456', amount: 8500, status: 'available' }

  it('lets only the Admin read the catalogue', () => {
    expect(allow({ path: 'payment_references/GCASH-123456', method: 'get', auth: allowlistedAdmin(), resourceData: reference })).toBe(true)
    expect(deny({ path: 'payment_references/GCASH-123456', method: 'get', auth: emailGuest(), resourceData: reference })).toBe(true)
  })

  it('lets only the Admin write it, with a known status', () => {
    expect(allow({ path: 'payment_references/GCASH-123456', method: 'create', auth: allowlistedAdmin(), requestData: reference })).toBe(true)
    expect(deny({ path: 'payment_references/GCASH-123457', method: 'create', auth: allowlistedAdmin(), requestData: { ...reference, status: 'maybe' } })).toBe(true)
    expect(deny({ path: 'payment_references/GCASH-123458', method: 'create', auth: emailGuest(), requestData: reference })).toBe(true)
  })

  it('refuses a Guest reading whether a reference is used', () => {
    expect(deny({ path: 'payment_references/GCASH-123456', method: 'list', auth: emailGuest() })).toBe(true)
  })

  it('refuses to rewrite or delete a reference that has been used', () => {
    const used = { ...reference, status: 'used' }
    expect(allow({ path: 'payment_references/GCASH-123456', method: 'update', auth: allowlistedAdmin(), resourceData: used, requestData: { ...used, status: 'void' } })).toBe(true)
    expect(deny({ path: 'payment_references/GCASH-123456', method: 'update', auth: allowlistedAdmin(), resourceData: used, requestData: { ...used, reference: 'GCASH-999999', amount: 100 } })).toBe(true)
    expect(deny({ path: 'payment_references/GCASH-123456', method: 'delete', auth: allowlistedAdmin(), resourceData: used })).toBe(true)
    expect(allow({ path: 'payment_references/GCASH-123457', method: 'delete', auth: allowlistedAdmin(), resourceData: reference })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

describe('reviews', () => {
  // The document id is the Booking id, and the store holds that Booking as the
  // Guest's own and finished — which is what the rule reads.
  const path = `reviews/${BOOKING_ID}`

  it('lets a Guest who stayed write a review of their own stay', () => {
    expect(allow({ path, method: 'create', auth: emailGuest(), requestData: reviewDoc() })).toBe(true)
    expect(allow({ path, method: 'create', auth: anonymousGuest(), requestData: reviewDoc() })).toBe(true)
  })

  it('lets the Guest read their own review and the Admin read any', () => {
    expect(allow({ path, method: 'get', auth: emailGuest(), resourceData: reviewDoc() })).toBe(true)
    expect(allow({ path, method: 'get', auth: allowlistedAdmin(), resourceData: reviewDoc() })).toBe(true)
    expect(deny({ path, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: reviewDoc() })).toBe(true)
  })

  it('refuses a signed-out visitor a review', () => {
    expect(deny({ path, method: 'create', auth: null, requestData: reviewDoc() })).toBe(true)
  })

  it('refuses a review signed in somebody else\'s name', () => {
    expect(deny({ path, method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: reviewDoc({ uid: OTHER_GUEST_UID }) })).toBe(true)
  })

  it('refuses a star rating outside 1..5 and a non-integer', () => {
    expect(deny({ path, method: 'create', auth: emailGuest(), requestData: reviewDoc({ stars: 0 }) })).toBe(true)
    expect(deny({ path, method: 'create', auth: emailGuest(), requestData: reviewDoc({ stars: 6 }) })).toBe(true)
    expect(deny({ path, method: 'create', auth: emailGuest(), requestData: reviewDoc({ stars: '5' }) })).toBe(true)
  })

  it('refuses a Guest editing or deleting a review', () => {
    expect(deny({ path, method: 'update', auth: emailGuest(), resourceData: reviewDoc(), requestData: reviewDoc({ stars: 1 }) })).toBe(true)
    expect(deny({ path, method: 'delete', auth: emailGuest(), resourceData: reviewDoc() })).toBe(true)
    expect(allow({ path, method: 'delete', auth: allowlistedAdmin(), resourceData: reviewDoc() })).toBe(true)
    // The Admin removes a review; the Admin does not rewrite it either.
    expect(deny({ path, method: 'update', auth: allowlistedAdmin(), resourceData: reviewDoc(), requestData: reviewDoc({ stars: 1 }) })).toBe(true)
  })

  /**
   * Was FINDING (medium) in the first verification pass: the create rule checked
   * who *wrote* the review, not whether that person had stayed. The rule now
   * reads the Booking the review is about, so all three checks the app made are
   * made by the database as well.
   */
  it('refuses a review of a Booking that is not the writer\'s', () => {
    // The store's Booking belongs to GUEST_UID; this request comes from another Guest.
    expect(
      deny({
        path,
        method: 'create',
        auth: emailGuest(OTHER_GUEST_UID),
        requestData: reviewDoc({ uid: OTHER_GUEST_UID }),
      }),
    ).toBe(true)
  })

  it('refuses a review while the stay is not over', () => {
    const early = storeWith({}, { [`bookings/${BOOKING_ID}`]: bookingDoc({ status: 'Staying' }) })
    expect(allow({ path, method: 'create', auth: emailGuest(), requestData: reviewDoc() }, early)).toBe(false)
    const checkedOut = storeWith({}, { [`bookings/${BOOKING_ID}`]: bookingDoc({ status: 'Checked-Out' }) })
    expect(allow({ path, method: 'create', auth: emailGuest(), requestData: reviewDoc() }, checkedOut)).toBe(true)
  })

  it('refuses a review of a Booking that does not exist', () => {
    expect(allow({ path: 'reviews/booking-does-not-exist', method: 'create', auth: emailGuest(), requestData: reviewDoc({ booking_id: 'booking-does-not-exist' }) })).toBe(false)
  })

  it('refuses a second review for the same stay: the id is the Booking, so it is already taken', () => {
    // The document already exists, so this write is an *update* — and updates are
    // refused to everybody but a delete.
    expect(deny({ path, method: 'update', auth: emailGuest(), resourceData: reviewDoc(), requestData: reviewDoc({ stars: 4 }) })).toBe(true)
    // Writing it under another id is refused because the id has to be the Booking.
    expect(deny({ path: 'reviews/some-other-id', method: 'create', auth: emailGuest(), requestData: reviewDoc() })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

describe('conversations and messages', () => {
  const convo = conversationDoc()

  it('lets a Guest open their own conversation', () => {
    expect(allow({ path: `conversations/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: convo })).toBe(true)
  })

  it('refuses a conversation opened under somebody else\'s uid', () => {
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: convo })).toBe(true)
  })

  it('lets a Guest read their own conversation, and not another Guest\'s', () => {
    expect(allow({ path: `conversations/${CONVO_ID}`, method: 'get', auth: anonymousGuest(), resourceData: convo })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: convo })).toBe(true)
  })

  it('lets the Admin read any conversation', () => {
    expect(allow({ path: `conversations/${CONVO_ID}`, method: 'get', auth: allowlistedAdmin(), resourceData: convo })).toBe(true)
  })

  it('lets a Guest touch only the counters the inbox needs', () => {
    expect(allow({ path: `conversations/${CONVO_ID}`, method: 'update', auth: anonymousGuest(), resourceData: convo, requestData: { ...convo, last_message: 'hi', updated_at: '2026-09-24T03:00:00.000Z' } })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'update', auth: anonymousGuest(), resourceData: convo, requestData: { ...convo, guest_uid: OTHER_GUEST_UID } })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'update', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: convo, requestData: { ...convo, unread_admin: 1 } })).toBe(true)
    // Even the Admin cannot hand one Guest's history to another.
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: convo, requestData: { ...convo, guest_uid: OTHER_GUEST_UID } })).toBe(true)
  })

  it('lets the Admin delete a conversation, and no Guest', () => {
    expect(allow({ path: `conversations/${CONVO_ID}`, method: 'delete', auth: allowlistedAdmin(), resourceData: convo })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'delete', auth: anonymousGuest(), resourceData: convo })).toBe(true)
  })

  it('lets a Guest send a message in their own conversation', () => {
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'create', auth: anonymousGuest(), requestData: messageDoc() })).toBe(true)
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m1b`, method: 'create', auth: emailGuest(), requestData: messageDoc() })).toBe(true)
  })

  it('lets the Admin reply in any conversation, labelled as the Admin', () => {
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m-admin`, method: 'create', auth: allowlistedAdmin(), requestData: messageDoc(ADMIN_UID, 'admin') })).toBe(true)
  })

  it('refuses a message whose sender is somebody else', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m2`, method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: messageDoc() })).toBe(true)
  })

  /**
   * Was FINDING (low) in the first verification pass: knowing a conversation id
   * was enough to post into it, because the rule checked the sender and not the
   * membership. The rule reads the conversation's own `guest_uid` now.
   */
  it('refuses a stranger posting into a conversation they are not part of', () => {
    expect(deny({
      path: `conversations/${CONVO_ID}/messages/m3`,
      method: 'create',
      auth: anonymousGuest(OTHER_GUEST_UID),
      requestData: messageDoc(OTHER_GUEST_UID, 'guest'),
    })).toBe(true)
    expect(deny({
      path: `conversations/${CONVO_ID}/messages/m3b`,
      method: 'create',
      auth: emailGuest(OTHER_GUEST_UID),
      requestData: messageDoc(OTHER_GUEST_UID, 'guest'),
    })).toBe(true)
    // …and they cannot read it back either, before or after trying.
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m3`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: messageDoc() })).toBe(true)
  })

  it('refuses a message into a conversation that does not exist', () => {
    expect(deny({
      path: 'conversations/no-such-conversation/messages/m1',
      method: 'create',
      auth: anonymousGuest(),
      requestData: messageDoc(),
    })).toBe(true)
  })

  it('refuses an empty message, and one over the 1,000-character limit', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m4`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'guest', { text: '' }) })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m5`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'guest', { text: 'x'.repeat(1001) }) })).toBe(true)
  })

  /**
   * The limit has to be the rule's, not the form's: a browser can be told
   * anything, and a thread is read a page at a time, so the cost of an
   * unbounded message is paid on every read. 1,000 is accepted, 1,001 is not.
   */
  it('accepts a message of exactly 1,000 characters and refuses 1,001, from either side', () => {
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m-limit`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'guest', { text: 'x'.repeat(1000) }) })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m-over`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'guest', { text: 'x'.repeat(1001) }) })).toBe(true)
    // The Admin is held to the same figure: the cap is about storage, not role.
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m-admin-limit`, method: 'create', auth: allowlistedAdmin(), requestData: messageDoc(ADMIN_UID, 'admin', { text: 'x'.repeat(1000) }) })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m-admin-over`, method: 'create', auth: allowlistedAdmin(), requestData: messageDoc(ADMIN_UID, 'admin', { text: 'x'.repeat(1001) }) })).toBe(true)
  })

  it('lets the Admin stamp the retention expiry, and no Guest', () => {
    const stamped = ruleTimestamp('2026-12-30T00:00:00.000Z')
    expect(allow({ path: `conversations/${CONVO_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: conversationDoc(), requestData: conversationDoc({ messages_expires_at: stamped }) })).toBe(true)
    // A Guest cannot shorten the window on a thread the hacienda is keeping…
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'update', auth: anonymousGuest(), resourceData: conversationDoc(), requestData: conversationDoc({ messages_expires_at: stamped }) })).toBe(true)
    // …nor open their own thread with one already on it.
    expect(deny({ path: 'conversations/convo-new', method: 'create', auth: anonymousGuest(), requestData: conversationDoc({ messages_expires_at: stamped }) })).toBe(true)
  })

  it('refuses a Guest reading another Guest\'s messages', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: messageDoc() })).toBe(true)
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'get', auth: anonymousGuest(), resourceData: messageDoc() })).toBe(true)
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'get', auth: allowlistedAdmin(), resourceData: messageDoc() })).toBe(true)
  })

  /**
   * Was FINDING (low): `sender_role` was free text, so a Guest could label their
   * own message as the Admin's — a display spoof, since `sender_uid` stayed
   * honest. The label now has to match what the writer is, which is decided in
   * the same rule by membership and the Admin role.
   */
  it('refuses a Guest labelling their message as the Admin\'s', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m6`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'admin') })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m7`, method: 'create', auth: emailGuest(), requestData: messageDoc(GUEST_UID, 'admin') })).toBe(true)
    // Nor may the Admin pass as a Guest.
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m8`, method: 'create', auth: allowlistedAdmin(), requestData: messageDoc(ADMIN_UID, 'guest') })).toBe(true)
  })

  it('never lets anybody edit or delete a message', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'update', auth: allowlistedAdmin(), resourceData: messageDoc(), requestData: messageDoc(GUEST_UID, 'guest', { text: 'edited' }) })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'delete', auth: allowlistedAdmin(), resourceData: messageDoc() })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Smart lock
// ---------------------------------------------------------------------------

describe('access_logs: the Smart Lock record', () => {
  it('records a lock touch by the person who made it', () => {
    expect(allow({ path: 'access_logs/log-1', method: 'create', auth: anonymousGuest(), requestData: accessLogDoc() })).toBe(true)
    expect(allow({ path: 'access_logs/log-2', method: 'create', auth: anonymousGuest(), requestData: accessLogDoc({ result: 'denied', reason: 'expired-booking' }) })).toBe(true)
  })

  it('refuses a row written in somebody else\'s uid', () => {
    expect(deny({ path: 'access_logs/log-3', method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: accessLogDoc() })).toBe(true)
  })

  it('refuses a row with no result, or a result that is not granted/denied', () => {
    expect(deny({ path: 'access_logs/log-4', method: 'create', auth: anonymousGuest(), requestData: accessLogDoc({ result: 'maybe' }) })).toBe(true)
    const missing: DocData = accessLogDoc()
    delete missing.result
    expect(deny({ path: 'access_logs/log-5', method: 'create', auth: anonymousGuest(), requestData: missing })).toBe(true)
  })

  it('refuses a signed-out writer', () => {
    expect(deny({ path: 'access_logs/log-6', method: 'create', auth: null, requestData: accessLogDoc() })).toBe(true)
  })

  it('lets only the Admin read the log', () => {
    expect(allow({ path: 'access_logs/log-1', method: 'get', auth: allowlistedAdmin(), resourceData: accessLogDoc() })).toBe(true)
    expect(deny({ path: 'access_logs/log-1', method: 'get', auth: anonymousGuest(), resourceData: accessLogDoc() })).toBe(true)
  })

  it('lets only the Admin correct or remove a row', () => {
    expect(allow({ path: 'access_logs/log-1', method: 'delete', auth: allowlistedAdmin(), resourceData: accessLogDoc() })).toBe(true)
    expect(deny({ path: 'access_logs/log-1', method: 'delete', auth: anonymousGuest(), resourceData: accessLogDoc() })).toBe(true)
    expect(deny({ path: 'access_logs/log-1', method: 'update', auth: anonymousGuest(), resourceData: accessLogDoc(), requestData: accessLogDoc({ result: 'granted' }) })).toBe(true)
  })

  it('still works now that live location is retired', () => {
    // The guarantee the tracker removal had to keep: the door log is untouched.
    expect(allow({ path: 'access_logs/log-7', method: 'create', auth: anonymousGuest(), requestData: accessLogDoc({ reason: 'rfid-card' }) })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

describe('tracking_sessions: removed, and refused to everybody', () => {
  const session: DocData = {
    bookingId: BOOKING_ID,
    uid: GUEST_UID,
    tracking_consent_at: '2026-10-01T09:00:00.000Z',
    latitude: 14.1,
    longitude: 121.3,
    lastUpdated: '2026-10-01T09:00:00.000Z',
  }

  it('refuses a read by the Guest it names', () => {
    expect(deny({ path: `tracking_sessions/${BOOKING_ID}`, method: 'get', auth: anonymousGuest(), resourceData: session })).toBe(true)
  })

  it('refuses a read by the Admin', () => {
    expect(deny({ path: `tracking_sessions/${BOOKING_ID}`, method: 'get', auth: allowlistedAdmin(), resourceData: session })).toBe(true)
  })

  it('refuses a create by the traveller', () => {
    expect(deny({ path: `tracking_sessions/${BOOKING_ID}`, method: 'create', auth: anonymousGuest(), requestData: session })).toBe(true)
  })

  it('refuses an update, by the Guest and by the Admin', () => {
    expect(deny({ path: `tracking_sessions/${BOOKING_ID}`, method: 'update', auth: anonymousGuest(), resourceData: session, requestData: { ...session, latitude: 14.2 } })).toBe(true)
    expect(deny({ path: `tracking_sessions/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: session, requestData: { ...session, latitude: 14.2 } })).toBe(true)
  })

  it('refuses a listing by anybody', () => {
    expect(deny({ path: 'tracking_sessions', method: 'list', auth: anonymousGuest() })).toBe(true)
    expect(deny({ path: 'tracking_sessions', method: 'list', auth: allowlistedAdmin() })).toBe(true)
  })

  it('leaves the Admin the delete that erases a session recorded before the removal', () => {
    expect(allow({ path: `tracking_sessions/${BOOKING_ID}`, method: 'delete', auth: allowlistedAdmin(), resourceData: session })).toBe(true)
    expect(deny({ path: `tracking_sessions/${BOOKING_ID}`, method: 'delete', auth: anonymousGuest(), resourceData: session })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Live location (ADR-0013)
// ---------------------------------------------------------------------------

describe('location_sessions: the consent, never the position', () => {
  const live = (over: Partial<DocData> = {}) => locationSessionDoc(over)
  const during = { time: Date.parse('2026-10-01T09:00:00.000Z') }

  it('lets the Guest of the conversation open a session for themselves', () => {
    expect(allow({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: live(), time: during.time })).toBe(true)
  })

  it('refuses a Guest opening a session in somebody else\'s conversation', () => {
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: locationSessionDoc({ guest_uid: OTHER_GUEST_UID }), time: during.time })).toBe(true)
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: locationSessionDoc({ guest_uid: OTHER_GUEST_UID }), time: during.time })).toBe(true)
  })

  it('refuses a session claiming to be somebody else\'s', () => {
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: live({ guest_uid: OTHER_GUEST_UID }), time: during.time })).toBe(true)
  })

  it('caps the window at an hour, whatever the client asks for', () => {
    const hour = live({ duration_minutes: 60, expires_at: ruleTimestamp('2026-10-01T10:00:00.000Z') })
    expect(allow({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: hour, time: during.time })).toBe(true)
    const greedy = live({ duration_minutes: 60, expires_at: ruleTimestamp('2027-10-01T09:00:00.000Z') })
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: greedy, time: during.time })).toBe(true)
    const zero = live({ duration_minutes: 0, expires_at: ruleTimestamp('2026-10-01T09:30:00.000Z') })
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: zero, time: during.time })).toBe(true)
  })

  it('refuses a session that is already over when it is written', () => {
    const stale = live({ expires_at: ruleTimestamp('2026-10-01T08:00:00.000Z') })
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: stale, time: during.time })).toBe(true)
  })

  it('refuses a secret that is not a 32-character secret', () => {
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: live({ stream_secret: 'short' }), time: during.time })).toBe(true)
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'create', auth: anonymousGuest(), requestData: live({ stream_secret: 42 }), time: during.time })).toBe(true)
  })

  /**
   * The rule the whole feature rests on. A position written here would be a
   * position stored forever, with no TTL to sweep it — so a document carrying
   * one is refused, in every shape the rules name.
   */
  it('refuses a session that smuggles a position in', () => {
    for (const field of ['lat', 'lng', 'latitude', 'longitude', 'position', 'fix', 'points', 'trail']) {
      expect(
        deny({
          path: `location_sessions/${CONVO_ID}`,
          method: 'create',
          auth: anonymousGuest(),
          requestData: live({ [field]: field === 'lat' ? 14.1 : 'anything' }),
          time: during.time,
        }),
      ).toBe(true)
    }
  })

  it('lets the Admin and the sharing Guest read it, and nobody else', () => {
    expect(allow({ path: `location_sessions/${CONVO_ID}`, method: 'get', auth: allowlistedAdmin(), resourceData: live() })).toBe(true)
    expect(allow({ path: `location_sessions/${CONVO_ID}`, method: 'get', auth: anonymousGuest(), resourceData: live() })).toBe(true)
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: live() })).toBe(true)
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'get', auth: null, resourceData: live() })).toBe(true)
    expect(deny({ path: 'location_sessions', method: 'list', auth: anonymousGuest() })).toBe(true)
  })

  it('lets the Guest end their own session, and change nothing else about it', () => {
    const stopped = live({ active: false, expires_at: ruleTimestamp('2026-10-01T09:10:00.000Z') })
    expect(allow({ path: `location_sessions/${CONVO_ID}`, method: 'update', auth: anonymousGuest(), resourceData: live(), requestData: stopped, time: during.time })).toBe(true)
    // The secret, the owner and the window are what a stream is bound to.
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'update', auth: anonymousGuest(), resourceData: live(), requestData: live({ stream_secret: 'f'.repeat(32) }), time: during.time })).toBe(true)
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'update', auth: anonymousGuest(), resourceData: live(), requestData: live({ duration_minutes: 60, expires_at: ruleTimestamp('2026-10-01T10:00:00.000Z') }), time: during.time })).toBe(true)
  })

  it('will not let a stopped session be reopened', () => {
    expect(deny({
      path: `location_sessions/${CONVO_ID}`,
      method: 'update',
      auth: anonymousGuest(),
      resourceData: live({ active: false, expires_at: ruleTimestamp('2026-10-01T09:10:00.000Z') }),
      requestData: live({ active: true, expires_at: ruleTimestamp('2026-10-01T10:00:00.000Z') }),
      time: during.time,
    })).toBe(true)
  })

  it('lets the Admin or the owning Guest clear the document', () => {
    expect(allow({ path: `location_sessions/${CONVO_ID}`, method: 'delete', auth: allowlistedAdmin(), resourceData: live() })).toBe(true)
    expect(allow({ path: `location_sessions/${CONVO_ID}`, method: 'delete', auth: anonymousGuest(), resourceData: live() })).toBe(true)
    expect(deny({ path: `location_sessions/${CONVO_ID}`, method: 'delete', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: live() })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Anything else
// ---------------------------------------------------------------------------

describe('collections with no rule', () => {
  it('refuses a collection nobody wrote a rule for', () => {
    expect(deny({ path: 'some_future_collection/x', method: 'get', auth: allowlistedAdmin(), resourceData: { a: 1 } })).toBe(true)
    expect(deny({ path: 'some_future_collection/x', method: 'create', auth: anonymousGuest(), requestData: { a: 1 } })).toBe(true)
  })

  it('keeps public read on the site content, and only the Admin writing it', () => {
    expect(allow({ path: 'gallery/img-1', method: 'get', auth: null, resourceData: { url: 'x' } })).toBe(true)
    expect(allow({ path: 'site_config/rates', method: 'get', auth: null, resourceData: { rates: {} } })).toBe(true)
    expect(allow({ path: 'site_config/rates', method: 'update', auth: allowlistedAdmin(), resourceData: { rates: {} }, requestData: { rates: { v: 2 } } })).toBe(true)
    expect(deny({ path: 'site_config/rates', method: 'update', auth: anonymousGuest(), resourceData: { rates: {} }, requestData: { rates: { v: 2 } } })).toBe(true)
  })

  it('keeps rooms and guest_profiles to the Admin', () => {
    expect(allow({ path: 'rooms/1', method: 'get', auth: allowlistedAdmin(), resourceData: { name: 'Main House' } })).toBe(true)
    expect(deny({ path: 'rooms/1', method: 'get', auth: anonymousGuest(), resourceData: { name: 'Main House' } })).toBe(true)
    expect(deny({ path: 'guest_profiles/1', method: 'create', auth: anonymousGuest(), requestData: { name: 'x' } })).toBe(true)
  })
})
