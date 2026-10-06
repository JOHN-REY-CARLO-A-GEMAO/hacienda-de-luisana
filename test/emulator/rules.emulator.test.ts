/**
 * The canonical suite: the rules, enforced by the Firebase Emulator Suite.
 *
 * `npm run test:emulator` starts the Auth, Firestore and Storage emulators with
 * this repository's rules files and runs the cases below inside `emulators:exec`.
 * It needs Java and the emulator download (one-time, ~200 MB) — neither is
 * available in every environment, which is why `test/rules/` exists as the
 * offline companion. When both can run, this one is the answer that counts.
 *
 * The cases mirror `test/rules/firestore-rules.test.ts` and
 * `test/rules/storage-rules.test.ts` case for case where the outcome is settled,
 * and settle the ones the offline evaluator has to report both ways — the
 * anonymous-Guest token-claim question above all.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { ref, uploadBytes, deleteObject, getDownloadURL } from 'firebase/storage'
import { conversationDocId } from '../../src/lib/chatCloud'

/** `firebase emulators:exec` puts the project id in the environment. */
const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? 'demo-hacienda'
const ADMIN_EMAIL = 'haciendadeluisiana@gmail.com'
const GUEST_UID = 'guest-uid-1'
const OTHER_GUEST_UID = 'guest-uid-2'
const BOOKING_ID = 'booking-1'
const CONVO_ID = 'convo-1'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(join(__dirname, '../../firestore.rules'), 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(join(__dirname, '../../storage.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

/**
 * Every test starts from an empty database and an empty bucket.
 *
 * Without this the suite was order-dependent and had been for its whole life:
 * there was no `clearFirestore` anywhere, and every case reused the same
 * document ids (`booking-1`, `convo-1`). The `activity` subcollection made it
 * worse — those rules are append-only, so a second `create` at an id an earlier
 * test had already written is refused by design, and the test that wrote it
 * second was blamed for a rule that was working exactly as written. Which cases
 * failed therefore depended on execution order and timing: two identical runs
 * reported 11 failures and then 9.
 *
 * This is an *ancestor* hook, so it runs after a describe's `beforeAll` and
 * before that describe's first test — which is why no fixture is seeded in a
 * `beforeAll`. Each describe seeds in a `beforeEach` of its own, which vitest
 * runs after this one: clear, then lay the fixtures down again, so a test never
 * inherits what the test before it wrote and never loses what its own rules
 * need to exist.
 */
beforeEach(async () => {
  await env.clearFirestore()
  await env.clearStorage()
  await env.withSecurityRulesDisabled(async (owner) => {
    await setDoc(doc(owner.firestore(), 'site_config', 'rates'), {
      version: 'emulator-v2',
      effective_date: '2026-10-01',
      holiday_dates: [],
      accommodations: {
        'main-house': {
          property_name: 'The Main House', rate_unit: 'standard_stay', active: true,
          security_deposit: 500, down_payment_percent: 50, available_units: 1,
          guest_pricing: {
            units_per_booking: 1,
            weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
            weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
          },
        },
        annex: {
          property_name: 'HDL Annex', rate_unit: 'standard_stay', active: true,
          security_deposit: 500, down_payment_percent: 50, available_units: 1,
          guest_pricing: {
            units_per_booking: 1,
            weekday: { min_guests: 1, base_max_guests: 6, base_rate: 4000, excess_per_guest: 500 },
            weekend_holiday: { min_guests: 1, base_max_guests: 6, base_rate: 5000, excess_per_guest: 500 },
          },
        },
        'house-a-camping': {
          property_name: 'A-House', rate_unit: 'standard_stay', active: true,
          security_deposit: 0, down_payment_percent: 50, available_units: 2,
          guest_pricing: {
            units_per_booking: 1,
            weekday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
            weekend_holiday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
          },
        },
      },
    })
  })
})

/** A Guest with a uid but no email claim — Firebase's anonymous sign-in. */
const anonymousGuest = (uid = GUEST_UID) => env.authenticatedContext(uid, {})
const emailGuest = (uid = GUEST_UID) => env.authenticatedContext(uid, { email: `guest-${uid}@example.com` })
/** The bootstrap Admin, by the allowlisted address in the token. */
const admin = () => env.authenticatedContext('admin-uid-1', { email: ADMIN_EMAIL })

/**
 * A Booking as ADR-0012 has it: born Pending, with the downpayment screenshot
 * already attached and an amount claimed. The create rule requires those three
 * keys (`firestore.rules` L197) and then their values (L207-210), so a fixture
 * without them is a document the rules refuse to store — which is the point of
 * the fixture being shaped like the app's.
 */
const bookingDoc = (overrides: Record<string, unknown> = {}) => {
  const checkIn = String(overrides.check_in ?? manilaDatePlus(60))
  const parsed = Date.parse(`${checkIn}T00:00:00Z`)
  const validDate = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === checkIn
  const checkOut = validDate
    ? new Date(parsed + 86_400_000).toISOString().slice(0, 10)
    : manilaDatePlus(61)
  const guests = Number(overrides.guests ?? 2)
  const day = validDate ? new Date(parsed).getUTCDay() : 0
  const classification = day === 5 || day === 6 ? 'weekend_holiday' : 'weekday'
  const baseRate = classification === 'weekend_holiday' ? 6000 : 5000
  const total = baseRate + Math.max(0, guests - 10) * 500
  const due = Math.floor(total * 50) / 100
  return {
    guest_name: 'Ana Reyes',
    phone: '09171234567',
    email: 'ana@example.com',
    check_in: checkIn,
    check_out: checkOut,
    guests,
    accommodation: 'main-house',
    status: 'Pending',
    payment_plan: 'down-payment',
    payment_status: 'pending',
    payment_proof_url: `payments/${GUEST_UID}/${BOOKING_ID}/proof.jpg`,
    amount_claimed: 5000,
    nights: 1,
    rate_amount: total,
    rate_unit: 'standard_stay',
    rate_classification: classification,
    stay_total: total,
    amount_due: due,
    security_deposit: 500,
    balance_due: total - due,
    policy_version: 'emulator-v2',
    policy_effective_date: '2026-10-01',
    created_at: new Date(),
    uid: GUEST_UID,
    ref_id: BOOKING_ID,
    source: 'web',
    ...overrides,
  }
}

function nextCalendarDate(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`)
  return new Date(parsed + 86_400_000).toISOString().slice(0, 10)
}

function futureDateForDay(targetDay: number): string {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + 35)
  while (date.getUTCDay() !== targetDay) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function quotedBooking(
  checkIn: string,
  guests: number,
  options: { holiday?: boolean; accommodation?: string; overrides?: Record<string, unknown> } = {},
) {
  const day = new Date(`${checkIn}T00:00:00Z`).getUTCDay()
  const classification = options.holiday || day === 5 || day === 6 ? 'weekend_holiday' : 'weekday'
  const accommodation = options.accommodation ?? 'main-house'
  const isAHouse = accommodation === 'house-a-camping'
  // The A-House has its own included occupancy: three guests at the flat per-unit
  // rate, and three in total. It is the one unit with a hard cap, so a guest count
  // above it is refused on the cap rather than priced.
  const total = isAHouse
    ? 1000
    : (classification === 'weekend_holiday' ? 6000 : 5000) + Math.max(0, guests - 10) * 500
  const due = Math.floor(total * 50) / 100
  return bookingDoc({
    check_in: checkIn,
    check_out: nextCalendarDate(checkIn),
    nights: 1,
    guests,
    accommodation,
    rate_amount: total,
    rate_unit: 'standard_stay',
    rate_classification: classification,
    stay_total: total,
    amount_due: due,
    security_deposit: isAHouse ? 0 : 500,
    balance_due: total - due,
    payment_plan: 'down-payment',
    amount_claimed: Math.max(5000, due),
    policy_version: 'emulator-v2',
    policy_effective_date: '2026-10-01',
    ...options.overrides,
  })
}

/**
 * Fixtures, written as the Admin with the rules switched off.
 *
 * The context `withSecurityRulesDisabled` hands the callback is the one bound
 * to the emulator's `owner` token, and it must be the context the fixture
 * writes through. Building a second context inside the callback instead — an
 * authenticated one, as this helper used to — puts the writes back under the
 * rules, and they are then refused for reasons that have nothing to do with the
 * case under test: a fixture for a Profile the Admin may open, an
 * Admin-signed Activity entry, the reference catalogue, a `tracking_sessions`
 * row nobody may write at all. Those documents exist to be read by the rules,
 * so a fixture that cannot write them tests nothing.
 */
async function seed(work: (rulesDisabled: RulesTestContext) => Promise<void>) {
  await env.withSecurityRulesDisabled((db) => work(db))
}

/**
 * The two documents several describes need, in one call, because they are read
 * by the rules rather than written by them: a rule that asks who somebody is
 * asks the parent Booking or the conversation, and `exists()` on a document
 * this test never wrote is a false the rule will report as a policy decision.
 */
const convoDoc = (overrides: Record<string, unknown> = {}) => ({
  guest_uid: GUEST_UID,
  category: 'booking-inquiry',
  created_at: new Date(),
  updated_at: new Date(),
  last_message: '',
  unread_admin: 0,
  unread_guest: 0,
  ...overrides,
})

async function seedBaseline(work: (rulesDisabled: RulesTestContext) => Promise<void> = async () => {}) {
  await seed(async (db) => {
    await setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc())
    await setDoc(doc(db.firestore(), 'conversations', CONVO_ID), convoDoc())
    await work(db)
  })
}

describe('authentication and roles', () => {
  it('lets a signed-out visitor create an inquiry Booking and refuses one with no uid', async () => {
    const anon = env.unauthenticatedContext()
    await assertSucceeds(addDoc(collection(anon.firestore(), 'bookings'), bookingDoc({
      payment_status: 'pending',
      payment_proof_url: 'payments/guest-uid-1/proof.jpg',
      amount_claimed: 5000,
    })))
    await assertFails(addDoc(collection(anon.firestore(), 'bookings'), bookingDoc({ uid: '' })))
  })

  it('refuses a Booking created already claiming a payment decision', async () => {
    // Government ID KYC was removed 2026-09-27: the KYC-era create rows went
    // with it (create carries no hasOnly list, an unknown key is refused later).
    const guest = anonymousGuest()
    // ADR-0012: the screenshot and the claimed amount are what the create
    // insists on, so a Booking arriving without them is refused — which is the
    // case the fixture used to cover by accident, back when `bookingDoc()`
    // carried neither field and `payment_status: 'pending'` was meaningless.
    const { payment_proof_url, amount_claimed, ...noScreenshot } = bookingDoc()
    await assertFails(addDoc(collection(guest.firestore(), 'bookings'), noScreenshot))
    // The three decisions that are the Admin's, never the Guest's.
    await assertFails(addDoc(collection(guest.firestore(), 'bookings'), bookingDoc({ payment_status: 'verified' })))
    await assertFails(addDoc(collection(guest.firestore(), 'bookings'), bookingDoc({ payment_status: 'unpaid' })))
    await assertFails(addDoc(collection(guest.firestore(), 'bookings'), bookingDoc({ payment_status: 'rejected' })))
    // .and the shape that is accepted: Pending, screenshot attached, amount claimed.
    await assertSucceeds(addDoc(collection(guest.firestore(), 'bookings'), bookingDoc()))
  })

  it('resolves the Admin from the allowlisted address in the token', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc()))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'bookings', BOOKING_ID)))
    await assertFails(getDoc(doc(emailGuest(OTHER_GUEST_UID).firestore(), 'bookings', BOOKING_ID)))
  })

  it('resolves an Admin promoted by a Profile document', async () => {
    await seed(async (db) => {
      await setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc())
      await setDoc(doc(db.firestore(), 'profiles', 'promoted-admin-1'), { uid: 'promoted-admin-1', role: 'admin' })
    })
    await assertSucceeds(getDoc(doc(env.authenticatedContext('promoted-admin-1', { email: 'staff@example.com' }).firestore(), 'bookings', BOOKING_ID)))
  })

  it('refuses a signed-out visitor a Booking', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc()))
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'bookings', BOOKING_ID)))
  })

  it('never lets a person promote themselves', async () => {
    const guest = anonymousGuest()
    await assertSucceeds(setDoc(doc(guest.firestore(), 'profiles', GUEST_UID), { uid: GUEST_UID, role: 'guest' }))
    await assertFails(setDoc(doc(guest.firestore(), 'profiles', GUEST_UID), { uid: GUEST_UID, role: 'admin' }))
  })
})

describe('bookings', () => {
  beforeEach(async () => {
    await seedBaseline()
  })

  it('lets a Guest read their own Booking and not another Guest\'s', async () => {
    await assertSucceeds(getDoc(doc(anonymousGuest().firestore(), 'bookings', BOOKING_ID)))
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'bookings', BOOKING_ID)))
  })

  it('accepts the self-serve payment patch and refuses any status a Guest cannot reach', async () => {
    // The proof is uploaded against a Booking the Admin has already moved to
    // Payment Pending (ADR-0012) — the Guest never performs that move, so the
    // patch below changes the proof, not the status.
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc({ status: 'Payment Pending' })))
    const guest = emailGuest()
    await assertSucceeds(
      updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), {
        payment_plan: 'Full Payment',
        payment_status: 'pending',
        payment_proof_url: 'https://example.test/proof.jpg',
        amount_claimed: 8500,
        payment_reference: 'GCASH-123456',
      }),
    )
    await assertFails(updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), { status: 'Reserved' }))
  })

  it('refuses a Guest a protected field', async () => {
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { amount_verified: 8500 }))
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { uid: OTHER_GUEST_UID }))
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { guests: 9 }))
  })

  /**
   * The first verification pass found this allowed: a Guest could write
   * `payment_status: 'verified'` because the rule checked the keys the Guest
   * touched, never the values. The rule constrains the value now, and the
   * emulator is where that is settled.
   */
  it('refuses a Guest forging payment_status: verified, from any starting point', async () => {
    const guest = emailGuest()
    await assertFails(updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), { payment_status: 'verified' }))
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc({ status: 'Payment Pending', payment_status: 'pending' })))
    await assertFails(updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), { payment_status: 'verified' }))
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc({ status: 'Payment Pending', payment_status: 'rejected', payment_reject_reason: 'unreadable' })))
    await assertFails(updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), { payment_status: 'verified' }))
    await assertFails(updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), { payment_verified_by: GUEST_UID }))
    await assertFails(updateDoc(doc(guest.firestore(), 'bookings', BOOKING_ID), { payment_verified_at: new Date() }))
  })

  it('refuses a Guest un-verifying money the Admin verified', async () => {
    await seed(async (db) =>
      setDoc(
        doc(db.firestore(), 'bookings', BOOKING_ID),
        bookingDoc({
          status: 'Reserved',
          payment_status: 'verified',
          amount_verified: 8500,
          payment_verified_at: new Date(),
          payment_verified_by: 'admin-uid-1',
        }),
      ),
    )
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { payment_status: 'pending' }))
    await assertSucceeds(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { status: 'Cancelled', cancellation_reason: 'changed plans' }))
  })

  it('bounds the refund a Guest may record when they withdraw a paid Booking', async () => {
    const paid = bookingDoc({
      status: 'Reserved',
      payment_status: 'verified',
      amount_verified: 6500,
      payment_verified_at: new Date(),
      payment_verified_by: 'admin-uid-1',
    })
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), paid))
    const settlement = { stayTotal: 9000, stayRefund: 3250, depositHeld: 2000, damageDeduction: 0, depositRefund: 2000, refundTotal: 5250 }
    await assertSucceeds(
      updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), {
        status: 'Cancelled',
        cancellation_reason: 'changed plans',
        refund_status: 'initiated',
        refund_total: 5250,
        refund_breakdown: settlement,
      }),
    )
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { refund_total: 999999 }))
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', BOOKING_ID), { refund_status: 'refunded' }))
  })

  it('lets the Admin approve into payment and refuses a Booking that skips a gate', async () => {
    await seed(async (db) =>
      setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc({ status: 'Pending', payment_status: 'unpaid' })),
    )
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), { status: 'Payment Pending' }))
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), { status: 'Reserved' }))
    // Approved from Payment Pending is not earned. From Pending, it needs the marker.
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), { status: 'Approved' }))
  })

  it('records the verification the Admin makes, and refuses one nobody signed', async () => {
    const proof = { status: 'Payment Pending', payment_status: 'pending', payment_proof_url: 'payments/x/y/proof.jpg', amount_due: 8500 }
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc(proof)))
    // Verified money without the marker is a claim nobody signed.
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), { status: 'Reserved', payment_status: 'verified' }))
    await assertFails(
      updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), {
        status: 'Reserved',
        payment_status: 'verified',
        amount_verified: 8500,
        payment_verified_at: new Date(),
        payment_verified_by: 'somebody-else',
      }),
    )
    await assertSucceeds(
      updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), {
        status: 'Reserved',
        payment_status: 'verified',
        amount_verified: 8500,
        payment_verified_at: new Date(),
        payment_verified_by: 'admin-uid-1',
      }),
    )
    const stored = await getDoc(doc(admin().firestore(), 'bookings', BOOKING_ID))
    expect(stored.data()?.payment_status).toBe('verified')
    expect(stored.data()?.payment_verified_by).toBe('admin-uid-1')
  })

  it('refuses Reserved while the money is unverified', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc({ status: 'Payment Pending', payment_status: 'pending' })))
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID), { status: 'Reserved' }))
  })
})

describe('activity log', () => {
  const entry = (actor: string, actorId = GUEST_UID) => ({
    booking_id: BOOKING_ID,
    action: 'Submit',
    from_status: null,
    to_status: 'Pending',
    actor,
    actor_id: actorId,
    at: new Date(),
  })

  // `isOwnBooking()` reads the parent, so a Guest filing into their own Booking
  // needs one to exist under their own uid.
  beforeEach(async () => {
    await seedBaseline()
  })

  it('refuses any edit or delete, the Admin included', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1'), entry('admin')))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1')))
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1'), { action: 'rewritten' }))
    await assertFails(deleteDoc(doc(admin().firestore(), 'bookings', BOOKING_ID, 'activity', 'entry-1')))
  })

  it('refuses an entry signed as if a Guest wrote it, by anybody but a Guest', async () => {
    await assertFails(addDoc(collection(admin().firestore(), 'bookings', BOOKING_ID, 'activity'), entry('guest')))
  })

  /**
   * This used to be the question the offline evaluator had to report both ways:
   * the rule read `role()` (and so `request.auth.token.email`) for a Guest, which
   * an anonymous token does not carry. The Guest branch compares `actor_id` with
   * `request.auth.uid` now, so the answer no longer depends on how a missing
   * claim behaves — and the emulator settles it here.
   */
  it('lets an anonymous Guest record their own submission, in their own uid', async () => {
    await assertSucceeds(addDoc(collection(anonymousGuest().firestore(), 'bookings', BOOKING_ID, 'activity'), entry('guest')))
    await assertFails(addDoc(collection(anonymousGuest().firestore(), 'bookings', BOOKING_ID, 'activity'), entry('guest', OTHER_GUEST_UID)))
    await assertFails(addDoc(collection(anonymousGuest(OTHER_GUEST_UID).firestore(), 'bookings', BOOKING_ID, 'activity'), entry('guest', GUEST_UID)))
  })

  it('refuses an entry an Admin files in somebody else\'s name, and keeps the system entry to the Admin', async () => {
    const stamp = { booking_id: BOOKING_ID, action: 'Expire', from_status: 'Pending', to_status: 'Expired', at: new Date() }
    await assertFails(addDoc(collection(admin().firestore(), 'bookings', BOOKING_ID, 'activity'), { ...stamp, actor: 'guest', actor_id: GUEST_UID }))
    await assertFails(addDoc(collection(admin().firestore(), 'bookings', BOOKING_ID, 'activity'), { ...stamp, actor: 'admin', actor_id: GUEST_UID }))
    await assertSucceeds(addDoc(collection(admin().firestore(), 'bookings', BOOKING_ID, 'activity'), { ...stamp, actor: 'system', actor_id: 'system' }))
  })
})

describe('payments and references', () => {
  it('keeps the reference catalogue to the Admin', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'payment_references', 'GCASH-123456'), { reference: 'GCASH-123456', amount: 8500, status: 'available' }))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'payment_references', 'GCASH-123456')))
    await assertFails(getDoc(doc(emailGuest().firestore(), 'payment_references', 'GCASH-123456')))
    await assertFails(setDoc(doc(emailGuest().firestore(), 'payment_references', 'GCASH-999999'), { reference: 'GCASH-999999', amount: 1, status: 'available' }))
    await assertFails(setDoc(doc(admin().firestore(), 'payment_references', 'GCASH-999998'), { reference: 'x', amount: 1, status: 'maybe' }))
  })

  it('refuses to rewrite or delete a reference that has been used', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'payment_references', 'GCASH-777777'), { reference: 'GCASH-777777', amount: 8500, status: 'used', usedBy: BOOKING_ID }))
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'payment_references', 'GCASH-777777'), { status: 'void' }))
    await assertFails(updateDoc(doc(admin().firestore(), 'payment_references', 'GCASH-777777'), { reference: 'GCASH-000000', amount: 1 }))
    await assertFails(deleteDoc(doc(admin().firestore(), 'payment_references', 'GCASH-777777')))
  })
})

describe('chat', () => {
  beforeEach(async () => {
    await seedBaseline()
  })

  it('keeps a conversation to its Guest and to the Admin', async () => {
    await assertSucceeds(getDoc(doc(anonymousGuest().firestore(), 'conversations', CONVO_ID)))
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID)))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'conversations', CONVO_ID)))
  })

  /**
   * Why the conversation id is derived rather than found.
   *
   * `ensureConversation` used to look the thread up with
   * `query(conversations, where('guest_uid', '==', uid))`, and this is what the
   * rules do with that: refuse it. `isConversationMember(convoId)` reads the
   * conversation **by id**, and Firestore cannot prove a field filter satisfies
   * it — the `convoId` wildcard is unbound on a query — so the read is denied and
   * the chat page said "Could not open the conversation." Verified against the
   * live project before the fix, which is how it was found.
   *
   * `bookings` gets away with `where('uid','==',uid)` because `isOwnDoc()` tests
   * that very field, so the filter does satisfy the rule. Nothing here does.
   */
  it('refuses a query for the conversation, which is why the id is derived', async () => {
    const guestDb = anonymousGuest().firestore()
    let error: unknown
    try {
      await getDocs(query(collection(guestDb, 'conversations'), where('guest_uid', '==', GUEST_UID)))
    } catch (caught) {
      error = caught
    }
    expect(error).toBeDefined()
    expect((error as { code?: string }).code).toBe('permission-denied')

    // And the unfiltered list, which is what loosening the rule to allow the
    // query would have granted: every Guest's threads to every Guest.
    let listed: unknown
    try {
      await getDocs(collection(guestDb, 'conversations'))
    } catch (caught) {
      listed = caught
    }
    expect((listed as { code?: string }).code).toBe('permission-denied')
  })

  it('opens the derived conversation id, and finds the same thread a second time', async () => {
    // What `ensureConversation` now does: one document read, then create if it
    // is not there, then the same read again. No collection scan either time.
    const id = conversationDocId(GUEST_UID, 'booking')
    const guestDb = anonymousGuest().firestore()

    expect((await getDoc(doc(guestDb, 'conversations', id))).exists()).toBe(false)

    await assertSucceeds(
      setDoc(doc(guestDb, 'conversations', id), {
        guest_uid: GUEST_UID,
        category: 'booking',
        created_at: new Date(),
        updated_at: new Date(),
        last_message: '',
        unread_admin: 0,
        unread_guest: 0,
      }),
    )

    const second = await getDoc(doc(guestDb, 'conversations', id))
    expect(second.exists()).toBe(true)
    expect(second.data()?.guest_uid).toBe(GUEST_UID)
    // .and it is still nobody else's.
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', id)))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'conversations', id)))
  })

  it('gives two Guests two conversations even on the same category', async () => {
    const mine = conversationDocId(GUEST_UID, 'access')
    const theirs = conversationDocId(OTHER_GUEST_UID, 'access')
    expect(mine).not.toBe(theirs)
    await assertSucceeds(
      setDoc(doc(anonymousGuest().firestore(), 'conversations', mine), {
        guest_uid: GUEST_UID, category: 'access',
        created_at: new Date(), updated_at: new Date(),
        last_message: '', unread_admin: 0, unread_guest: 0,
      }),
    )
    // The other Guest's derived id is empty, and readable — because it is theirs.
    expect((await getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', theirs))).exists()).toBe(false)
    // .and this one is not readable by them.
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', mine)))
  })

  it('lets the Guest send as themselves and refuses a spoofed sender', async () => {
    const message = { sender_uid: GUEST_UID, sender_role: 'guest', text: 'Hello?', created_at: new Date() }
    await assertSucceeds(addDoc(collection(anonymousGuest().firestore(), 'conversations', CONVO_ID, 'messages'), message))
    await assertFails(addDoc(collection(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID, 'messages'), message))
  })

  it('never lets a message be rewritten', async () => {
    const sent = await addDoc(collection(anonymousGuest().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: GUEST_UID,
      sender_role: 'guest',
      text: 'Hello?',
      created_at: new Date(),
    })
    await assertFails(updateDoc(doc(admin().firestore(), 'conversations', CONVO_ID, 'messages', sent.id), { text: 'edited' }))
    await assertFails(deleteDoc(doc(admin().firestore(), 'conversations', CONVO_ID, 'messages', sent.id)))
  })

  /**
   * The first verification pass found this allowed: knowing the conversation id
   * was enough to post into it. Membership is read from the conversation now.
   */
  it('refuses a stranger posting into a conversation that is not theirs', async () => {
    await assertFails(addDoc(collection(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: OTHER_GUEST_UID,
      sender_role: 'guest',
      text: 'not mine',
      created_at: new Date(),
    }))
    await assertFails(addDoc(collection(emailGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: OTHER_GUEST_UID,
      sender_role: 'guest',
      text: 'not mine either',
      created_at: new Date(),
    }))
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'conversations', CONVO_ID, 'messages', 'anything')))
  })

  it('refuses a message labelled as the other side', async () => {
    await assertFails(addDoc(collection(anonymousGuest().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: GUEST_UID,
      sender_role: 'admin',
      text: 'pretending',
      created_at: new Date(),
    }))
    await assertSucceeds(addDoc(collection(admin().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: 'admin-uid-1',
      sender_role: 'admin',
      text: 'Admin here.',
      created_at: new Date(),
    }))
  })

  it('holds both sides to 1,000 characters', async () => {
    await assertSucceeds(addDoc(collection(anonymousGuest().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: GUEST_UID, sender_role: 'guest', text: 'x'.repeat(1000), created_at: new Date(),
    }))
    await assertFails(addDoc(collection(anonymousGuest().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: GUEST_UID, sender_role: 'guest', text: 'x'.repeat(1001), created_at: new Date(),
    }))
    await assertSucceeds(addDoc(collection(admin().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: 'admin-uid-1', sender_role: 'admin', text: 'x'.repeat(1000), created_at: new Date(),
    }))
    await assertFails(addDoc(collection(admin().firestore(), 'conversations', CONVO_ID, 'messages'), {
      sender_uid: 'admin-uid-1', sender_role: 'admin', text: 'x'.repeat(1001), created_at: new Date(),
    }))
  })

  it('lets only the Admin stamp the retention expiry on a conversation', async () => {
    const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    // Neither stamping it nor moving one: `diff().affectedKeys()` sees only what
    // actually changes, so a Guest rewriting the Admin's own value would touch
    // no key at all and pass on the empty diff. The second case therefore moves
    // it to a different date rather than restating the same one.
    await assertFails(updateDoc(doc(anonymousGuest().firestore(), 'conversations', CONVO_ID), { messages_expires_at: expires }))
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'conversations', CONVO_ID), { messages_expires_at: expires }))
    await assertFails(updateDoc(doc(anonymousGuest().firestore(), 'conversations', CONVO_ID), { messages_expires_at: new Date(Date.now() + 91 * 24 * 60 * 60 * 1000) }))
    // A Guest's own write is still fine — the four fields the inbox needs.
    await assertSucceeds(updateDoc(doc(anonymousGuest().firestore(), 'conversations', CONVO_ID), { unread_admin: 1 }))
  })

  it('refuses a message into a conversation that does not exist', async () => {
    await assertFails(addDoc(collection(anonymousGuest().firestore(), 'conversations', 'no-such-conversation', 'messages'), {
      sender_uid: GUEST_UID,
      sender_role: 'guest',
      text: 'hello?',
      created_at: new Date(),
    }))
  })
})

describe('reviews', () => {
  /**
   * The document id is the Booking id, and the rule reads that Booking: the
   * Review is the author's, and the stay is over. Everything below is that
   * contract, settled by the emulator rather than by the offline evaluator.
   *
   * `edit_until` is stamped by the client as `now + 14 days` and the rule
   * recomputes it from its own clock, so a fixture computes the same value the
   * way the app does — the alternative is a document the rule always refuses.
   */
  const review = (overrides: Record<string, unknown> = {}) => {
    const now = Timestamp.now()
    return {
      booking_id: BOOKING_ID,
      uid: GUEST_UID,
      stars: 5,
      text: 'Lovely',
      created_at: '2026-10-05T02:00:00.000Z',
      status: 'pending',
      edit_until: Timestamp.fromMillis(now.toMillis() + 14 * 86400000),
      ...overrides,
    }
  }

  /**
   * The stays, plus the one Review the later cases go on to correct, moderate
   * and read. Seeded per test rather than once, because five of these cases are
   * about what may be done to a Review that already exists — and with a
   * per-suite fixture they only passed by inheriting the Review the first case
   * happened to leave behind.
   *
   * `booking-mine` is a second finished stay of the same Guest, and no Review
   * is seeded under it: the cases that are about what a *create* may carry are
   * pointed there, so they still exercise the create rule rather than arriving
   * at an existing document as an update.
   */
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db.firestore(), 'bookings', BOOKING_ID), bookingDoc({ status: 'Completed' }))
      await setDoc(doc(db.firestore(), 'bookings', 'booking-mine'), bookingDoc({ ref_id: 'booking-mine', status: 'Completed' }))
      await setDoc(doc(db.firestore(), 'bookings', 'booking-2'), bookingDoc({ ref_id: 'booking-2', uid: OTHER_GUEST_UID, status: 'Completed' }))
      await setDoc(doc(db.firestore(), 'bookings', 'booking-open'), bookingDoc({ ref_id: 'booking-open', status: 'Staying' }))
      await setDoc(doc(db.firestore(), 'bookings', 'booking-cancelled'), bookingDoc({ ref_id: 'booking-cancelled', status: 'Cancelled' }))
      await setDoc(doc(db.firestore(), 'reviews', BOOKING_ID), review())
    })
  })

  it('accepts a Guest review of their own finished stay, and refuses the rest', async () => {
    const guest = emailGuest()
    await assertSucceeds(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine' })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-2'), review({ booking_id: 'booking-2' })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-open'), review({ booking_id: 'booking-open' })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-nope'), review({ booking_id: 'booking-nope' })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-cancelled'), review({ booking_id: 'booking-cancelled' })))
  })

  it('refuses a star rating outside 1..5 and a review signed in somebody else\'s name', async () => {
    const guest = emailGuest()
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', stars: 6 })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', uid: OTHER_GUEST_UID })))
    // Another Guest cannot write this Guest's review, in their own name.
    const other = emailGuest(OTHER_GUEST_UID)
    await assertFails(setDoc(doc(other.firestore(), 'reviews', BOOKING_ID), review({ uid: OTHER_GUEST_UID })))
    // Both ends of the range, so a rule that refused everything would not pass.
    await assertFails(setDoc(doc(other.firestore(), 'reviews', BOOKING_ID), review({ uid: OTHER_GUEST_UID, stars: 0 })))
    // .and the same Guest may review a stay of their own that is over, so the
    // refusals above are about whose review it is and not about reviews.
    await assertSucceeds(setDoc(doc(other.firestore(), 'reviews', 'booking-2'), review({ booking_id: 'booking-2', uid: OTHER_GUEST_UID })))
  })

  it('refuses a review that arrives already published, or carrying the Admin\'s fields', async () => {
    // A finished stay, so each refusal below is about the field named and not
    // about the stay gate that would have refused it anyway.
    const guest = emailGuest()
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', status: 'published' })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', admin_response: 'thanks' })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', status: 'published', edit_until: Timestamp.fromMillis(Date.now() + 10 * 365 * 86400000) })))
  })

  it('refuses feedback that is blank or past the limit, and accepts it at the limit', async () => {
    const guest = emailGuest()
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', text: '   ' })))
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', text: 'x'.repeat(1001) })))
    await assertSucceeds(setDoc(doc(guest.firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine', text: 'x'.repeat(1000) })))
  })

  it('lets the Guest correct their own review, and nothing else', async () => {
    const guest = emailGuest()
    await assertSucceeds(updateDoc(doc(guest.firestore(), 'reviews', BOOKING_ID), { stars: 4, updated_at: new Date() }))
    // Not theirs to move: the status, the Admin's reply, or the deadline.
    await assertFails(updateDoc(doc(guest.firestore(), 'reviews', BOOKING_ID), { status: 'published' }))
    await assertFails(updateDoc(doc(guest.firestore(), 'reviews', BOOKING_ID), { admin_response: 'thanks' }))
    await assertFails(updateDoc(doc(guest.firestore(), 'reviews', BOOKING_ID), { uid: OTHER_GUEST_UID }))
    // Nor another Guest's.
    await assertFails(updateDoc(doc(emailGuest(OTHER_GUEST_UID).firestore(), 'reviews', BOOKING_ID), { stars: 1 }))
  })

  it('refuses a Guest deleting a review, and a second one for the same stay', async () => {
    const guest = emailGuest()
    await assertFails(deleteDoc(doc(guest.firestore(), 'reviews', BOOKING_ID)))
    // A second write at the same id is a `setDoc`, which the Firestore client
    // turns into an update — so this is the only way a Guest can try to file a
    // second review, and what refuses it is the fortnight. `edit_until` is not
    // among the keys a Guest may move, so a fresh window is refused on its own
    // account rather than because two clocks happened to differ.
    const second = Timestamp.fromMillis(Date.now() + 15 * 86400000)
    await assertFails(setDoc(doc(guest.firestore(), 'reviews', BOOKING_ID), review({ stars: 1, edit_until: second })))
    await assertSucceeds(deleteDoc(doc(admin().firestore(), 'reviews', BOOKING_ID)))
  })

  it('keeps reviews private between Guests', async () => {
    await assertSucceeds(getDoc(doc(emailGuest().firestore(), 'reviews', BOOKING_ID)))
    await assertFails(getDoc(doc(emailGuest(OTHER_GUEST_UID).firestore(), 'reviews', BOOKING_ID)))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'reviews', BOOKING_ID)))
  })

  it('answers the first submit\'s question: there is no review of this stay yet', async () => {
    // `submitReview` reads before it writes, so the very first review of a stay
    // arrives at an id with nothing behind it. Refusing that read refuses the
    // write that was never attempted - and the Guest is told Firestore refused.
    // `booking-mine` is this Guest's own finished stay, with no Review seeded.
    const missing = await assertSucceeds(getDoc(doc(emailGuest().firestore(), 'reviews', 'booking-mine')))
    expect(missing.exists()).toBe(false)
    // The absence belongs to nobody else: this Guest may not ask about another
    // Guest's stay, may not ask about a stay that never happened, and the
    // signed-out visitor may not ask at all.
    await assertFails(getDoc(doc(emailGuest().firestore(), 'reviews', 'booking-2')))
    await assertFails(getDoc(doc(emailGuest().firestore(), 'reviews', 'booking-nope')))
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'reviews', 'booking-mine')))
    // And a Review that is there is still nobody else's to read.
    await assertFails(getDoc(doc(emailGuest(OTHER_GUEST_UID).firestore(), 'reviews', BOOKING_ID)))
    // And with the door open the create that follows goes through.
    await assertSucceeds(setDoc(doc(emailGuest().firestore(), 'reviews', 'booking-mine'), review({ booking_id: 'booking-mine' })))
    await assertSucceeds(getDoc(doc(emailGuest().firestore(), 'reviews', 'booking-mine')))
  })

  it('gives the Admin moderation and a reply, and never the Guest\'s words', async () => {
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'reviews', BOOKING_ID), { status: 'published', published_at: new Date() }))
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'reviews', BOOKING_ID), { admin_response: 'Thank you for staying with us!', admin_response_at: new Date(), admin_response_by: 'admin-uid-1' }))
    // The Guest's rating is not the Admin's to rewrite, only to hide.
    await assertFails(updateDoc(doc(admin().firestore(), 'reviews', BOOKING_ID), { stars: 5, text: 'Rewritten' }))
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'reviews', BOOKING_ID), { status: 'hidden', moderated_at: new Date(), moderated_by: 'admin-uid-1' }))
    await assertFails(updateDoc(doc(admin().firestore(), 'reviews', BOOKING_ID), { status: 'deleted' }))
  })
})

describe('public reviews: what a signed-out visitor may read', () => {
  const published = (overrides: Record<string, unknown> = {}) => ({
    review_id: BOOKING_ID,
    stars: 5,
    excerpt: 'Lovely stay.',
    display_name: 'Guest',
    month: 'October 2026',
    published_at: new Date(),
    ...overrides,
  })

  it('is readable by anybody, and writable by the Admin only', async () => {
    await assertSucceeds(setDoc(doc(admin().firestore(), 'public_reviews', BOOKING_ID), published()))
    await assertFails(setDoc(doc(emailGuest().firestore(), 'public_reviews', 'b2'), published({ review_id: 'b2' })))
    await assertFails(setDoc(doc(emailGuest().firestore(), 'public_reviews', BOOKING_ID), published()))
  })

  it('refuses a testimonial carrying anything private', async () => {
    for (const extra of [{ uid: GUEST_UID }, { guest_uid: GUEST_UID }, { booking_id: BOOKING_ID }, { admin_response: 'private' }, { status: 'published' }, { email: 'ana@example.com' }]) {
      await assertFails(setDoc(doc(admin().firestore(), 'public_reviews', 'b3'), published({ review_id: 'b3', ...extra })))
    }
  })

  it('refuses an empty, oversized or unrated testimonial', async () => {
    await assertFails(setDoc(doc(admin().firestore(), 'public_reviews', 'b4'), published({ review_id: 'b4', excerpt: '' })))
    await assertFails(setDoc(doc(admin().firestore(), 'public_reviews', 'b5'), published({ review_id: 'b5', excerpt: 'x'.repeat(401) })))
    await assertFails(setDoc(doc(admin().firestore(), 'public_reviews', 'b6'), published({ review_id: 'b6', display_name: 'x'.repeat(61) })))
    await assertFails(setDoc(doc(admin().firestore(), 'public_reviews', 'b7'), published({ review_id: 'b7', stars: 0 })))
    await assertFails(setDoc(doc(admin().firestore(), 'public_reviews', 'b8'), published({ review_id: 'b8', stars: 6 })))
    await assertFails(setDoc(doc(admin().firestore(), 'public_reviews', 'b9'), published({ review_id: 'b10' })))
  })

  it('withdraws by deleting, never by editing', async () => {
    await assertFails(updateDoc(doc(admin().firestore(), 'public_reviews', BOOKING_ID), { excerpt: 'Something else' }))
    await assertSucceeds(deleteDoc(doc(admin().firestore(), 'public_reviews', BOOKING_ID)))
    await assertFails(deleteDoc(doc(emailGuest().firestore(), 'public_reviews', BOOKING_ID)))
  })
})

describe('smart lock and the retired tracker', () => {
  // `isConversationMember()` reads the conversation, so the live-location cases
  // below need one that exists and belongs to the Guest sharing.
  beforeEach(async () => {
    await seedBaseline()
  })

  it('records a lock touch in the writer\'s own uid, and refuses a spoofed one', async () => {
    const row = { timestamp: new Date(), uid: GUEST_UID, ref_id: BOOKING_ID, result: 'granted', reason: 'mobile-key' }
    await assertSucceeds(addDoc(collection(anonymousGuest().firestore(), 'access_logs'), row))
    await assertFails(addDoc(collection(anonymousGuest(OTHER_GUEST_UID).firestore(), 'access_logs'), row))
    await assertFails(addDoc(collection(anonymousGuest().firestore(), 'access_logs'), { ...row, result: 'maybe' }))
  })

  it('keeps the Access log readable by the Admin only', async () => {
    await assertSucceeds(getDocs(admin().firestore().collection('access_logs')))
    await assertFails(getDocs(anonymousGuest().firestore().collection('access_logs')))
  })

  it('refuses the tracking_sessions collection to everybody', async () => {
    const session = { bookingId: BOOKING_ID, uid: GUEST_UID, tracking_consent_at: new Date(), latitude: 14.1, longitude: 121.3, lastUpdated: new Date() }
    const path = `tracking_sessions/${BOOKING_ID}`
    await assertFails(setDoc(doc(anonymousGuest().firestore(), path), session))
    await assertFails(getDoc(doc(anonymousGuest().firestore(), path)))
    await assertFails(setDoc(doc(admin().firestore(), path), session))
    await assertFails(getDoc(doc(admin().firestore(), path)))
    await assertFails(getDocs(admin().firestore().collection('tracking_sessions')))
  })

  it('keeps a consent in location_sessions, and a coordinate out of it', async () => {
    const session = {
      guest_uid: GUEST_UID,
      conversation_id: CONVO_ID,
      active: true,
      started_at: new Date(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000),
      duration_minutes: 30,
      stream_secret: 'a'.repeat(32),
    }
    await assertSucceeds(setDoc(doc(anonymousGuest().firestore(), 'location_sessions', CONVO_ID), session))
    // The same Guest, in their own conversation, and the Admin, can read it.
    await assertSucceeds(getDoc(doc(anonymousGuest().firestore(), 'location_sessions', CONVO_ID)))
    await assertSucceeds(getDoc(doc(admin().firestore(), 'location_sessions', CONVO_ID)))
    // Nobody else can.
    await assertFails(getDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'location_sessions', CONVO_ID)))
    // A Guest cannot open one in a conversation that is not theirs…
    await assertFails(setDoc(doc(anonymousGuest(OTHER_GUEST_UID).firestore(), 'location_sessions', CONVO_ID), {
      ...session, guest_uid: OTHER_GUEST_UID,
    }))
    // …cannot smuggle a position into it…
    await assertFails(setDoc(doc(anonymousGuest().firestore(), 'location_sessions', CONVO_ID), { ...session, lat: 14.1 }))
    // …and cannot buy more than an hour.
    await assertFails(setDoc(doc(anonymousGuest().firestore(), 'location_sessions', CONVO_ID), {
      ...session, duration_minutes: 60, expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }))
    // Ending the session is allowed; moving its secret is not.
    await assertSucceeds(updateDoc(doc(anonymousGuest().firestore(), 'location_sessions', CONVO_ID), {
      active: false, expires_at: new Date(),
    }))
    await assertFails(updateDoc(doc(anonymousGuest().firestore(), 'location_sessions', CONVO_ID), {
      stream_secret: 'b'.repeat(32),
    }))
  })

  it('leaves the Admin the delete that purges an old session', async () => {
    await seed(async (db) => setDoc(doc(db.firestore(), 'tracking_sessions', BOOKING_ID), { bookingId: BOOKING_ID, uid: GUEST_UID }))
    await assertSucceeds(deleteDoc(doc(admin().firestore(), 'tracking_sessions', BOOKING_ID)))
  })
})

describe('storage', () => {
  const bytes = new Uint8Array([137, 80, 78, 71])

  it('lets a Guest upload their own proof and refuses another Guest\'s folder', async () => {
    await assertSucceeds(uploadBytes(ref(anonymousGuest().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`), bytes, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(anonymousGuest(OTHER_GUEST_UID).storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`), bytes, { contentType: 'image/png' }))
  })

  it('refuses a non-image upload', async () => {
    await assertFails(uploadBytes(ref(anonymousGuest().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.txt`), bytes, { contentType: 'text/plain' }))
  })

  it('refuses the retired /kyc slot to everyone — Guest upload, Admin upload, Admin read', async () => {
    await assertFails(uploadBytes(ref(anonymousGuest().storage(), `kyc/${GUEST_UID}/${BOOKING_ID}/id.png`), bytes, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(admin().storage(), `kyc/${GUEST_UID}/${BOOKING_ID}/id.png`), bytes, { contentType: 'image/png' }))
    await assertFails(getDownloadURL(ref(admin().storage(), `kyc/${GUEST_UID}/${BOOKING_ID}/id.png`)))
  })

  it('keeps a payment proof to its owner and the Admin', async () => {
    await assertSucceeds(getDownloadURL(ref(anonymousGuest().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
    await assertFails(getDownloadURL(ref(emailGuest(OTHER_GUEST_UID).storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
    await assertSucceeds(getDownloadURL(ref(admin().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
  })

  it('lets nobody read a payment proof signed out', async () => {
    await assertFails(getDownloadURL(ref(env.unauthenticatedContext().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
  })

  it('lets only the Admin delete a proof', async () => {
    await assertFails(deleteObject(ref(anonymousGuest().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
    await assertSucceeds(deleteObject(ref(admin().storage(), `payments/${GUEST_UID}/${BOOKING_ID}/proof.png`)))
  })

  it('refuses a path with no rule', async () => {
    await assertFails(uploadBytes(ref(admin().storage(), 'backups/dump.png'), bytes, { contentType: 'image/png' }))
  })
})

// Independent calendar arithmetic, not the app helper: the emulator's request
// clock is real and cannot be set by the client. UTC+08:00 is Asia/Manila today.
function manilaDatePlus(days: number): string {
  const calendar = new Date(Date.now() + 8 * 60 * 60 * 1000)
  calendar.setUTCHours(0, 0, 0, 0)
  calendar.setUTCDate(calendar.getUTCDate() + days)
  return calendar.toISOString().slice(0, 10)
}

describe('published guest-count prices: independent Firestore verification', () => {
  it('recomputes weekday, Friday/Saturday, Sunday, holiday, and excess totals with 50% due now', async () => {
    const cases = [
      ['weekday-monday', futureDateForDay(1), 10, 'weekday', 5000, 2500],
      ['weekend-friday', futureDateForDay(5), 11, 'weekend_holiday', 6500, 3250],
      ['weekend-saturday', futureDateForDay(6), 14, 'weekend_holiday', 8000, 4000],
      ['weekday-sunday', futureDateForDay(0), 10, 'weekday', 5000, 2500],
    ] as const
    const guest = anonymousGuest()
    for (const [id, date, guests, classification, total, due] of cases) {
      const payload = quotedBooking(date, guests)
      expect(payload).toMatchObject({ rate_classification: classification, stay_total: total, amount_due: due, balance_due: total - due })
      await assertSucceeds(setDoc(doc(guest.firestore(), 'bookings', id), payload))
      await assertFails(setDoc(doc(guest.firestore(), 'bookings', `${id}-tampered`), {
        ...payload, stay_total: total + 1,
      }))
    }

    const holiday = futureDateForDay(2)
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'site_config', 'rates'), { holiday_dates: [holiday] }))
    await assertSucceeds(setDoc(doc(guest.firestore(), 'bookings', 'configured-holiday'), quotedBooking(holiday, 10, { holiday: true })))
  })

  it('prices one A-House up to three guests and refuses a fourth', async () => {
    const guest = anonymousGuest()
    const date = futureDateForDay(3)
    // Three is both the included count and the cap, so the stay is the flat
    // per-unit rate whatever the headcount inside it.
    await assertSucceeds(setDoc(doc(guest.firestore(), 'bookings', 'a-house-three'), quotedBooking(date, 3, { accommodation: 'house-a-camping' })))
    // A fourth is past what the unit can hold. There is no excess rule to price
    // it, so the Booking is refused whatever the guest claims to have paid.
    await assertFails(setDoc(doc(guest.firestore(), 'bookings', 'a-house-four'), quotedBooking(date, 4, { accommodation: 'house-a-camping' })))
    // And so is a fifth.
    await assertFails(setDoc(doc(guest.firestore(), 'bookings', 'a-house-five'), quotedBooking(date, 5, { accommodation: 'house-a-camping' })))
  })

  it('stores only the exact Admin-published refund-policy snapshot', async () => {
    const refund = {
      refund_percent: 50,
      deposit_refund_percent: 100,
      tiers: [{ min_days_before_check_in: 7, refund_percent: 75 }],
    }
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'site_config', 'rates'), { refund }))
    const guest = anonymousGuest()
    const date = futureDateForDay(2)
    await assertSucceeds(setDoc(doc(guest.firestore(), 'bookings', 'refund-snapshot'), {
      ...quotedBooking(date, 10),
      refund_policy_snapshot: refund,
    }))
    await assertFails(setDoc(doc(guest.firestore(), 'bookings', 'refund-tampered'), {
      ...quotedBooking(date, 10),
      refund_policy_snapshot: { ...refund, refund_percent: 100 },
    }))
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', 'refund-snapshot'), {
      refund_policy_snapshot: { ...refund, refund_percent: 100 },
    }))
  })
})

describe('historical payment choices retain their stored quote', () => {
  it('allows a 50% choice from a saved legacy total without reading or stamping today\'s rates', async () => {
    const base: Record<string, unknown> = {
      ...bookingDoc({
        status: 'Payment Pending', payment_status: 'unpaid',
        check_in: '2029-06-01', check_out: '2029-06-03', nights: 2,
        rate_amount: 4250, rate_unit: 'night', stay_total: 8500,
        security_deposit: 500, policy_version: 'historic-v1', policy_effective_date: '2029-01-01',
      }),
    }
    delete base.rate_classification
    delete base.payment_plan
    delete base.amount_due
    delete base.balance_due
    await seed(async (owner) => setDoc(doc(owner.firestore(), 'bookings', 'historic-choice'), base))
    const target = doc(emailGuest().firestore(), 'bookings', 'historic-choice')
    await assertSucceeds(updateDoc(target, {
      payment_plan: 'down-payment', payment_status: 'pending', amount_due: 4250, balance_due: 4250,
    }))
    expect((await assertSucceeds(getDoc(target))).data()).toMatchObject({
      stay_total: 8500, amount_due: 4250, balance_due: 4250,
      rate_amount: 4250, rate_unit: 'night', policy_version: 'historic-v1',
    })

    const noStoredTotal = { ...base }
    delete noStoredTotal.stay_total
    await seed(async (owner) => setDoc(doc(owner.firestore(), 'bookings', 'historic-rate-fallback'), noStoredTotal))
    await assertSucceeds(updateDoc(doc(emailGuest().firestore(), 'bookings', 'historic-rate-fallback'), {
      payment_plan: 'down-payment', payment_status: 'pending', stay_total: 8500,
      amount_due: 4250, balance_due: 4250,
    }))

    const camelTotal = { ...base, totalAmount: 8500 }
    delete camelTotal.stay_total
    delete camelTotal.rate_amount
    delete camelTotal.rate_unit
    await seed(async (owner) => setDoc(doc(owner.firestore(), 'bookings', 'historic-camel-total'), camelTotal))
    await assertSucceeds(updateDoc(doc(emailGuest().firestore(), 'bookings', 'historic-camel-total'), {
      payment_plan: 'down-payment', payment_status: 'pending', stay_total: 8500,
      amount_due: 4250, balance_due: 4250,
    }))
    await assertFails(updateDoc(doc(admin().firestore(), 'bookings', 'historic-camel-total'), {
      totalAmount: 9000,
    }))

    await seed(async (owner) => setDoc(doc(owner.firestore(), 'bookings', 'historic-tamper'), base))
    await assertFails(updateDoc(doc(emailGuest().firestore(), 'bookings', 'historic-tamper'), {
      payment_plan: 'down-payment', payment_status: 'pending', amount_due: 1, balance_due: 8499,
    }))
  })
})

describe('guest minimum advance booking: direct Firestore requests', () => {
  it.each([0, 1, 7, 29])('refuses today + %i with no booking/payment/activity records', async (days) => {
    const guest = anonymousGuest()
    await assertFails(setDoc(doc(guest.firestore(), 'bookings', 'direct-invalid'), bookingDoc({
      check_in: manilaDatePlus(days), check_out: manilaDatePlus(days + 1),
    })))
    await seed(async (owner) => {
      expect((await getDocs(collection(owner.firestore(), 'bookings'))).size).toBe(0)
      expect((await getDocs(collection(owner.firestore(), 'payment_references'))).size).toBe(0)
      expect((await getDocs(collection(owner.firestore(), 'bookings', 'direct-invalid', 'activity'))).size).toBe(0)
    })
  })

  it.each([30, 31, 60])('allows today + %i through the existing Pending/proof workflow', async (days) => {
    const guest = anonymousGuest()
    const target = doc(guest.firestore(), 'bookings', 'direct-valid')
    await assertSucceeds(setDoc(target, bookingDoc({
      check_in: manilaDatePlus(days), check_out: manilaDatePlus(days + 1),
    })))
    const stored = await assertSucceeds(getDoc(target))
    expect(stored.data()).toMatchObject({ status: 'Pending', payment_status: 'pending', amount_claimed: 5000 })
    expect(stored.data()?.payment_proof_url).toBeTruthy()
  })

  it('does not trust created_at, a forged policy, source or an Admin actor/uid claim', async () => {
    await assertFails(setDoc(doc(anonymousGuest().firestore(), 'bookings', 'spoofed'), bookingDoc({
      check_in: manilaDatePlus(7), created_at: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
      source: 'admin', actor: 'admin', uid: 'admin-uid-1', minimumBookingLeadTimeDays: 0,
    })))
    await seed(async (owner) => expect((await getDocs(collection(owner.firestore(), 'bookings'))).size).toBe(0))
  })

  it('applies the same lead time to the existing signed-out public create path', async () => {
    const publicDB = env.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(publicDB, 'bookings', 'public-invalid'), bookingDoc({ check_in: manilaDatePlus(7) })))
    await assertSucceeds(setDoc(doc(publicDB, 'bookings', 'public-valid'), bookingDoc({ check_in: manilaDatePlus(30) })))
  })

  it.each(['2026-11-31', '2027-02-29', '2099-13-01', '2099-01-01T00:00:00Z', '2099-1-01', 'garbage'])(
    'rejects malformed calendar date %s', async (check_in) => {
      await assertFails(setDoc(doc(anonymousGuest().firestore(), 'bookings', 'bad-date'), bookingDoc({ check_in })))
    },
  )

  it('reads a configurable 45-day policy and refuses Guest changes to it', async () => {
    const policy = doc(admin().firestore(), 'site_config', 'booking')
    await assertSucceeds(setDoc(policy, { minimumBookingLeadTimeDays: 45 }))
    const guest = anonymousGuest()
    await assertSucceeds(getDoc(doc(guest.firestore(), 'site_config', 'booking')))
    await assertFails(updateDoc(doc(guest.firestore(), 'site_config', 'booking'), { minimumBookingLeadTimeDays: 0 }))
    await assertFails(setDoc(doc(guest.firestore(), 'bookings', 'policy-invalid'), bookingDoc({ check_in: manilaDatePlus(44) })))
    await assertSucceeds(setDoc(doc(guest.firestore(), 'bookings', 'policy-valid'), bookingDoc({ check_in: manilaDatePlus(45) })))
  })

  it.each([0, -1, 1.5, '45', null])('refuses invalid Admin policy value %s', async (minimumBookingLeadTimeDays) => {
    await assertFails(setDoc(doc(admin().firestore(), 'site_config', 'booking'), { minimumBookingLeadTimeDays }))
  })

  it('preserves manual creates for both allowlisted and Profile-promoted Admins', async () => {
    await assertSucceeds(setDoc(doc(admin().firestore(), 'bookings', 'manual'), bookingDoc({ check_in: manilaDatePlus(1) })))
    await seed(async (owner) => setDoc(doc(owner.firestore(), 'profiles', 'promoted-admin-1'), { uid: 'promoted-admin-1', role: 'admin' }))
    const promoted = env.authenticatedContext('promoted-admin-1', {})
    await assertSucceeds(setDoc(doc(promoted.firestore(), 'bookings', 'manual-promoted'), bookingDoc({ check_in: manilaDatePlus(1) })))
  })

  it('does not revalidate lead time on existing Guest withdrawals or Admin approval', async () => {
    await seed(async (owner) => {
      await setDoc(doc(owner.firestore(), 'bookings', 'legacy-cancel'), bookingDoc({ check_in: manilaDatePlus(7) }))
      await setDoc(doc(owner.firestore(), 'bookings', 'legacy-approve'), bookingDoc({ check_in: manilaDatePlus(7) }))
    })
    await assertSucceeds(updateDoc(doc(anonymousGuest().firestore(), 'bookings', 'legacy-cancel'), { status: 'Cancelled' }))
    await assertSucceeds(updateDoc(doc(admin().firestore(), 'bookings', 'legacy-approve'), {
      status: 'Approved', payment_status: 'verified', amount_verified: 5000,
      payment_verified_at: new Date().toISOString(), payment_verified_by: 'admin-uid-1',
    }))
  })

  it('still refuses a Guest changing the dates of an existing booking', async () => {
    const guest = anonymousGuest()
    const target = doc(guest.firestore(), 'bookings', 'immutable-dates')
    await assertSucceeds(setDoc(target, bookingDoc()))
    await assertFails(updateDoc(target, { check_in: manilaDatePlus(7) }))
  })
})


describe('booking policy: existing Admin metadata', () => {
  it('preserves unrelated Admin settings on the policy document', async () => {
    const target = doc(admin().firestore(), 'site_config', 'booking')
    await assertSucceeds(setDoc(target, { notes: 'existing Admin metadata' }))
    await assertSucceeds(updateDoc(target, { minimumBookingLeadTimeDays: 45 }))
    expect((await assertSucceeds(getDoc(target))).data()).toEqual({ notes: 'existing Admin metadata', minimumBookingLeadTimeDays: 45 })
  })
})
