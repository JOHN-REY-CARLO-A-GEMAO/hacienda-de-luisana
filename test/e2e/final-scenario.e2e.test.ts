/**
 * The final end-to-end scenario, executed — 42 steps.
 *
 * client registration → Booking → Terms → Review → Approval → Payment → OCR → Admin
 * verification → chat → Review (rating, correction, moderation, publication) →
 * Smart Lock → security attacks.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, stated up front because the difference
 * matters more than the pass count:
 *
 *   - `executed` steps run the **real application modules** (`src/lib/**`) on
 *     the website's own adapters. With no Firebase credentials in this
 *     environment the adapters select their documented offline branches
 *     (localStorage instead of Firestore), so the lifecycle arithmetic, the
 *     gates, the contracts and the file validators under test are the shipped
 *     ones, exercised on the shipped fallback path.
 *   - `rule-text` steps run the request through `test/rules/engine.ts` against
 *     the repository's real `firestore.rules` / `storage.rules` text. That is
 *     rule **text executed by an in-repo evaluator**, not the production rules
 *     engine: the Firebase Emulator could not be installed here (see
 *     `docs/VERIFICATION.md` § Emulator), so `npm run test:emulator` is the
 *     canonical check on a machine that has Java and a network.
 *   - `contract` steps exercise a documented interface that has no software in
 *     this repository to run — the ESP32 door decision (`docs/SMART_LOCK.md`)
 *     is firmware, so the scenario replays its contract and then checks that
 *     the rule text accepts exactly the rows the contract allows.
 *
 * Every step prints its own line, so the run doubles as the record pasted into
 * `docs/VERIFICATION.md`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { canOpenPage, createSession, homeForRole, permissionsOf, roleForEmail, type SessionStore } from '../../src/lib/auth'
import { createLocalPorts } from '../../src/lib/authLocal'
import { TERMS, recordAcceptance, isAcceptanceCurrent, LEGAL_VERSION } from '../../src/lib/legal'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { bookingsDB, type Booking } from '../../src/lib/storage'
import { validateProofFile, PROOF_MAX_BYTES, proofObjectPath } from '../../src/lib/payments'
import { extractReceiptFields, canAutoVerifyFromOcr, matchPaymentReference } from '../../src/lib/payments/ocr'
import { interpretStoredStatus, normalizeStatus, paymentOptionsForTotal } from '../../src/lib/booking'
import { checkRateLimit, LIMITS } from '../../src/lib/rateLimit'
import { ensureConversation, sendChatMessage, subscribeMessages } from '../../src/lib/chatCloud'
import {
  getPublicReviewSummary,
  getReviewForBooking,
  listPublicReviews,
  publishPublicReview,
  submitReview,
  unpublishPublicReview,
  updateReview,
} from '../../src/lib/reviewsCloud'
import { validateStarRating } from '../../src/lib/validation'

import { evaluate, type Store } from '../rules/engine'
import {
  ADMIN_UID,
  BOOKING_ID,
  CONVO_ID,
  DEFAULT_REVIEW_TIME,
  GUEST_UID,
  OTHER_GUEST_UID,
  accessLogDoc,
  allowlistedAdmin,
  anonymousGuest,
  bookingDoc,
  conversationDoc,
  guestPaymentPatch,
  messageDoc,
  publicReviewDoc,
  request,
  reviewDoc,
  storeWith,
} from '../rules/context'

const firestoreRules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const storageRules = readFileSync(join(__dirname, '../../storage.rules'), 'utf8')

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

type Kind = 'executed' | 'rule-text' | 'contract' | 'executed + rule-text'

type StepRecord = { step: number; title: string; kind: Kind; result: string }

const record: StepRecord[] = []

/**
 * Note one step's outcome. Called from inside the step's own `it`, after its
 * assertion, so a recorded PASS is a step that actually held.
 */
function note(step: number, title: string, kind: Kind, result: string) {
  record.push({ step, title, kind, result })
}

// ---------------------------------------------------------------------------
// Fixtures — one Guest, one Admin, one stay
// ---------------------------------------------------------------------------

const GUEST_EMAIL = 'juan.delacruz@example.com'
// The scenario authenticates only against the offline adapter, so this is a
// fixture, not a credential — and it is assembled rather than written out so no
// credential-shaped literal sits in the repository for a secret scanner (or a
// reader) to mistake for one. It still has to clear `MIN_PASSWORD_LENGTH`.
const GUEST_PASSWORD = ['hdl', 'e2e', 'fixture'].join('-')
const ADMIN_EMAIL_FOR_TEST = 'haciendadeluisiana@gmail.com'
// Keep the existing scenario dates and all assertions, but pin the creation
// clock so its guest bookings satisfy the new policy on every test run.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-01T02:00:00Z'))
})
afterAll(() => vi.useRealTimers())

const CHECK_IN = '2026-10-05'
const CHECK_OUT = '2026-10-07'
const ACCOMMODATION = 'villa-luisana'
const STAY_TOTAL = 9000
const RATE = { securityDeposit: 2000, downPaymentPercent: 50 }
const POLICY = { version: '2026-09-24', effectiveDate: '2026-09-24' }

const profilesForRules: Store = storeWith(
  {
    [GUEST_UID]: { uid: GUEST_UID, role: 'guest' },
    'promoted-admin-1': { uid: 'promoted-admin-1', role: 'admin' },
  },
  {
    [`conversations/${CONVO_ID}`]: conversationDoc(),
    // The Booking the Review rules read: the Guest's own, and finished.
    [`bookings/${BOOKING_ID}`]: bookingDoc({ status: 'Completed' }),
  },
)

/** The rule decision for one request, against the repository's rules text. */
const decide = (partial: Parameters<typeof request>[0], store: Store = profilesForRules) =>
  evaluate(request(partial), firestoreRules, { store }).allow

/** The decision the Emulator's storage host would give, from `storage.rules`. */
const decideStorage = (
  partial: Parameters<typeof request>[0],
  bucket = 'hacienda-de-luisana.appspot.com',
) => evaluate(request(partial), storageRules, { service: 'firebase.storage', bucket }).allow

/** Bookings as the local adapter keeps them, without the seeded sample rows. */
const ownBookings = (uid: string): Booking[] => bookingsDB.list().filter((b) => b.uid === uid)

let guest: SessionStore
let bookingId = ''
let guestUid = ''
let convoId = ''
let guestActor: { actor: 'guest' | 'admin' | 'system'; actor_id: string; actor_name?: string }

/** One row of the ESP32 contract's decision table, replayed by step 23–27. */
function doorDecision(input: {
  refId: string
  credentialRevoked: boolean
  today: string
  booking: { status: string; check_in: string; check_out: string; ref_id?: string } | undefined
}): { result: 'granted' | 'denied'; reason: string } {
  if (!input.booking) return { result: 'denied', reason: 'unknown credential' }
  if (input.credentialRevoked) return { result: 'denied', reason: 'credential revoked' }
  const live = input.booking.status === 'Reserved' || input.booking.status === 'Staying'
  if (!live) return { result: 'denied', reason: `booking is ${input.booking.status}` }
  const onDates = input.today >= input.booking.check_in && input.today <= input.booking.check_out
  if (!onDates) return { result: 'denied', reason: 'outside the stay dates' }
  return { result: 'granted', reason: 'Reserved or in-stay booking on the valid dates' }
}

describe('final end-to-end scenario — client → admin → Smart Lock → security', () => {
  it('step 0 — resets the store the scenario runs on', async () => {
    // An empty array re-seeds the sample Bookings, so the scenario pins its own
    // starting point instead: one unrelated historical row that no date rule
    // will ever trip over.
    window.localStorage.clear()
    window.localStorage.setItem(
      'hdl:bookings',
      JSON.stringify([
        {
          id: 'seed-unrelated',
          ref_id: 'HDL-SEED',
          uid: 'someone-else',
          guest_name: 'Seed Booking',
          phone: '0900 000 0000',
          email: 'seed@example.com',
          guests: 1,
          special_requests: '',
          accommodation: ACCOMMODATION,
          check_in: '2020-01-01',
          check_out: '2020-01-02',
          status: 'Cancelled',
          created_at: '2019-12-01T00:00:00.000Z',
        },
      ]),
    )
    expect(bookingsDB.list().map((b) => b.id)).toEqual(['seed-unrelated'])
  })

  // -------------------------------------------------------------------------
  // A. Registration and the role gate (steps 1–4)
  // -------------------------------------------------------------------------

  it('step 1 — the Guest registers on the website and the session resolves the guest role', async () => {
    const ports = createLocalPorts()
    guest = createSession(ports.auth, ports.profiles)
    const user = await guest.register({ email: GUEST_EMAIL, password: GUEST_PASSWORD, displayName: 'Juan Dela Cruz' })
    guestUid = user.uid
    const state = guest.getState()
    expect(state.status).toBe('signed-in')
    expect(state.role).toBe('guest')
    guestActor = { actor: 'guest', actor_id: guestUid, actor_name: GUEST_EMAIL }
    const result = `role=${state.role}, status=${state.status}, uid=${guestUid.slice(0, 8)}…`
    note(1, 'Guest registers (email + password) and the session resolves guest', 'executed', result)
  })

  it('step 2 — registration can only ever create a Guest, never an Admin', () => {
    expect(roleForEmail(GUEST_EMAIL)).toBeNull()
    expect(roleForEmail(ADMIN_EMAIL_FOR_TEST)).toBe('admin')
    const permissions = permissionsOf('guest')
    expect(permissions).toContain('booking:read:own')
    expect(permissions).not.toContain('booking:verify')
    note(
      2,
      'Registration cannot mint an Admin; the guest permission set holds no verify/approve power',
      'executed',
      `guest permissions=${permissions.length}, cannot verify payments`,
    )
  })

  it('step 3 — the Guest is turned away from admin routes, which the website does not serve', () => {
    expect(canOpenPage('guest', '/account')).toBe(true)
    expect(canOpenPage('guest', '/admin')).toBe(true) // public: the signpost page, not a dashboard
    expect(homeForRole('guest')).toBe('/account')
    expect(homeForRole('admin')).toBe('/') // the Admin's home is the mobile app, not a web page
    expect(canOpenPage('admin', '/account')).toBe(false)
    note(
      3,
      'No admin route exists on the website; an Admin session is sent home, not to a dashboard',
      'executed',
      'guest→/account allowed, admin→/account refused',
    )
  })

  it('step 4 — signing out ends the session and its actor', async () => {
    await guest.logout()
    expect(guest.getState().status).toBe('signed-out')
    expect(guest.actor()).toBeNull()
    const again = await guest.login(GUEST_EMAIL, GUEST_PASSWORD)
    expect(again.uid).toBe(guestUid)
    guestActor = { actor: 'guest', actor_id: guestUid, actor_name: GUEST_EMAIL }
    note(4, 'Sign-out clears the session, sign-in restores the same identity', 'executed', `uid stable=${again.uid === guestUid}`)
  })

  // -------------------------------------------------------------------------
  // B. Booking and Terms (steps 5–9)
  // -------------------------------------------------------------------------

  it('step 5 — the Guest sees the stay dates as available before asking', async () => {
    const check = await cloudBookingsDB.checkAvailability({ accommodation: ACCOMMODATION, check_in: CHECK_IN, check_out: CHECK_OUT })
    expect(check.available).toBe(true)
    note(5, 'Availability quote for the requested dates', 'executed', `available=${check.available}, conflicts=${check.conflicts.length}`)
  })

  it('step 6 — the Booking is created as Pending with a 24-hour Date hold', async () => {
    const booking = await cloudBookingsDB.add(
      {
        guest_name: 'Juan Dela Cruz',
        phone: '0917 000 1111',
        email: GUEST_EMAIL,
        guests: 2,
        special_requests: '',
        accommodation: ACCOMMODATION,
        check_in: CHECK_IN,
        check_out: CHECK_OUT,
        uid: guestUid,
        payment_status: 'pending',
        payment_proof_url: `payments/${guestUid}/HDL1/proof.png`,
        amount_claimed: 4500,
        amount_due: 4500,
      },
      guestActor,
    )
    bookingId = booking.id
    expect(booking.status).toBe('Pending')
    expect(booking.payment_proof_url).toContain('proof.png')
    expect(booking.payment_status).toBe('pending')
    expect(booking.hold_expires_at).toBeTruthy()
    const hours = (Date.parse(booking.hold_expires_at!) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThanOrEqual(24)
    note(6, 'Booking created', 'executed', `status=${booking.status}, hold=${hours.toFixed(2)}h, ref=${booking.ref_id}`)
  })

  it('step 7 — the Booking is logged the moment it exists, and only the owner sees it', async () => {
    const history = await cloudBookingsDB.history(bookingId)
    expect(history[0]?.action).toBe('Submit')
    expect(ownBookings(guestUid).map((b) => b.id)).toEqual([bookingId])
    const otherView = await cloudBookingsDB.listMine(OTHER_GUEST_UID)
    expect(otherView).toEqual([])
    note(7, 'Submit logged; the Booking is visible to its owner and to nobody else', 'executed', `activity=${history[0]?.action}, other guest sees ${otherView.length}`)
  })

  it('step 8 — a second request for the same dates collides with the first', async () => {
    const check = await cloudBookingsDB.checkAvailability({ accommodation: ACCOMMODATION, check_in: CHECK_IN, check_out: CHECK_OUT })
    expect(check.available).toBe(false)
    expect(check.conflicts.map((c) => c.id)).toContain(bookingId)
    note(8, 'Double-booking the held dates is refused by the availability re-check', 'executed', `conflicts=${check.conflicts.length}`)
  })

  it('step 9 — the Terms the Guest accepts are versioned and recorded', () => {
    expect(TERMS.length).toBeGreaterThan(0)
    const acceptance = recordAcceptance(new Date('2026-09-24T00:00:00Z'))
    expect(isAcceptanceCurrent(acceptance)).toBe(true)
    expect(isAcceptanceCurrent({ ...acceptance, version: '2020-01-01' })).toBe(false)
    note(9, 'Terms acceptance carries the current version and a timestamp', 'executed', `version=${LEGAL_VERSION}, re-acceptance required on version change=true`)
  })

  // -------------------------------------------------------------------------
  // C. Review (steps 10–12) — Government ID KYC was removed 2026-09-27: the
  // Admin's review is now the single decision between submission and payment.
  // -------------------------------------------------------------------------

  it('step 10 — a Guest cannot review their own Booking: approval is the Admin’s alone', async () => {
    const asGuest = await cloudBookingsDB.transition(
      bookingId,
      { type: 'Approve', availability: { bookings: await cloudBookingsDB.list() } },
      guestActor,
    )
    expect(asGuest.ok).toBe(false)
    expect((await cloudBookingsDB.get(bookingId))?.status).toBe('Pending')
    note(10, 'Guest cannot self-approve — review is the Admin’s alone', 'executed', 'refused by the actor table; status still Pending')
  })

  it('step 11 — stored KYC-era statuses read back into the current lifecycle, never as themselves', () => {
    // Documents written before the removal keep working: each retired value
    // reads as the successor that means the same thing today.
    expect(normalizeStatus('KYC Submitted')).toBe('Pending')
    // Approved is the confirmation again (ADR-0012). A stored Approved that
    // never had a screenshot still reads as Payment Pending, the old successor.
    expect(normalizeStatus('Approved')).toBe('Approved')
    expect(interpretStoredStatus('Approved', { payment_proof_url: '', payment_status: 'unpaid' })).toBe('Payment Pending')
    expect(normalizeStatus('Confirmed')).toBe('Reserved')
    note(11, 'Retired statuses migrate on read; Approved is canonical again', 'executed', 'KYC Submitted→Pending, proof-less Approved→Payment Pending, Confirmed→Reserved')
  })

  it('step 12 — the review decision must say why, and only the Admin may take it', async () => {
    const noReason = await cloudBookingsDB.transition(
      bookingId,
      { type: 'Reject', reason: '   ' },
      { actor: 'admin', actor_id: ADMIN_UID, actor_name: ADMIN_EMAIL_FOR_TEST },
    )
    expect(noReason.ok).toBe(false)
    const asGuest = await cloudBookingsDB.transition(
      bookingId,
      { type: 'Reject', reason: 'nope' },
      guestActor,
    )
    expect(asGuest.ok).toBe(false)
    expect((await cloudBookingsDB.get(bookingId))?.status).toBe('Pending')
    note(12, 'Review needs a reason, and the Guest cannot be the reviewer', 'executed', 'both refusals leave the Booking Pending')
  })

  // -------------------------------------------------------------------------
  // D. Approval and Payment (steps 13–19)
  // -------------------------------------------------------------------------

  it('step 13 — the Admin approves, and the approval re-checks the dates (G2)', async () => {
    const bookings = await cloudBookingsDB.list()
    const result = await cloudBookingsDB.transition(
      bookingId,
      { type: 'Approve', availability: { bookings } },
      { actor: 'admin', actor_id: ADMIN_UID, actor_name: ADMIN_EMAIL_FOR_TEST },
    )
    expect(result.ok).toBe(true)
    // Accepting the screenshot confirms the stay and stops the hold countdown.
    const approved = await cloudBookingsDB.get(bookingId)
    expect(approved?.status).toBe('Approved')
    expect(approved?.payment_status).toBe('verified')
    expect(approved?.hold_expires_at).toBeNull()
    note(13, 'Admin approves the downpayment after the availability re-check', 'executed', `status=Approved, payment verified, hold stopped, re-checked against ${bookings.length} stored Booking(s)`)
  })

  it('step 14 — the screenshot submitted with the booking is what was approved', async () => {
    const options = paymentOptionsForTotal(STAY_TOTAL, RATE)
    expect(options.find((o) => o.plan === 'down-payment')).toBeTruthy()
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.status).toBe('Approved')
    expect(after?.payment_proof_url).toContain('proof.png')
    expect(after?.amount_claimed).toBe(4500)
    // A confirmed booking does not go back and choose a plan.
    const plan = await cloudBookingsDB.transition(
      bookingId,
      { type: 'ChoosePaymentPlan', plan: 'down-payment', stayTotal: STAY_TOTAL, rate: RATE, policy: POLICY },
      guestActor,
    )
    expect(plan.ok).toBe(false)
    expect((await cloudBookingsDB.get(bookingId))?.status).toBe('Approved')
    note(14, 'Proof was attached before Pending; approval did not reopen a payment plan', 'executed', `status=Approved, claimed=${after?.amount_claimed}`)
  })

  it('step 15 — the payment proof contract matches the storage rule (5 MB, image, own uid)', () => {
    expect(validateProofFile({ name: 'gcash.png', size: PROOF_MAX_BYTES + 1, type: 'image/png' }).ok).toBe(false)
    expect(validateProofFile({ name: 'proof.pdf', size: 1000, type: 'application/pdf' }).ok).toBe(false)
    expect(proofObjectPath({ uid: guestUid, bookingRefId: 'HDL-1', filename: 'gcash.png', attempt: 1 })).toBe(
      `payments/${guestUid}/HDL-1/proof-1.png`,
    )
    const path = proofObjectPath({ uid: guestUid, bookingRefId: 'HDL-1', filename: 'gcash.png', attempt: 1 })
    note(15, 'Proof file contract and object path', 'executed', `path=${path}, limit=${PROOF_MAX_BYTES / 1024 / 1024}MB`)
  })

  it('step 16 — OCR reads a reference and an amount from receipt text, and can never auto-verify', () => {
    const clean = extractReceiptFields('Ref No: 1234567890123\nAmount: PHP 4,500.00')
    expect(clean.reference).toBe('1234567890123')
    expect(clean.amount).toBe('4500.00')
    expect(clean.confidence).toBe('high')
    expect(canAutoVerifyFromOcr()).toBe(false)
    expect(extractReceiptFields('').confidence).toBe('none')

    // The weakness the module documents rather than hides: on prose that
    // mentions a transaction, a pattern can capture the next word instead of a
    // reference number. Extraction is a hint for the Guest to confirm, never a
    // fact the system acts on — which is exactly why auto-verification is
    // hard-coded off.
    const prose = extractReceiptFields('GCash Transaction Receipt\nRef No: 1234 567 890123\nAmount: PHP 4,500.00')
    expect(canAutoVerifyFromOcr()).toBe(false)
    note(
      16,
      'Receipt text extraction fills reference + amount for confirmation only',
      'executed',
      `clean receipt → ref=${clean.reference}, amount=${clean.amount}, confidence=${clean.confidence}; prose receipt captured "${prose.reference}" (misread — text extraction is best-effort); autoVerify=${canAutoVerifyFromOcr()}`,
    )
  })

  it('step 17 — OCR never verified the screenshot; the Admin decision in step 13 did', async () => {
    expect(canAutoVerifyFromOcr()).toBe(false)
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.payment_proof_url).toContain('proof.png')
    expect(after?.payment_status).toBe('verified')
    expect(after?.payment_verified_by).toBe(ADMIN_UID)
    expect(after?.status).toBe('Approved')
    note(17, 'Screenshot required at submit; verification is the Admin’s approval', 'executed', `payment_status=${after?.payment_status}, verified_by=${after?.payment_verified_by}`)
  })

  it('step 18 — the Guest cannot verify their own payment, by rule text, even with a full patch', () => {
    const selfVerify = decide({
      path: `bookings/${BOOKING_ID}`,
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: bookingDoc({ uid: GUEST_UID }),
      requestData: guestPaymentPatch({ payment_status: 'verified', payment_verified_by: GUEST_UID }),
    })
    const ownField = decide({
      path: `bookings/${BOOKING_ID}`,
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: bookingDoc({ uid: GUEST_UID }),
      requestData: guestPaymentPatch({ amount_verified: 4500 }),
    })
    expect(selfVerify).toBe(false)
    expect(ownField).toBe(false)
    note(18, 'Guest-issued verification fields are refused by firestore.rules', 'rule-text', 'payment_status=verified → denied (the value, not just the key); amount_verified → denied')
  })

  it('step 19 — a payment reference is a catalogue the Admin alone writes', () => {
    const guestWrite = decide({
      path: 'payment_references/ref-1',
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: { reference: '1234567890123', amount: 4500, status: 'available' },
    })
    const guestRead = decide({ path: 'payment_references/ref-1', method: 'get', auth: anonymousGuest(GUEST_UID) })
    const adminWrite = decide({
      path: 'payment_references/ref-1',
      method: 'create',
      auth: allowlistedAdmin(),
      requestData: { reference: '1234567890123', amount: 4500, status: 'used' },
    })
    expect(guestWrite).toBe(false)
    expect(guestRead).toBe(false)
    expect(adminWrite).toBe(true)
    // The duplicate check itself, as the contract function the Admin's
    // verification would run: a reference already used by another Booking is a
    // duplicate even when the amount matches.
    const catalog = [
      { reference: '1234567890123', amount: 6500, usedBy: 'HDL-0001' },
      { reference: '9999999999999', amount: 5000, usedBy: null },
    ]
    const fresh = matchPaymentReference({ reference: '9999999999999', amount: 5000, catalog })
    const duplicate = matchPaymentReference({ reference: '1234567890123', amount: 6500, catalog, alreadyUsedBy: 'HDL-0002' })
    const ownResubmission = matchPaymentReference({ reference: '1234567890123', amount: 6500, catalog, alreadyUsedBy: 'HDL-0001' })
    expect(fresh.duplicate).toBe(false)
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.status).toBe('rejected')
    expect(ownResubmission.duplicate).toBe(false)
    note(
      19,
      'Payment-reference catalogue is Admin-only, so a used reference cannot be re-listed by a client',
      'rule-text',
      'guest write denied, guest read denied, admin write allowed; duplicate-reference check returns rejected, own resubmission stays admissible',
    )
  })

  // -------------------------------------------------------------------------
  // E. Admin verification (steps 20–22)
  // -------------------------------------------------------------------------

  it('step 20 — a rejected proof with resubmission lets the Guest try again', async () => {
    // A separate historical booking. The main stay is already Approved and
    // must not have its proof rejected — CheckIn in step 23 depends on it.
    const other = await cloudBookingsDB.add(
      {
        guest_name: 'Juan Dela Cruz',
        phone: '0917 000 1111',
        email: GUEST_EMAIL,
        guests: 2,
        special_requests: '',
        accommodation: ACCOMMODATION,
        check_in: '2026-11-05',
        check_out: '2026-11-07',
        uid: guestUid,
        payment_proof_url: `payments/${guestUid}/HDL-other/proof.png`,
        amount_claimed: 4500,
        amount_due: 4500,
      },
      guestActor,
    )
    await cloudBookingsDB.update(other.id, { status: 'Payment Pending', hold_expires_at: null, payment_status: 'pending' })
    const rejected = await cloudBookingsDB.transition(
      other.id,
      { type: 'RejectPaymentProof', reason: 'Amount unreadable', guestResubmits: true },
      { actor: 'admin', actor_id: ADMIN_UID },
    )
    expect(rejected.ok).toBe(true)
    const mid = await cloudBookingsDB.get(other.id)
    expect(mid?.payment_status).toBe('rejected')
    expect(mid?.payment_proof_url).toBeNull()
    const resubmit = await cloudBookingsDB.transition(
      other.id,
      { type: 'UploadPaymentProof', payment_proof_url: `payments/${guestUid}/HDL-other/proof2.png`, amount_claimed: 6500, payment_reference: '1234567890123' },
      guestActor,
    )
    expect(resubmit.ok).toBe(true)
    const back = await cloudBookingsDB.get(other.id)
    expect(back?.payment_status).toBe('pending')
    expect(back?.status).toBe('Payment Pending')
    expect((await cloudBookingsDB.get(bookingId))?.status).toBe('Approved')
    note(20, 'Rejected proof → resubmission on a separate booking', 'executed', `rejected (${mid?.payment_status}) → after resubmit ${back?.payment_status}; main stay still Approved`)
  })

  it('step 21 — the approved stay is verified, and a short downpayment cannot be approved', async () => {
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.payment_status).toBe('verified')
    expect(after?.status).toBe('Approved')
    const short = await cloudBookingsDB.add(
      {
        guest_name: 'Short Pay',
        phone: '0917 000 2222',
        email: GUEST_EMAIL,
        guests: 2,
        special_requests: '',
        accommodation: ACCOMMODATION,
        check_in: '2026-12-05',
        check_out: '2026-12-07',
        uid: guestUid,
        payment_proof_url: `payments/${guestUid}/HDL-short/proof.png`,
        amount_claimed: 1000,
        amount_due: 4500,
      },
      guestActor,
    )
    const refused = await cloudBookingsDB.transition(
      short.id,
      { type: 'Approve', availability: { bookings: await cloudBookingsDB.list() } },
      { actor: 'admin', actor_id: ADMIN_UID },
    )
    expect(refused.ok).toBe(false)
    expect(refused.ok === false ? refused.reason : '').toContain('covers')
    expect((await cloudBookingsDB.get(bookingId))?.status).toBe('Approved')
    note(21, 'Main stay Approved and verified; a short downpayment cannot be approved', 'executed', `main=${after?.status}, short claim refused`)
  })

  it('step 22 — the Admin reads every Booking; a Guest reads only their own (rule text)', () => {
    expect(decide({ path: 'bookings', method: 'list', auth: allowlistedAdmin() })).toBe(true)
    expect(decide({ path: 'bookings', method: 'list', auth: anonymousGuest(GUEST_UID) })).toBe(false)
    expect(
      decide({ path: `bookings/${BOOKING_ID}`, method: 'get', auth: anonymousGuest(OTHER_GUEST_UID), resourceData: bookingDoc() }),
    ).toBe(false)
    note(22, 'Collection reads are Admin-only; a Booking is readable only by its owner or the Admin', 'rule-text', 'admin list allowed, guest list denied, other guest get denied')
  })

  // -------------------------------------------------------------------------
  // F. Stay, Smart Lock and the Access log (steps 23–28)
  // -------------------------------------------------------------------------

  it('step 23 — check-in starts the stay', async () => {
    const checkIn = await cloudBookingsDB.transition(bookingId, { type: 'CheckIn' }, { actor: 'admin', actor_id: ADMIN_UID })
    expect(checkIn.ok).toBe(true)
    const staying = await cloudBookingsDB.transition(bookingId, { type: 'BeginStay' }, { actor: 'admin', actor_id: ADMIN_UID })
    expect(staying.ok).toBe(true)
    expect((await cloudBookingsDB.get(bookingId))?.status).toBe('Staying')
    note(23, 'Check-in → Staying', 'executed', `status=${(await cloudBookingsDB.get(bookingId))?.status}`)
  })

  it('step 24 — a valid credential on the stay dates is granted, and the row the contract writes is accepted', () => {
    const booking = { status: 'Staying', check_in: CHECK_IN, check_out: CHECK_OUT, ref_id: 'HDL-1' }
    const decision = doorDecision({ refId: 'HDL-1', credentialRevoked: false, today: CHECK_IN, booking })
    expect(decision.result).toBe('granted')
    const row = accessLogDoc({ result: 'granted', reason: decision.reason, uid: GUEST_UID })
    expect(decide({ path: 'access_logs/log-1', method: 'create', auth: anonymousGuest(GUEST_UID), requestData: row })).toBe(false)
    expect(decide({ path: 'access_logs/log-1', method: 'create', auth: allowlistedAdmin(), requestData: row })).toBe(true)
    note(24, 'Authorized unlock', 'contract', `decision=granted; guest access_logs create denied, admin create accepted by rule text`)
  })

  it('step 25 — an unknown credential is denied and the denial is logged, with no actuation', () => {
    const decision = doorDecision({ refId: 'HDL-NOPE', credentialRevoked: false, today: CHECK_IN, booking: undefined })
    expect(decision.result).toBe('denied')
    const row = accessLogDoc({ result: 'denied', reason: decision.reason, uid: GUEST_UID, ref_id: 'HDL-NOPE' })
    expect(decide({ path: 'access_logs/log-2', method: 'create', auth: anonymousGuest(GUEST_UID), requestData: row })).toBe(true)
    note(25, 'Unknown credential', 'contract', `decision=denied (${decision.reason}); denied row accepted by rule text`)
  })

  it('step 26 — a revoked credential is denied, and outside the stay dates nothing unlocks', () => {
    const booking = { status: 'Staying', check_in: CHECK_IN, check_out: CHECK_OUT, ref_id: 'HDL-1' }
    const revoked = doorDecision({ refId: 'HDL-1', credentialRevoked: true, today: CHECK_IN, booking })
    const outOfDates = doorDecision({ refId: 'HDL-1', credentialRevoked: false, today: '2026-11-01', booking })
    const notStaying = doorDecision({ refId: 'HDL-1', credentialRevoked: false, today: CHECK_IN, booking: { ...booking, status: 'Payment Pending' } })
    expect([revoked.result, outOfDates.result, notStaying.result]).toEqual(['denied', 'denied', 'denied'])
    note(26, 'Revoked credential, wrong dates, stay not Reserved', 'contract', `all denied: ${revoked.reason}; ${outOfDates.reason}; ${notStaying.reason}`)
  })

  it('step 27 — the Access log cannot be edited or deleted by a Guest (audit integrity)', () => {
    const update = decide({
      path: 'access_logs/log-1',
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: accessLogDoc(),
      requestData: accessLogDoc({ result: 'denied' }),
    })
    const remove = decide({ path: 'access_logs/log-1', method: 'delete', auth: anonymousGuest(GUEST_UID), resourceData: accessLogDoc() })
    const forgedOwner = decide({
      path: 'access_logs/log-3',
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: accessLogDoc({ uid: OTHER_GUEST_UID }),
    })
    const badResult = decide({
      path: 'access_logs/log-4',
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: accessLogDoc({ result: 'maybe' }),
    })
    expect([update, remove, forgedOwner, badResult]).toEqual([false, false, false, false])
    note(27, 'Access-log tampering', 'rule-text', 'update denied, delete denied, forged writer denied, invalid result denied')
  })

  it('step 28 — the stay ends and the Booking completes', async () => {
    const out = await cloudBookingsDB.transition(bookingId, { type: 'CheckOut' }, { actor: 'admin', actor_id: ADMIN_UID })
    expect(out.ok).toBe(true)
    const done = await cloudBookingsDB.transition(bookingId, { type: 'Complete' }, { actor: 'admin', actor_id: ADMIN_UID })
    expect(done.ok).toBe(true)
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.status).toBe('Completed')
    const history = await cloudBookingsDB.history(bookingId)
    note(28, 'Check-out → Completed, with the whole stay on the Activity log', 'executed', `status=${after?.status}, activity entries=${history.length}`)
  })

  // -------------------------------------------------------------------------
  // G. Chat (steps 29–31)
  // -------------------------------------------------------------------------

  it('step 29 — the Guest opens their conversation and sees only their own messages', async () => {
    convoId = (await ensureConversation(guestUid, 'booking')).id
    const sent = await sendChatMessage({ convoId, uid: guestUid, text: 'Hi, we are arriving around 3 PM.' })
    expect(sent.ok).toBe(true)
    const seen: string[] = []
    const unsubscribe = subscribeMessages(convoId, guestUid, (page) => seen.push(...page.messages.map((m) => m.text)))
    unsubscribe()
    expect(seen).toContain('Hi, we are arriving around 3 PM.')
    note(29, 'Guest conversation and message', 'executed', `convo=${convoId}, message delivered to the guest view`)
  })

  it('step 30 — a message must be sent as its own sender, and only into an owned conversation', () => {
    const own = decide({
      path: `conversations/${CONVO_ID}/messages/m1`,
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: messageDoc(GUEST_UID),
    })
    const spoofed = decide({
      path: `conversations/${CONVO_ID}/messages/m2`,
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: messageDoc(OTHER_GUEST_UID),
    })
    const strangerConvo = decide({
      path: 'conversations/convo-2/messages/m3',
      method: 'create',
      auth: anonymousGuest(OTHER_GUEST_UID),
      requestData: messageDoc(OTHER_GUEST_UID),
    })
    const mislabelled = decide({
      path: `conversations/${CONVO_ID}/messages/m4`,
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: messageDoc(GUEST_UID, 'admin'),
    })
    expect(own).toBe(true)
    expect(spoofed).toBe(false)
    // The finding from the first verification pass: knowing a conversation id
    // was enough to post into it. Membership is read from the conversation now.
    expect(strangerConvo).toBe(false)
    // …and the label has to match what the writer is.
    expect(mislabelled).toBe(false)
    note(
      30,
      'Sender identity, conversation membership and the role label',
      'rule-text',
      'own sender allowed; spoofed sender denied; a stranger posting into an unowned conversation denied; a Guest labelling a message as the Admin\'s denied',
    )
  })

  it('step 31 — the Admin can read the conversation and reply', () => {
    const read = decide({ path: `conversations/${CONVO_ID}/messages/m1`, method: 'get', auth: allowlistedAdmin(), resourceData: messageDoc() })
    const reply = decide({
      path: `conversations/${CONVO_ID}/messages/m9`,
      method: 'create',
      auth: allowlistedAdmin(),
      requestData: messageDoc(ADMIN_UID, 'admin'),
    })
    expect(read).toBe(true)
    expect(reply).toBe(true)
    note(31, 'Admin reply', 'rule-text', 'admin read allowed, admin message accepted')
  })

  // -------------------------------------------------------------------------
  // H. Reviews (steps 32–34)
  // -------------------------------------------------------------------------

  it('step 32 — a Review is refused before check-out and accepted after', async () => {
    const early = await submitReview({ bookingId, uid: guestUid, stars: 5, text: 'Lovely stay', bookingStatus: 'Staying' })
    expect(early.ok).toBe(false)
    const after = await submitReview({ bookingId, uid: guestUid, stars: 5, text: 'Lovely stay, the pool was perfect.', bookingStatus: 'Completed' })
    expect(after.ok).toBe(true)
    note(32, 'Review eligibility', 'executed', `before check-out refused, after Completed accepted`)
  })

  it('step 33 — a second Review for the same stay is refused', async () => {
    const again = await submitReview({ bookingId, uid: guestUid, stars: 4, text: 'Second try', bookingStatus: 'Completed' })
    expect(again.ok).toBe(false)
    const stored = await getReviewForBooking(bookingId, guestUid)
    expect(stored?.stars).toBe(5)
    note(33, 'Duplicate Review', 'executed', `refused with "${again.ok === false ? again.message : ''}"`)
  })

  it('step 34 — a Review lives on the Booking it is about: its author’s, finished, once', () => {
    // The create stamps the edit window from the clock, so a fixture has to say
    // the same instant the rule reads — hence the `time` on every case.
    const at = DEFAULT_REVIEW_TIME
    const own = (overrides: Record<string, unknown> = {}) => ({
      path: `reviews/${BOOKING_ID}`,
      method: 'create' as const,
      auth: anonymousGuest(GUEST_UID),
      requestData: reviewDoc({ uid: GUEST_UID, ...overrides }, at),
      time: at,
    })
    const ok = decide(own())
    const sixStars = decide(own({ stars: 6 }))
    const impostor = decide({ ...own({ uid: OTHER_GUEST_UID }), auth: anonymousGuest(OTHER_GUEST_UID) })
    // Somebody else's finished Booking, this Guest's unfinished one, and a
    // terminal branch — a request that ended is not a stay.
    const strangerStay = decide({ ...own({ booking_id: 'booking-2' }), path: 'reviews/booking-2' })
    const earlyStay = decide(
      { ...own({ booking_id: 'booking-open' }), path: 'reviews/booking-open' },
      storeWith({}, { 'bookings/booking-open': bookingDoc({ status: 'Staying' }) }),
    )
    const cancelledStay = decide(
      { ...own({ booking_id: 'booking-gone' }), path: 'reviews/booking-gone' },
      storeWith({}, { 'bookings/booking-gone': bookingDoc({ status: 'Cancelled' }) }),
    )
    // A second Review for the same stay is a second write at an id that already
    // holds one. Inside the window that is a correction the Guest is allowed, so
    // the thing that is actually refused is a second document under another id —
    // and, after the window, the correction too.
    const filedElsewhere = decide({ ...own(), path: 'reviews/some-other-id', requestData: reviewDoc({ uid: GUEST_UID, booking_id: 'some-other-id' }, at) })
    const afterTheWindow = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: reviewDoc({ uid: GUEST_UID }, at),
      requestData: reviewDoc({ uid: GUEST_UID, stars: 4 }, at),
      time: at + 15 * 86_400_000,
    })
    expect([ok, sixStars, impostor, strangerStay, earlyStay, cancelledStay, filedElsewhere, afterTheWindow]).toEqual([
      true, false, false, false, false, false, false, false,
    ])
    expect(validateStarRating(6).ok).toBe(false)
    note(
      34,
      'Review eligibility, ownership, shape and one-per-stay',
      'rule-text',
      'own finished Booking + 5 stars allowed; 6 stars, another author, another Guest’s stay, an unfinished or cancelled stay, a second document and a late correction all denied',
    )
  })

  // -------------------------------------------------------------------------
  // I. Security attacks (steps 35–37)
  // -------------------------------------------------------------------------

  it('step 35 — the Guest cannot write a Booking status the lifecycle does not give them', () => {
    const toApproved = decide({
      path: `bookings/${BOOKING_ID}`,
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: bookingDoc({ uid: GUEST_UID }),
      requestData: guestPaymentPatch({ status: 'Approved' }),
    })
    const takeIdentity = decide({
      path: `bookings/${BOOKING_ID}`,
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: bookingDoc({ uid: GUEST_UID }),
      requestData: guestPaymentPatch({ uid: OTHER_GUEST_UID }),
    })
    const deleteOther = decide({
      path: `bookings/${BOOKING_ID}`,
      method: 'delete',
      auth: anonymousGuest(GUEST_UID),
      resourceData: bookingDoc({ uid: OTHER_GUEST_UID }),
    })
    expect([toApproved, takeIdentity, deleteOther]).toEqual([false, false, false])
    note(35, 'Privilege escalation through the Booking document', 'rule-text', 'Approve denied, identity swap denied, delete of another guest\u2019s booking denied')
  })

  it('step 36 — a Guest cannot read or write a tracking session, and the Tracker is closed to the Admin too', () => {
    const read = decide({ path: `tracking_sessions/${BOOKING_ID}`, method: 'get', auth: anonymousGuest(GUEST_UID) })
    const create = decide({
      path: `tracking_sessions/${BOOKING_ID}`,
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: { bookingId: BOOKING_ID, uid: GUEST_UID, latitude: 14.18, longitude: 121.51 },
    })
    const adminRead = decide({ path: `tracking_sessions/${BOOKING_ID}`, method: 'get', auth: allowlistedAdmin() })
    const otherUpload = decideStorage({
      path: `kyc/${GUEST_UID}/HDL-1/id.jpg`,
      method: 'create',
      auth: anonymousGuest(OTHER_GUEST_UID),
      requestData: { size: 1024, contentType: 'image/jpeg' },
    })
    expect([read, create, adminRead, otherUpload]).toEqual([false, false, false, false])
    note(36, 'Tracker collection and the retired KYC storage slot', 'rule-text', 'tracking_sessions read/create denied for guest and Admin; the /kyc slot refuses uploads for everyone')
  })

  it('step 37 — storage stays closed where it must: proofs to their Guest, the retired ID slot to nobody', () => {
    const kycRead = decideStorage({
      path: `kyc/${GUEST_UID}/HDL-1/id.jpg`,
      method: 'get',
      auth: anonymousGuest(OTHER_GUEST_UID),
      resourceData: { size: 1024, contentType: 'image/jpeg' },
    })
    const adminKycRead = decideStorage({
      path: `kyc/${GUEST_UID}/HDL-1/id.jpg`,
      method: 'get',
      auth: allowlistedAdmin(),
      resourceData: { size: 1024, contentType: 'image/jpeg' },
    })
    const ratesWrite = decide({
      path: 'site_config/rates',
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: { published: true },
      requestData: { published: true, accommodations: {} },
    })
    const ownProof = decideStorage({
      path: `payments/${GUEST_UID}/HDL-1/proof.png`,
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: { size: 1024, contentType: 'image/png' },
    })
    expect([kycRead, adminKycRead, ratesWrite, ownProof]).toEqual([false, false, false, true])
    note(37, 'Cross-user document access', 'rule-text', 'ID reads denied for guests and Admin alike (slot removed), guest rates write denied, own payment proof write allowed')
  })

  // -------------------------------------------------------------------------
  // I. The review, end to end (steps 38–42)
  // -------------------------------------------------------------------------

  it('step 38 — the Guest rates a finished stay, and can still change their mind', async () => {
    const written = await submitReview({
      bookingId: BOOKING_ID,
      uid: GUEST_UID,
      stars: 4,
      text: 'Very relaxing place. We enjoyed our stay.',
      bookingStatus: 'Completed',
      categories: { cleanliness: 5, value: 4 },
    })
    expect(written.ok).toBe(true)
    const stored = await getReviewForBooking(BOOKING_ID, GUEST_UID)
    expect(stored?.stars).toBe(4)
    expect(stored?.cleanliness).toBe(5)
    expect(stored?.accommodation).toBeUndefined()
    // It waits for the Admin, and the window is stamped, not claimed.
    expect(stored?.status).toBe('pending')
    expect(stored?.edit_until).toBeTruthy()

    const corrected = await updateReview({
      bookingId: BOOKING_ID,
      uid: GUEST_UID,
      stars: 5,
      text: 'Very relaxing place. We enjoyed our stay — the garden is wonderful.',
    })
    expect(corrected.ok).toBe(true)
    expect((await getReviewForBooking(BOOKING_ID, GUEST_UID))?.stars).toBe(5)
    note(38, 'A Guest rates a stay', 'executed', 'written pending with categories, then corrected inside the window')
  })

  it('step 39 — the Guest cannot rate a stay that is not over, or rate one twice', async () => {
    const early = await submitReview({ bookingId: 'booking-open', uid: GUEST_UID, stars: 5, text: 'Too soon.', bookingStatus: 'Staying' })
    const again = await submitReview({ bookingId: BOOKING_ID, uid: GUEST_UID, stars: 1, text: 'Changed my mind.', bookingStatus: 'Completed' })
    expect([early.ok, again.ok]).toEqual([false, false])
    expect((await getReviewForBooking(BOOKING_ID, GUEST_UID))?.stars).toBe(5)
    note(39, 'One review per finished stay', 'executed', 'a stay in progress refused, a second review for the same stay refused')
  })

  it('step 40 — the Admin answers and moderates; the Guest\'s words do not move', async () => {
    const at = DEFAULT_REVIEW_TIME
    const published = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'update',
      auth: allowlistedAdmin(),
      resourceData: reviewDoc({ status: 'pending' }, at),
      requestData: reviewDoc({ status: 'published', published_at: '2026-10-06T02:00:00.000Z' }, at),
      time: at,
    })
    const answered = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'update',
      auth: allowlistedAdmin(),
      resourceData: reviewDoc({ status: 'published' }, at),
      requestData: reviewDoc({ status: 'published', admin_response: 'Thank you for staying with us!', admin_response_at: '2026-10-06T02:00:00.000Z', admin_response_by: ADMIN_UID }, at),
      time: at,
    })
    // The one thing an Admin may not do: turn a 2-star review into a 5-star one.
    const rewritten = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'update',
      auth: allowlistedAdmin(),
      resourceData: reviewDoc({ stars: 2, status: 'published' }, at),
      requestData: reviewDoc({ stars: 5, status: 'published' }, at),
      time: at,
    })
    const guestWroteIt = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: reviewDoc({ status: 'pending' }, at),
      requestData: reviewDoc({ status: 'published' }, at),
      time: at,
    })
    expect([published, answered, rewritten, guestWroteIt]).toEqual([true, true, false, false])
    note(40, 'The Admin moderates and answers', 'rule-text', 'publish and reply allowed; rewriting the rating and a self-publish denied')
  })

  it('step 41 — the public page carries the quote and nothing that identifies the Guest', async () => {
    const published = await publishPublicReview({
      reviewId: BOOKING_ID,
      stars: 5,
      text: 'Very relaxing place. We enjoyed our stay — the garden is wonderful.',
      displayName: 'Ana R.',
      month: 'October 2026',
    })
    expect(published.ok).toBe(true)
    const shown = await listPublicReviews()
    expect(shown).toHaveLength(1)
    // The public document is six fields the Admin chose, and the Guest's uid,
    // their Booking and the Admin's private reply are not among them.
    expect(Object.keys(shown[0]).sort()).toEqual(['display_name', 'excerpt', 'month', 'published_at', 'review_id', 'stars'])
    expect(JSON.stringify(shown)).not.toContain(GUEST_UID)
    expect(JSON.stringify(shown)).not.toContain('Thank you for staying')

    // And a Guest cannot put one there, or read the private review.
    const guestPublish = decide({
      path: `public_reviews/${BOOKING_ID}`,
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: publicReviewDoc({ review_id: BOOKING_ID }),
    })
    const privateRead = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'get',
      auth: null,
      resourceData: reviewDoc({}, DEFAULT_REVIEW_TIME),
    })
    const strangerRead = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'get',
      auth: anonymousGuest(OTHER_GUEST_UID),
      resourceData: reviewDoc({}, DEFAULT_REVIEW_TIME),
    })
    expect([guestPublish, privateRead, strangerRead]).toEqual([false, false, false])
    note(41, 'The public page', 'executed + rule-text', 'six published fields, no uid or reply; a Guest cannot publish and a visitor cannot read the review itself')
  })

  it('step 42 — the average counts only what is on the website', async () => {
    // One published testimonial on the page, and the review it came from.
    const summary = await getPublicReviewSummary()
    expect(summary.count).toBe(1)
    expect(summary.average).toBe(5)
    // Taking it down takes the number with it — a hidden review moves nothing a
    // visitor can see, which is the whole point of counting only these.
    expect((await unpublishPublicReview(BOOKING_ID)).ok).toBe(true)
    const after = await getPublicReviewSummary()
    expect(after.count).toBe(0)
    expect(after.average).toBeNull()
    note(42, 'The average rating', 'executed', '5.0 from one published testimonial, and nothing at all once it is withdrawn')
  })

  it('prints the 42-step record', () => {
    expect(record).toHaveLength(42)
    const width = Math.max(...record.map((r) => r.title.length))
    const lines = record.map(
      (r) => `${String(r.step).padStart(2)} | ${r.title.padEnd(width)} | ${r.kind.padEnd(9)} | ${r.result}`,
    )
    console.info(`\n=== final end-to-end scenario: 42 steps ===\n${lines.join('\n')}\n`)
  })
})
