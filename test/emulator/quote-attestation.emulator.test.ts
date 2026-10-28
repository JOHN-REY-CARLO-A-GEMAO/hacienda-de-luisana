/**
 * The attestation path, enforced by the Firebase Emulator Suite.
 *
 * Companion to `test/rules/quote-attestation.rules.test.ts`, which runs the same
 * estate against the offline evaluator everywhere Java is not. This file exists
 * because of the specific way this repository was burned in 2026-10-14: a rules
 * change that was legal, correct, and green offline, and that the deployed rules
 * rejected by exceeding Firestore's evaluation budget — reporting it as the same
 * bare `permission-denied` a policy refusal produces (ADR-0018). The emulator is
 * the only tool that reads `site_config/booking.quotes_required` through the real
 * rules engine, so everything below is written to be *run* before enforcement is
 * flipped on, not merely to compile.
 *
 * Run with `npm run test:emulator` (it needs Java and the one-time emulator
 * download). If it has never run, say so — a suite that was never executed is not
 * evidence, and this file's own README-level promise is that the emulator verdict is
 * the one that counts.
 *
 * What this file deliberately does **not** do: assert anything about the expression
 * budget as a number. `test/rules/firestore-rule-limits.test.ts` measures cost with
 * an in-house counter and says why that counter is a canary rather than a
 * certificate; the real ceiling is Firestore's, and the only honest emulator check
 * is the one this whole file is — that the writes the estate actually performs are
 * accepted, and the ones it must refuse are refused, with no `INTERNAL` and no
 * budget error in the message.
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
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? 'demo-hacienda'
const ADMIN_EMAIL = 'gemaojohnreyarguilles@gmail.com'
const GUEST_UID = 'quote-guest-1'
const OTHER_GUEST_UID = 'quote-guest-2'

/** Matches the seeded card below: one night for ten, weekday, ₱5,000. */
const RATE = 5000
const TOTAL = 5000
const DUE = 2500

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(join(__dirname, '../../firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

/**
 * The card the callable would have read, and the switch, both written with the rules
 * disabled — which is the only way either could have been written at all, and is
 * itself part of what is being asserted: a Guest cannot seed a friendlier price list,
 * and cannot flip the switch that exempts them from checking it.
 */
let quoteCounter = 0
const unique = (prefix: string) => `${prefix}-${++quoteCounter}`

async function seed(options: { quotesRequired?: boolean; rate?: number } = {}) {
  await env.clearFirestore()
  quoteCounter = 0
  const rate = options.rate ?? RATE
  const due = Math.floor((rate * 50)) / 100
  await env.withSecurityRulesDisabled(async (owner: RulesTestContext) => {
    await setDoc(doc(owner.firestore(), 'site_config', 'rates'), {
      version: 'emulator-quotes-v1',
      effective_date: '2026-10-01',
      holiday_dates: [],
      accommodations: {
        'main-house': {
          property_name: 'The Main House', rate_unit: 'standard_stay', active: true,
          security_deposit: 500, down_payment_percent: 50, available_units: 1,
          guest_pricing: {
            units_per_booking: 1,
            weekday: { min_guests: 1, base_max_guests: 10, base_rate: rate, excess_per_guest: 500 },
            weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: rate + 1000, excess_per_guest: 500 },
          },
        },
      },
    })
    if (options.quotesRequired !== undefined) {
      await setDoc(doc(owner.firestore(), 'site_config', 'booking'), { quotes_required: options.quotesRequired })
    }
    await setDoc(doc(owner.firestore(), 'profiles', GUEST_UID), { uid: GUEST_UID, role: 'guest' })
  })
  return { rate, due }
}

const timestamp = (iso: string) => Timestamp.fromDate(new Date(iso))

/** A minted attestation, exactly as the callable writes it. */
function attestation(overrides: Record<string, unknown> = {}) {
  return {
    accommodation: 'main-house', check_in: '2026-10-31', check_out: '2026-11-01', guests: 10,
    pet_count: 0, late_checkout_hours: 0, rate_unit: 'standard_stay', rate_amount: RATE,
    rate_classification: 'weekday', nights: 1, stay_total: TOTAL, amount_due: DUE, balance_due: DUE,
    security_deposit: 500, payment_plan: 'down-payment', policy_version: 'emulator-quotes-v1',
    policy_effective_date: '2026-10-01', rates_version: 'emulator-quotes-v1',
    refund_policy_snapshot: null, bound_uid: GUEST_UID,
    created_at: timestamp('2026-10-01T04:00:00.000Z'),
    expires_at: timestamp('2099-01-01T00:00:00.000Z'), // a fixture that does not expire mid-test
    ...overrides,
  }
}

/** A Booking with the attestation's money. The date keys are Timestamps because the
 * booking schema compares them, and the create rule requires proof + a claim. */
function booking(overrides: Record<string, unknown> = {}) {
  return {
    uid: GUEST_UID, property_id: 'main-house', accommodation: 'main-house',
    check_in: timestamp('2026-10-31T16:00:00.000Z'), check_out: timestamp('2026-11-01T10:00:00.000Z'),
    guests: 10, pets: 0, late_checkout: false, extra_late_checkout_hours: 0,
    status: 'Pending', payment_status: 'pending', payment_plan: 'down-payment',
    payment_proof_url: `payments/${GUEST_UID}/HDL/proof-1.png`,
    rate_unit: 'standard_stay', rate_amount: RATE, rate_classification: 'weekday',
    nights: 1, stay_total: TOTAL, amount_due: DUE, balance_due: DUE, security_deposit: 500,
    amount_claimed: DUE, policy_version: 'emulator-quotes-v1', policy_effective_date: '2026-10-01',
    created_at: timestamp('2026-10-01T04:00:00.000Z'),
    updated_at: timestamp('2026-10-01T04:00:00.000Z'),
    ...overrides,
  }
}

/** Write a Booking the way the estate does: with its attestation already minted. */
async function submit(ctx: RulesTestContext, data: Record<string, unknown>, quote: Record<string, unknown> = attestation()) {
  const quoteId = unique('quote')
  await env.withSecurityRulesDisabled(async (owner) => {
    await setDoc(doc(owner.firestore(), 'booking_quotes', quoteId), quote)
  })
  const bookingId = unique('booking')
  await setDoc(doc(ctx.firestore(), 'bookings', bookingId), { ...data, quote_id: quoteId })
  return { quoteId, bookingId }
}

describe('the attestation itself is off-limits to the estate it describes', () => {
  it('cannot be written, read, or deleted by a signed-in Guest', async () => {
    await seed({ quotesRequired: true })
    const guest = env.authenticatedContext(GUEST_UID, {})
    const ref = doc(guest.firestore(), 'booking_quotes', 'any-quote')
    await assertFails(setDoc(ref, attestation()), 'missing or insufficient permissions')
    await assertFails(getDoc(ref), 'missing or insufficient permissions')
    await assertFails(updateDoc(ref, { stay_total: 1 }), 'missing or insufficient permissions')
    // …and the switch that turns enforcement on is not Guest-writable either.
    await assertFails(updateDoc(doc(guest.firestore(), 'site_config', 'booking'), { quotes_required: false }), 'missing or insufficient permissions')
    await assertFails(setDoc(doc(guest.firestore(), 'site_config', 'rates'), { version: 'mine' }), 'missing or insufficient permissions')
  })

  it('is readable by an Admin, who is the only human that can see it', async () => {
    const { quoteId } = await seed({ quotesRequired: true }).then(async (s) => {
      const guest = env.authenticatedContext(GUEST_UID, {})
      return { ...(await submit(guest, booking())), ...s }
    })
    const admin = env.authenticatedContext('admin-uid-1', { email: ADMIN_EMAIL })
    await assertSucceeds(getDoc(doc(admin.firestore(), 'booking_quotes', quoteId)))
  })
})

describe('a Guest create under enforcement', () => {
  it('accepts the money the backend priced', async () => {
    await seed({ quotesRequired: true })
    const guest = env.authenticatedContext(GUEST_UID, {})
    await assertSucceeds(submit(guest, booking()).then((r) => r.quoteId))
  })

  it('refuses the same Booking with one total edited', async () => {
    await seed({ quotesRequired: true })
    const guest = env.authenticatedContext(GUEST_UID, {})
    await assertFails(
      submit(guest, booking({ stay_total: 1000, rate_amount: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500 })),
      'missing or insufficient permissions',
    )
  })

  it('refuses it when the switch is absent, because that means enforcing', async () => {
    await seed({}) // no site_config/booking document at all
    const guest = env.authenticatedContext(GUEST_UID, {})
    await assertFails(
      submit(guest, booking({ stay_total: 1000, rate_amount: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500 })),
      'missing or insufficient permissions',
    )
  })

  it('accepts the honest Booking when the switch is absent too', async () => {
    await seed({})
    const guest = env.authenticatedContext(GUEST_UID, {})
    await assertSucceeds(submit(guest, booking()).then((r) => r.quoteId))
  })

  it('refuses one Guest presenting another Guest’s attestation', async () => {
    await seed({ quotesRequired: true })
    const other = env.authenticatedContext(OTHER_GUEST_UID, {})
    await assertFails(
      submit(other, booking({ uid: OTHER_GUEST_UID, payment_proof_url: `payments/${OTHER_GUEST_UID}/HDL/proof-1.png` })),
      'missing or insufficient permissions',
    )
  })

  it('refuses an unauthenticated create with the quote id that would have worked', async () => {
    await seed({ quotesRequired: true })
    const { quoteId } = await submit(env.authenticatedContext(GUEST_UID, {}), booking())
    const anonymous = env.unauthenticatedContext()
    await assertFails(
      setDoc(doc(anonymous.firestore(), 'bookings', unique('booking')), booking({ quote_id: quoteId, uid: GUEST_UID })),
      'Missing or insufficient permissions',
    )
  })

  it('agrees with the callable to the centavo, and not one centavo further', async () => {
    // The rule floors each half of a split independently, so two halves a peso
    // price rounds down can sit one centavo apart. The window is exactly that wide,
    // and the attested figure inside it is honoured: ₱1,125.84 → ₱562.92.
    await seed({ quotesRequired: true })
    const guest = env.authenticatedContext(GUEST_UID, {})
    await assertSucceeds(
      submit(
        guest,
        booking({ stay_total: 1125.84, rate_amount: 1125.84, amount_due: 562.92, balance_due: 562.92, amount_claimed: 562.92, security_deposit: 0 }),
        attestation({ stay_total: 1125.84, rate_amount: 1125.84, amount_due: 562.92, balance_due: 562.92 }),
      ).then((r) => r.quoteId),
    )
    await assertFails(
      submit(
        guest,
        booking({ stay_total: 1125.84, rate_amount: 1125.84, amount_due: 562.91, balance_due: 562.93, amount_claimed: 562.91, security_deposit: 0 }),
        attestation({ stay_total: 1125.84, rate_amount: 1125.84, amount_due: 562.91, balance_due: 562.93 }),
      ).then((r) => r.quoteId),
      'missing or insufficient permissions',
    )
  })

  it('refuses a sub-floor total, so no attestation can ever be minted the rules cannot store', async () => {
    await seed({ quotesRequired: true })
    const guest = env.authenticatedContext(GUEST_UID, {})
    await assertFails(
      submit(
        guest,
        booking({ stay_total: 0.4, rate_amount: 0.4, amount_due: 0.2, balance_due: 0.2, amount_claimed: 0.2, security_deposit: 0 }),
        attestation({ stay_total: 0.4, rate_amount: 0.4, amount_due: 0.2, balance_due: 0.2 }),
      ).then((r) => r.quoteId),
      'missing or insufficient permissions',
    )
  })
})

describe('every other write path keeps working while enforcement is on', () => {
  it('lets an Admin finish a manual Booking whose quote id is not usable', async () => {
    // The regression the deployed rules had: `booking.quotes_required` true and a
    // Manual Booking writing `quote_id: null`. The Admin exemption must be a
    // boolean, not a lookup, and the whole clause must not blow up on a null id.
    await seed({ quotesRequired: true })
    const admin = env.authenticatedContext('admin-uid-1', { email: ADMIN_EMAIL })
    const bookingId = unique('manual')
    await assertSucceeds(
      setDoc(doc(admin.firestore(), 'bookings', bookingId), booking({
        uid: null, stay_total: 1000, rate_amount: 1000, amount_due: 500, balance_due: 500,
        amount_claimed: 500, security_deposit: 0, quote_id: null,
      })),
    )
  })

  it("lets the Guest who was quoted keep their own Booking's proof and contact details", async () => {
    await seed({ quotesRequired: true })
    const guest = env.authenticatedContext(GUEST_UID, {})
    const { bookingId } = await submit(guest, booking())
    const ref = doc(guest.firestore(), 'bookings', bookingId)
    await assertSucceeds(updateDoc(ref, { payment_proof_url: `payments/${GUEST_UID}/HDL/proof-2.png`, payment_status: 'pending' }))
    await assertSucceeds(updateDoc(ref, { phone: '0917 000 0000' }))
  })

  it('refuses the same Guest re-pricing the attested Booking', async () => {
    await seed({ quotesRequired: true })
    const guest = env.authenticatedContext(GUEST_UID, {})
    const { bookingId } = await submit(guest, booking())
    await assertFails(
      updateDoc(doc(guest.firestore(), 'bookings', bookingId), {
        stay_total: 1000, amount_due: 500, balance_due: 500, amount_claimed: 500,
        payment_status: 'pending',
      }),
      'missing or insufficient permissions',
    )
  })
})
