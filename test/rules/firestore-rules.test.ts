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
import { evaluate, type DocData, type Store } from './engine'
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
  messageDoc,
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
  { [`conversations/${CONVO_ID}`]: conversationDoc() },
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

  it('lets a signed-out visitor create an inquiry Booking (the public /book form)', () => {
    expect(allow({ path: 'bookings/new-booking', method: 'create', auth: null, requestData: booking })).toBe(true)
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
  const booking = bookingDoc()
  const own = { path: `bookings/${BOOKING_ID}`, method: 'update' as const, auth: emailGuest(), resourceData: booking }

  it('accepts the self-serve patch the website sends when proof is uploaded', () => {
    expect(allow({ ...own, requestData: guestPaymentPatch() })).toBe(true)
  })

  /**
   * FINDING (high): the self-serve key list includes `payment_status`, and the
   * rule checks *which* keys a Guest touched, never *what values* they wrote
   * into them — so a Guest may set `payment_status: 'verified'` on their own
   * Booking from a browser console. They cannot reach the `Reserved` status
   * (that needs the Admin), but the flag the Admin's money gate reads is
   * forgeable. `docs/VERIFICATION.md` records this as an open defect.
   */
  it('FINDING: lets a Guest set their own payment_status to verified', () => {
    expect(allow({ ...own, requestData: guestPaymentPatch({ payment_status: 'verified' }) })).toBe(true)
  })

  it('refuses a Guest who writes the Admin\'s verification fields', () => {
    expect(deny({ ...own, requestData: guestPaymentPatch({ amount_verified: 8500 }) })).toBe(true)
    expect(deny({ ...own, requestData: guestPaymentPatch({ payment_verified_at: '2026-10-01T00:00:00Z' }) })).toBe(true)
    expect(deny({ ...own, requestData: guestPaymentPatch({ payment_verified_by: ADMIN_UID }) })).toBe(true)
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

  it('refuses a jump to Approved that skips the reviewed ID', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: pending, requestData: bookingDoc({ status: 'Approved' }) })).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: bookingDoc({ status: 'KYC Submitted' }), requestData: bookingDoc({ status: 'Approved' }) })).toBe(true)
  })

  /**
   * FINDING (medium): the rule is described as "Reserved needs verified money",
   * but what it enforces is the *previous status* — a Booking sitting in
   * Payment Pending may be taken to Reserved with `payment_status` still
   * 'pending'. The app's lifecycle refuses that move; the rules would not.
   */
  it('FINDING: allows Reserved from Payment Pending with payment_status still pending', () => {
    expect(
      allow({
        path: `bookings/${BOOKING_ID}`,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: bookingDoc({ status: 'Payment Pending', payment_status: 'pending' }),
        requestData: bookingDoc({ status: 'Reserved', payment_status: 'pending' }),
      }),
    ).toBe(true)
  })

  it('still refuses a Booking that has not reached Payment Pending', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: bookingDoc({ status: 'Approved' }), requestData: bookingDoc({ status: 'Reserved' }) })).toBe(true)
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: bookingDoc({ status: 'Payment Pending', payment_status: 'verified' }), requestData: bookingDoc({ status: 'Reserved', payment_status: 'verified' }) })).toBe(true)
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
    action: 'submit',
    from_status: null,
    to_status: 'Pending',
    actor,
    actor_id: actorId,
    at: '2026-09-24T02:00:00.000Z',
  })

  it('lets the Guest it belongs to read the log', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'get', auth: emailGuest(), resourceData: { booking_id: BOOKING_ID, uid: GUEST_UID } })).toBe(true)
  })

  it('lets the Admin read the log', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'get', auth: allowlistedAdmin(), resourceData: entry('admin', ADMIN_UID) })).toBe(true)
  })

  it('refuses another Guest the log', () => {
    expect(deny({ path: `bookings/${BOOKING_ID}/activity/entry-1`, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: { booking_id: BOOKING_ID, uid: GUEST_UID } })).toBe(true)
  })

  /**
   * FINDING (medium): the rule forces `actor` to be the writer's own role, but
   * never compares `actor_id` with the writer's uid — so an entry can carry
   * somebody else's id while claiming a truthful role. The Audit trail is
   * attributable at role level, not at person level.
   */
  it('FINDING: lets a Guest name another Guest id as the actor_id', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-2`, method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: entry('guest', GUEST_UID) })).toBe(true)
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
   * SEMANTICS — the one case in this file whose answer turns on a question the
   * public reference does not settle: whether reading a token claim the token
   * does not carry (`request.auth.token.email` on an anonymous Guest) raises a
   * rules error or yields `null`.
   *
   * `role()` reads exactly that claim, so on the strict reading its call raises,
   * and the `actor == role()` clause cannot be satisfied by an anonymous Guest —
   * the third clause of the create rule only covers a *signed-out* writer. The
   * website signs a Guest in anonymously before writing their Booking, so this
   * decides whether the guest Activity log fills up in production. The emulator
   * suite carries the same case; run it before changing anything here.
   */
  it('SEMANTICS: an anonymous Guest is refused the actor clause under the strict reading', () => {
    const write = { path: `bookings/${BOOKING_ID}/activity/entry-5`, method: 'create' as const, auth: anonymousGuest(), requestData: entry('guest', GUEST_UID) }
    expect(evaluate(request(write), rules, { store: profiles }).allow).toBe(false)
    // Under the other reading of that claim, the very same write is allowed.
    expect(evaluate(request(write), rules, { store: profiles, semantics: { missingKeys: 'null' } }).allow).toBe(true)
  })

  it('lets a signed-out visitor write exactly the submission entry', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}/activity/entry-6`, method: 'create', auth: null, requestData: entry('guest', GUEST_UID) })).toBe(true)
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

  /**
   * The same FINDING as above, stated where it matters most: the Guest's own
   * write path is the one that carries payment proof, and `payment_status` is
   * on its key list. The Admin's view cannot treat that flag as authoritative.
   */
  it('FINDING: a Guest can set payment_status to verified on their own Booking', () => {
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: awaiting, requestData: guestPaymentPatch({ payment_status: 'verified' }) })).toBe(true)
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

  it('refuses a Guest the Admin\'s amount_verified field, even next to a forged status', () => {
    // The forged status gets through (the FINDING above); the verified *amount*
    // does not, because the key is not on the self-serve list.
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
})

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

describe('reviews', () => {
  const completed = bookingDoc({ status: 'Completed' })

  it('lets a Guest who stayed write a review', () => {
    expect(allow({ path: 'reviews/r1', method: 'create', auth: emailGuest(), requestData: reviewDoc() })).toBe(true)
  })

  it('lets the Guest read their own review and the Admin read any', () => {
    expect(allow({ path: 'reviews/r1', method: 'get', auth: emailGuest(), resourceData: reviewDoc() })).toBe(true)
    expect(allow({ path: 'reviews/r1', method: 'get', auth: allowlistedAdmin(), resourceData: reviewDoc() })).toBe(true)
    expect(deny({ path: 'reviews/r1', method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: reviewDoc() })).toBe(true)
  })

  it('refuses a signed-out visitor a review', () => {
    expect(deny({ path: 'reviews/r2', method: 'create', auth: null, requestData: reviewDoc() })).toBe(true)
  })

  it('refuses a review signed in somebody else\'s name', () => {
    expect(deny({ path: 'reviews/r3', method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: reviewDoc() })).toBe(true)
  })

  it('refuses a star rating outside 1..5 and a non-integer', () => {
    expect(deny({ path: 'reviews/r4', method: 'create', auth: emailGuest(), requestData: reviewDoc({ stars: 0 }) })).toBe(true)
    expect(deny({ path: 'reviews/r5', method: 'create', auth: emailGuest(), requestData: reviewDoc({ stars: 6 }) })).toBe(true)
    expect(deny({ path: 'reviews/r6', method: 'create', auth: emailGuest(), requestData: reviewDoc({ stars: '5' }) })).toBe(true)
  })

  it('refuses a Guest editing or deleting a review', () => {
    expect(deny({ path: 'reviews/r1', method: 'update', auth: emailGuest(), resourceData: reviewDoc(), requestData: reviewDoc({ stars: 1 }) })).toBe(true)
    expect(deny({ path: 'reviews/r1', method: 'delete', auth: emailGuest(), resourceData: reviewDoc() })).toBe(true)
    expect(allow({ path: 'reviews/r1', method: 'delete', auth: allowlistedAdmin(), resourceData: reviewDoc() })).toBe(true)
  })

  // FINDINGS: the rules check who *wrote* a review, not whether that person
  // stayed. These three cases record what the file actually does; the app does
  // the eligibility check, which a console can skip. See docs/VERIFICATION.md.
  it('FINDING: does not check that the Booking being reviewed is the review author\'s', () => {
    expect(allow({ path: 'reviews/r7', method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: reviewDoc({ uid: OTHER_GUEST_UID }) })).toBe(true)
  })

  it('FINDING: does not check that the reviewed stay is complete', () => {
    const pending = bookingDoc({ status: 'Pending' })
    expect(pending.status).toBe('Pending')
    expect(allow({ path: 'reviews/r8', method: 'create', auth: emailGuest(), requestData: reviewDoc() })).toBe(true)
  })

  it('FINDING: a second review for the same Booking is a new document, not a reused one', () => {
    // Two different document ids both satisfy the rule; only an app-level check
    // stops a Guest from writing both. See the emulator suite for the same case.
    expect(allow({ path: 'reviews/r9-a', method: 'create', auth: emailGuest(), requestData: reviewDoc() })).toBe(true)
    expect(allow({ path: 'reviews/r9-b', method: 'create', auth: emailGuest(), requestData: reviewDoc() })).toBe(true)
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
  })

  it('lets the Admin delete a conversation, and no Guest', () => {
    expect(allow({ path: `conversations/${CONVO_ID}`, method: 'delete', auth: allowlistedAdmin(), resourceData: convo })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}`, method: 'delete', auth: anonymousGuest(), resourceData: convo })).toBe(true)
  })

  it('lets a Guest send a message in their own conversation', () => {
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'create', auth: anonymousGuest(), requestData: messageDoc() })).toBe(true)
  })

  it('refuses a message whose sender is somebody else', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m2`, method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: messageDoc() })).toBe(true)
  })

  /**
   * FINDING (low): the create rule for a message checks that the message is
   * *signed* by its sender, but not that the sender belongs to the conversation
   * it is written into. A stranger who learns a conversation id can post into
   * it; they cannot read it back, and the inbox will show it.
   */
  it('FINDING: lets a Guest post into a conversation that is not theirs', () => {
    expect(allow({
      path: `conversations/${CONVO_ID}/messages/m3`,
      method: 'create',
      auth: anonymousGuest(OTHER_GUEST_UID),
      requestData: messageDoc(OTHER_GUEST_UID, 'guest'),
    })).toBe(true)
  })

  it('refuses an empty or oversized message', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m4`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'guest', { text: '' }) })).toBe(true)
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m5`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'guest', { text: 'x'.repeat(2001) }) })).toBe(true)
  })

  it('refuses a Guest reading another Guest\'s messages', () => {
    expect(deny({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: messageDoc() })).toBe(true)
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'get', auth: anonymousGuest(), resourceData: messageDoc() })).toBe(true)
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'get', auth: allowlistedAdmin(), resourceData: messageDoc() })).toBe(true)
  })

  // SEMANTICS: `sender_role` is not checked against the writer's real role, so a
  // Guest can label a message 'admin'. The message is still attributable, which
  // is what the rule is written to guarantee.
  it('FINDING: lets a Guest label their own message as an Admin\'s', () => {
    expect(allow({ path: `conversations/${CONVO_ID}/messages/m6`, method: 'create', auth: anonymousGuest(), requestData: messageDoc(GUEST_UID, 'admin') })).toBe(true)
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
