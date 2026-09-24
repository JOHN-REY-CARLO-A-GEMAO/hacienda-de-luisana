/**
 * The final end-to-end scenario, executed — 37 steps.
 *
 * client registration → Booking → Terms → KYC → Payment → OCR → Admin
 * verification → chat → Review → Smart Lock → security attacks.
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
import { describe, expect, it } from 'vitest'

import { canOpenPage, createSession, homeForRole, permissionsOf, roleForEmail, type SessionStore } from '../../src/lib/auth'
import { createLocalPorts } from '../../src/lib/authLocal'
import { TERMS, recordAcceptance, isAcceptanceCurrent, LEGAL_VERSION } from '../../src/lib/legal'
import { cloudBookingsDB } from '../../src/lib/firestoreBookings'
import { bookingsDB, type Booking } from '../../src/lib/storage'
import { validateKycFile, KYC_MAX_BYTES, kycObjectPath } from '../../src/lib/kyc'
import { validateProofFile, PROOF_MAX_BYTES, proofObjectPath } from '../../src/lib/payments'
import { extractReceiptFields, canAutoVerifyFromOcr, matchPaymentReference } from '../../src/lib/payments/ocr'
import { paymentOptionsForTotal } from '../../src/lib/booking'
import { checkRateLimit, LIMITS } from '../../src/lib/rateLimit'
import { ensureConversation, sendChatMessage, subscribeMessages } from '../../src/lib/chatCloud'
import { submitReview, getReviewForBooking } from '../../src/lib/reviewsCloud'
import { validateStarRating } from '../../src/lib/validation'

import { evaluate, type Store } from '../rules/engine'
import {
  ADMIN_UID,
  BOOKING_ID,
  CONVO_ID,
  GUEST_UID,
  OTHER_GUEST_UID,
  accessLogDoc,
  allowlistedAdmin,
  anonymousGuest,
  bookingDoc,
  conversationDoc,
  guestPaymentPatch,
  messageDoc,
  request,
  reviewDoc,
  storeWith,
} from '../rules/context'

const firestoreRules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')
const storageRules = readFileSync(join(__dirname, '../../storage.rules'), 'utf8')

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

type Kind = 'executed' | 'rule-text' | 'contract'

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
const GUEST_PASSWORD = ['hdl', 'e2e', 'fixture'].join('-')
const ADMIN_EMAIL_FOR_TEST = 'haciendadeluisiana@gmail.com'
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
    [`bookings/${BOOKING_ID}`]: bookingDoc({ status: 'Completed', kyc_status: 'approved' }),
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
        kyc_status: 'required',
        payment_status: 'unpaid',
      },
      guestActor,
    )
    bookingId = booking.id
    expect(booking.status).toBe('Pending')
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
  // C. KYC (steps 10–12)
  // -------------------------------------------------------------------------

  it('step 10 — the ID and receipt are refused above 5 MB before any byte leaves the device', () => {
    const big = { name: 'id.jpg', size: KYC_MAX_BYTES + 1, type: 'image/jpeg' }
    const pdf = { name: 'id.pdf', size: 1000, type: 'application/pdf' }
    const good = { name: 'id.jpg', size: 2 * 1024 * 1024, type: 'image/jpeg' }
    expect(validateKycFile(big).ok).toBe(false)
    expect(validateKycFile(pdf).ok).toBe(false)
    expect(validateKycFile(good).ok).toBe(true)
    expect(kycObjectPath({ uid: guestUid, bookingRefId: 'HDL-1', filename: 'id.jpg' })).toContain(`kyc/${guestUid}/`)
    note(10, 'KYC file contract (5 MB, image only, own-uid path)', 'executed', 'oversized refused, PDF refused, 2 MB JPEG accepted')
  })

  it('step 11 — the Guest uploads the ID and the Booking moves to KYC Submitted', async () => {
    const result = await cloudBookingsDB.transition(
      bookingId,
      { type: 'UploadKyc', kyc_id_url: `kyc/${guestUid}/HDL-1/id.jpg`, kyc_receipt_url: `kyc/${guestUid}/HDL-1/receipt.jpg` },
      guestActor,
    )
    expect(result.ok).toBe(true)
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.status).toBe('KYC Submitted')
    expect(after?.kyc_status).toBe('submitted')
    note(11, 'KYC uploaded', 'executed', `status=${after?.status}, kyc_status=${after?.kyc_status}`)
  })

  it('step 12 — an Admin decides the KYC and a refused ID can be resubmitted', async () => {
    const refused = await cloudBookingsDB.transition(bookingId, { type: 'RejectKyc', reason: 'Blurred photo' }, { actor: 'admin', actor_id: ADMIN_UID, actor_name: ADMIN_EMAIL_FOR_TEST })
    expect(refused.ok).toBe(true)
    expect((await cloudBookingsDB.get(bookingId))?.kyc_status).toBe('rejected')
    const resubmit = await cloudBookingsDB.transition(
      bookingId,
      { type: 'UploadKyc', kyc_id_url: `kyc/${guestUid}/HDL-1/id-2.jpg` },
      guestActor,
    )
    expect(resubmit.ok).toBe(true)
    note(12, 'Admin refuses a blurred ID; the Guest resubmits and the Booking returns to KYC Submitted', 'executed', 'rejected → resubmitted')
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
    expect((await cloudBookingsDB.get(bookingId))?.status).toBe('Approved')
    note(13, 'Admin approves after the availability re-check', 'executed', `status=Approved, re-checked against ${bookings.length} stored Booking(s)`)
  })

  it('step 14 — the Guest chooses a payment plan and the policy in force is stamped', async () => {
    const options = paymentOptionsForTotal(STAY_TOTAL, RATE)
    const down = options.find((o) => o.plan === 'down-payment')
    expect(down).toBeTruthy()
    const result = await cloudBookingsDB.transition(
      bookingId,
      { type: 'ChoosePaymentPlan', plan: 'down-payment', stayTotal: STAY_TOTAL, rate: RATE, policy: POLICY },
      guestActor,
    )
    expect(result.ok).toBe(true)
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.status).toBe('Payment Pending')
    expect(after?.policy_version).toBe(POLICY.version)
    expect(after?.amount_due).toBe(down?.dueNow)
    expect(after?.security_deposit).toBe(RATE.securityDeposit)
    note(14, 'Payment plan chosen; policy version stamped on the Booking', 'executed', `status=${after?.status}, due=${after?.amount_due}, policy=${after?.policy_version}`)
  })

  it('step 15 — the payment proof contract matches the storage rule (5 MB, image, own uid)', () => {
    expect(validateProofFile({ name: 'gcash.png', size: PROOF_MAX_BYTES + 1, type: 'image/png' }).ok).toBe(false)
    expect(validateProofFile({ name: 'proof.pdf', size: 1000, type: 'application/pdf' }).ok).toBe(false)
    expect(proofObjectPath({ uid: guestUid, bookingRefId: 'HDL-1', filename: 'gcash.png' })).toBe(
      `payments/${guestUid}/HDL-1/proof.png`,
    )
    const path = proofObjectPath({ uid: guestUid, bookingRefId: 'HDL-1', filename: 'gcash.png' })
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

  it('step 17 — the Guest submits the proof and states what they sent; nothing is verified yet', async () => {
    const result = await cloudBookingsDB.transition(
      bookingId,
      {
        type: 'UploadPaymentProof',
        payment_proof_url: `payments/${guestUid}/HDL1/proof.png`,
        amount_claimed: 4500,
        payment_reference: '1234567890123',
        ocr_reference: '1234567890123',
        ocr_amount: '4500',
      },
      guestActor,
    )
    expect(result.ok).toBe(true)
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.payment_status).toBe('pending')
    expect(after?.amount_verified).toBeUndefined()
    expect(after?.payment_verified_by).toBeUndefined()
    note(17, 'Proof submitted', 'executed', `payment_status=${after?.payment_status}, verified_at=${after?.payment_verified_at ?? 'unset'}`)
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
    const rejected = await cloudBookingsDB.transition(
      bookingId,
      { type: 'RejectPaymentProof', reason: 'Amount unreadable', guestResubmits: true },
      { actor: 'admin', actor_id: ADMIN_UID },
    )
    expect(rejected.ok).toBe(true)
    const mid = await cloudBookingsDB.get(bookingId)
    expect(mid?.payment_status).toBe('rejected')
    expect(mid?.payment_proof_url).toBeNull()
    const resubmit = await cloudBookingsDB.transition(
      bookingId,
      { type: 'UploadPaymentProof', payment_proof_url: `payments/${guestUid}/HDL-1/proof2.png`, amount_claimed: 6500, payment_reference: '1234567890123' },
      guestActor,
    )
    expect(resubmit.ok).toBe(true)
    const back = await cloudBookingsDB.get(bookingId)
    expect(back?.payment_status).toBe('pending')
    expect(back?.status).toBe('Payment Pending')
    note(20, 'Rejected proof → resubmission', 'executed', `rejected (${mid?.payment_status}) → after resubmit ${back?.payment_status}, status still ${back?.status}`)
  })

  it('step 21 — verifying less than the stay owes is refused; verifying it settles the Booking', async () => {
    const before = await cloudBookingsDB.get(bookingId)
    const owed = (before?.amount_due ?? 0) + (before?.security_deposit ?? 0)
    const short = await cloudBookingsDB.transition(
      bookingId,
      { type: 'VerifyPayment', amount_verified: owed - 500 },
      { actor: 'admin', actor_id: ADMIN_UID },
    )
    expect(short.ok).toBe(false)
    expect(short.ok === false ? short.reason : '').toContain('covers')
    const exact = await cloudBookingsDB.transition(
      bookingId,
      { type: 'VerifyPayment', amount_verified: owed },
      { actor: 'admin', actor_id: ADMIN_UID, actor_name: ADMIN_EMAIL_FOR_TEST },
    )
    expect(exact.ok).toBe(true)
    const after = await cloudBookingsDB.get(bookingId)
    expect(after?.payment_status).toBe('verified')
    expect(after?.status).toBe('Reserved')
    note(21, 'Admin verification', 'executed', `underpayment (${owed - 500}) refused, ${owed} verified → ${after?.status}`)
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
    expect(decide({ path: 'access_logs/log-1', method: 'create', auth: anonymousGuest(GUEST_UID), requestData: row })).toBe(true)
    note(24, 'Authorized unlock', 'contract', `decision=granted; access_logs create accepted by rule text`)
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
    const notStaying = doorDecision({ refId: 'HDL-1', credentialRevoked: false, today: CHECK_IN, booking: { ...booking, status: 'Approved' } })
    expect([revoked.result, outOfDates.result, notStaying.result]).toEqual(['denied', 'denied', 'denied'])
    note(26, 'Revoked credential, wrong dates, unapproved stay', 'contract', `all denied: ${revoked.reason}; ${outOfDates.reason}; ${notStaying.reason}`)
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
    convoId = await ensureConversation(guestUid, 'booking')
    const sent = await sendChatMessage({ convoId, uid: guestUid, text: 'Hi, we are arriving around 3 PM.' })
    expect(sent.ok).toBe(true)
    const seen: string[] = []
    const unsubscribe = subscribeMessages(convoId, guestUid, (msgs) => seen.push(...msgs.map((m) => m.text)))
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
    const ok = decide({ path: `reviews/${BOOKING_ID}`, method: 'create', auth: anonymousGuest(GUEST_UID), requestData: reviewDoc({ uid: GUEST_UID }) })
    const sixStars = decide({ path: `reviews/${BOOKING_ID}`, method: 'create', auth: anonymousGuest(GUEST_UID), requestData: reviewDoc({ uid: GUEST_UID, stars: 6 }) })
    const impostor = decide({ path: `reviews/${BOOKING_ID}`, method: 'create', auth: anonymousGuest(OTHER_GUEST_UID), requestData: reviewDoc({ uid: OTHER_GUEST_UID }) })
    // Somebody else's finished Booking, and this Guest's unfinished one.
    const strangerStay = decide({
      path: 'reviews/booking-2',
      method: 'create',
      auth: anonymousGuest(GUEST_UID),
      requestData: reviewDoc({ booking_id: 'booking-2', uid: GUEST_UID }),
    })
    const earlyStay = decide(
      { path: 'reviews/booking-open', method: 'create', auth: anonymousGuest(GUEST_UID), requestData: reviewDoc({ booking_id: 'booking-open', uid: GUEST_UID }) },
      storeWith({}, { 'bookings/booking-open': bookingDoc({ status: 'Staying', kyc_status: 'approved' }) }),
    )
    // A second Review for the same stay is the same document: an update, and
    // updates are closed.
    const secondReview = decide({
      path: `reviews/${BOOKING_ID}`,
      method: 'update',
      auth: anonymousGuest(GUEST_UID),
      resourceData: reviewDoc({ uid: GUEST_UID }),
      requestData: reviewDoc({ uid: GUEST_UID, stars: 4 }),
    })
    expect([ok, sixStars, impostor, strangerStay, earlyStay, secondReview]).toEqual([true, false, false, false, false, false])
    expect(validateStarRating(6).ok).toBe(false)
    note(
      34,
      'Review eligibility, ownership, shape and one-per-stay',
      'rule-text',
      'own finished Booking + 5 stars allowed; 6 stars, another author, another Guest’s stay, an unfinished stay and a second Review all denied',
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
    note(36, 'Tracker collection and KYC storage slot', 'rule-text', 'tracking_sessions read/create denied for guest and Admin; uploading into another guest\u2019s KYC slot denied')
  })

  it('step 37 — the payment and identity collections stay closed to every non-Admin path', () => {
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
    expect([kycRead, adminKycRead, ratesWrite, ownProof]).toEqual([false, true, false, true])
    note(37, 'Cross-user document access', 'rule-text', 'other guest\u2019s KYC read denied, Admin read allowed, guest rates write denied, own payment proof write allowed')
  })

  it('prints the 37-step record', () => {
    expect(record).toHaveLength(37)
    const width = Math.max(...record.map((r) => r.title.length))
    const lines = record.map(
      (r) => `${String(r.step).padStart(2)} | ${r.title.padEnd(width)} | ${r.kind.padEnd(9)} | ${r.result}`,
    )
    console.info(`\n=== final end-to-end scenario: 37 steps ===\n${lines.join('\n')}\n`)
  })
})
