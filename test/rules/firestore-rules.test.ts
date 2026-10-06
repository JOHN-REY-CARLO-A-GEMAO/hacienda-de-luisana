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
import { compileRules, evaluate, ruleTimestamp, type DocData, type Store } from './engine'
import {
  ADMIN_SECURITY_NOW,
  ADMIN_UID,
  BOOKING_ID,
  CONVO_ID,
  GUEST_UID,
  OTHER_GUEST_UID,
  accessLogDoc,
  adminSecurityDoc,
  adminVerifyPatch,
  allowlistedAdmin,
  anonymousGuest,
  bookingDoc,
  conversationDoc,
  emailGuest,
  guestPaymentPatch,
  locationSessionDoc,
  DEFAULT_REVIEW_TIME,
  messageDoc,
  paidBookingDoc,
  promotedAdmin,
  publicReviewDoc,
  request,
  REVIEW_EDIT_WINDOW_MS,
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
    'site_config/rates': {
      version: 'test-v2', effective_date: '2026-09-24', holiday_dates: [],
      accommodations: {
        'main-house': {
          property_name: 'Main House', rate_unit: 'standard_stay', active: true,
          security_deposit: 500, down_payment_percent: 50,
          guest_pricing: {
            units_per_booking: 1,
            weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
            weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
          },
        },
      },
    },
    // The Booking the Review rules read through `get()`: the Guest's own, and
    // finished, which is what a Review is allowed to be about.
    [`bookings/${BOOKING_ID}`]: bookingDoc({ status: 'Completed', kyc_status: 'approved' }),
  },
)

/**
 * The rules file, parsed once.
 *
 * `evaluate` re-parses on every call, which is what a suite that rewrites the
 * rules between cases needs. This one does not, and a policy with a loop in it
 * — twenty star ratings, ten statuses — asks a dozen questions about a file it
 * has already read, so it compiles once and reuses the book. The book is
 * immutable, so nothing carries from one case to the next.
 */
const decideRules = compileRules(rules)

const allow = (partial: Parameters<typeof request>[0], store: Store = profiles) =>
  decideRules(request(partial), { store }).allow

const deny = (partial: Parameters<typeof request>[0], store: Store = profiles) =>
  decideRules(request(partial), { store }).allow === false

// ---------------------------------------------------------------------------
// Official guest-count pricing is independently recomputed by Firestore rules
// ---------------------------------------------------------------------------

/**
 * The canonical published rates document: the three Accommodations the estate
 * has, their money, and each one's physical inventory.
 *
 * Three facts that are easy to confuse and are all present here on purpose:
 *   `available_units`     units the estate holds at once — the A-House has 2
 *   `units_per_booking`  units one Booking takes — the A-House takes 1
 *   `max_guests`          guests that fit in that unit — the A-House takes 3
 */
const canonicalRatesDocument: DocData = {
  version: 'official-v2', effective_date: '2026-10-04', holiday_dates: ['2026-10-27'],
  accommodations: {
    'main-house': {
      rate_unit: 'standard_stay', active: true, security_deposit: 500,
      down_payment_percent: 50, available_units: 1,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 10, base_rate: 5000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 10, base_rate: 6000, excess_per_guest: 500 },
      },
    },
    'house-a-camping': {
      rate_unit: 'standard_stay', active: true, security_deposit: 0,
      down_payment_percent: 50, available_units: 2,
      guest_pricing: {
        units_per_booking: 1,
        // Three is both the included count and the ceiling, so the A-House is a
        // flat per-unit amount with a cap and no excess rule: there is no fourth
        // guest it could price.
        weekday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
        weekend_holiday: { min_guests: 1, base_max_guests: 3, max_guests: 3, base_rate: 1000 },
      },
    },
    annex: {
      rate_unit: 'standard_stay', active: true, security_deposit: 500,
      down_payment_percent: 50, available_units: 1,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 6, base_rate: 4000, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 6, base_rate: 5000, excess_per_guest: 500 },
      },
    },
  },
}

describe('official guest-count rates', () => {
  const officialStore: Store = {
    ...profiles,
    'site_config/rates': structuredClone(canonicalRatesDocument),
  }

  const officialBooking = (overrides: DocData = {}) => {
    const booking = bookingDoc({
      check_in: '2026-10-26', check_out: '2026-10-27', nights: 1, guests: 10,
      rate_amount: 5000, rate_unit: 'standard_stay', rate_classification: 'weekday', stay_total: 5000,
      payment_plan: 'down-payment', amount_due: 2500, balance_due: 2500,
      amount_claimed: 2500, payment_status: 'pending', payment_proof_url: 'payments/guest-uid-1/proof.jpg',
      policy_version: 'official-v2', policy_effective_date: '2026-10-04',
      ...overrides,
    })
    if (!Object.prototype.hasOwnProperty.call(overrides, 'amount_claimed')) {
      booking.amount_claimed = booking.amount_due
    }
    return booking
  }

  it('classifies Monday–Thursday as weekday, Friday/Saturday as weekend, and Sunday check-in as weekday', () => {
    expect(allow({ path: 'bookings/official-weekday', method: 'create', auth: anonymousGuest(), requestData: officialBooking() }, officialStore)).toBe(true)
    expect(allow({ path: 'bookings/official-friday', method: 'create', auth: anonymousGuest(), requestData: officialBooking({
      check_in: '2026-10-30', check_out: '2026-10-31', guests: 10, rate_amount: 6000,
      rate_classification: 'weekend_holiday', stay_total: 6000, amount_due: 3000, balance_due: 3000,
    }) }, officialStore)).toBe(true)
    expect(allow({ path: 'bookings/official-saturday', method: 'create', auth: anonymousGuest(), requestData: officialBooking({
      check_in: '2026-10-31', check_out: '2026-11-01', guests: 10, rate_amount: 6000,
      rate_classification: 'weekend_holiday', stay_total: 6000, amount_due: 3000, balance_due: 3000,
    }) }, officialStore)).toBe(true)
    expect(allow({ path: 'bookings/official-sunday', method: 'create', auth: anonymousGuest(), requestData: officialBooking({
      check_in: '2026-11-01', check_out: '2026-11-02', guests: 10, rate_amount: 5000,
      rate_classification: 'weekday', stay_total: 5000, amount_due: 2500, balance_due: 2500,
    }) }, officialStore)).toBe(true)
    expect(allow({ path: 'bookings/official-holiday', method: 'create', auth: anonymousGuest(), requestData: officialBooking({
      check_in: '2026-10-27', check_out: '2026-10-28', rate_amount: 6000,
      rate_classification: 'weekend_holiday', stay_total: 6000, amount_due: 3000, balance_due: 3000,
    }) }, officialStore)).toBe(true)
  })

  it('computes included occupancy and linear excess without a Main House cap', () => {
    expect(allow({ path: 'bookings/official-included', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ guests: 5 }) }, officialStore)).toBe(true)
    expect(allow({ path: 'bookings/official-excess-one', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ guests: 11, rate_amount: 5500, stay_total: 5500, amount_due: 2750, balance_due: 2750 }) }, officialStore)).toBe(true)
    expect(allow({ path: 'bookings/official-excess-four', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ guests: 14, rate_amount: 7000, stay_total: 7000, amount_due: 3500, balance_due: 3500 }) }, officialStore)).toBe(true)
    expect(allow({ path: 'bookings/official-no-base-cap', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ guests: 25, rate_amount: 12500, stay_total: 12500, amount_due: 6250, balance_due: 6250 }) }, officialStore)).toBe(true)
  })

  it('adds the published pet fee to the stay total and the 50/50 split', () => {
    // The rates document publishes a ₱300 per-pet fee; the store the rules read
    // carries it. A Booking with no pets is unaffected by its presence.
    const withPets = structuredClone(officialStore)
    withPets['site_config/rates'].pet_policy = { fee_per_pet: 300, max_pets: 5 }

    // No pets declared: the stay is the published rate and nothing else.
    expect(allow({
      path: 'bookings/official-no-pets', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({ pet_count: 0 }),
    }, withPets)).toBe(true)

    // One pet: ₱300 on top of ₱5,000, so the down payment is on ₱5,300.
    expect(allow({
      path: 'bookings/official-one-pet', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        pet_count: 1, rate_amount: 5000, stay_total: 5300, amount_due: 2650, balance_due: 2650,
      }),
    }, withPets)).toBe(true)

    // Two pets: the fee is per pet, so ₱600.
    expect(allow({
      path: 'bookings/official-two-pets', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        pet_count: 2, rate_amount: 5000, stay_total: 5600, amount_due: 2800, balance_due: 2800,
      }),
    }, withPets)).toBe(true)

    // The fee cannot be skipped by declaring no pets while pricing one in.
    expect(deny({
      path: 'bookings/official-pet-underreported', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({ pet_count: 0, stay_total: 5300, amount_due: 2650, balance_due: 2650 }),
    }, withPets)).toBe(true)

    // Nor can it be quietly left out of the stay total.
    expect(deny({
      path: 'bookings/official-pet-not-charged', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        pet_count: 1, rate_amount: 5000, stay_total: 5000, amount_due: 2500, balance_due: 2500,
      }),
    }, withPets)).toBe(true)

    // A pet with no published fee is not a guest's to price: refused.
    expect(deny({
      path: 'bookings/official-pet-unpriced', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({ pet_count: 1, stay_total: 5300, amount_due: 2650, balance_due: 2650 }),
    }, officialStore)).toBe(true)

    // Past the published cap is refused however it is priced.
    expect(deny({
      path: 'bookings/official-pet-over-cap', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        pet_count: 6, rate_amount: 5000, stay_total: 6800, amount_due: 3400, balance_due: 3400,
      }),
    }, withPets)).toBe(true)
  })

  it('adds the published late-checkout rate to the stay total', () => {
    const withExtension = structuredClone(officialStore)
    withExtension['site_config/rates'].late_checkout_per_hour = 250

    // Two hours past noon: ₱500 on top of ₱5,000.
    expect(allow({
      path: 'bookings/official-two-hours', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        late_checkout_hours: 2, rate_amount: 5000, stay_total: 5500, amount_due: 2750, balance_due: 2750,
      }),
    }, withExtension)).toBe(true)

    // The hour cannot be kept for free by leaving it out of the total.
    expect(deny({
      path: 'bookings/official-hours-unpaid', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        late_checkout_hours: 2, rate_amount: 5000, stay_total: 5000, amount_due: 2500, balance_due: 2500,
      }),
    }, withExtension)).toBe(true)

    // An extension with no published hourly rate is refused.
    expect(deny({
      path: 'bookings/official-hours-unpriced', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        late_checkout_hours: 2, stay_total: 5500, amount_due: 2750, balance_due: 2750,
      }),
    }, officialStore)).toBe(true)

    // Pet fee and late checkout together, each on the published rate.
    const combined = structuredClone(officialStore)
    combined['site_config/rates'].pet_policy = { fee_per_pet: 300 }
    combined['site_config/rates'].late_checkout_per_hour = 250
    expect(allow({
      path: 'bookings/official-pet-and-hours', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({
        pet_count: 1, late_checkout_hours: 2, rate_amount: 5000,
        stay_total: 5800, amount_due: 2900, balance_due: 2900,
      }),
    }, combined)).toBe(true)
  })

  it('validates one A-House unit for up to three guests at a flat per-unit rate', () => {
    // Three guests at the base rate, which is also the cap.
    expect(allow({ path: 'bookings/official-a-house', method: 'create', auth: anonymousGuest(), requestData: officialBooking({
      accommodation: 'house-a-camping', guests: 3, rate_amount: 1000, rate_classification: 'weekday',
      rate_unit: 'standard_stay', stay_total: 1000, amount_due: 500, security_deposit: 0, balance_due: 500,
    }) }, officialStore)).toBe(true)
    // A fourth is past the documented limit: the unit cannot hold it, so the
    // Booking is refused whatever the guest claims to have paid for it.
    expect(deny({ path: 'bookings/official-a-house-fourth', method: 'create', auth: anonymousGuest(), requestData: officialBooking({
      accommodation: 'house-a-camping', guests: 4, rate_amount: 1500, rate_classification: 'weekday',
      rate_unit: 'standard_stay', stay_total: 1500, amount_due: 750, security_deposit: 0, balance_due: 750,
    }) }, officialStore)).toBe(true)
    // Nor can a fifth.
    expect(deny({ path: 'bookings/official-a-house-over-cap', method: 'create', auth: anonymousGuest(), requestData: officialBooking({
      accommodation: 'house-a-camping', guests: 5, rate_amount: 2000, rate_classification: 'weekday',
      rate_unit: 'standard_stay', stay_total: 2000, amount_due: 1000, security_deposit: 0, balance_due: 1000,
    }) }, officialStore)).toBe(true)
  })

  // The A-House occupancy is published from the Admin app and also typed by hand
  // into the Firebase console, and a console edit lands without ever passing
  // through `validatePublishedRates`. So the shape the rules actually meet is not
  // guaranteed to be the documented one, and the rules have to fail closed on the
  // difference: a Guest asking for an ordinary three-guest stay is refused,
  // because a schedule the rules cannot price is not one a Guest may book against.
  //
  // Each shape below is a drift that reached the live document at least once.
  // None of them is a question about the guest count, so none of them may be
  // answered by refusing only the larger bookings: every one has to refuse the
  // smallest one too. One `it` per drift, so a weakened rule names the drift it
  // let through instead of only the first.
  describe('an A-House schedule that drifts from the documented occupancy', () => {
    const documented = { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 3 }

    // The smallest stay the A-House sells: three guests, no pets, no extension,
    // weekday. Nothing about it is contentious, so a refusal can only come from
    // the published shape.
    const threeGuestStay = officialBooking({
      accommodation: 'house-a-camping', guests: 3, rate_amount: 1000, rate_classification: 'weekday',
      rate_unit: 'standard_stay', stay_total: 1000, amount_due: 500, security_deposit: 0, balance_due: 500,
    })

    // Replaces one schedule of the A-House and leaves every other field alone, so
    // the shape is the only variable.
    const drifted = (patch: DocData, which: 'weekday' | 'weekend_holiday' = 'weekday'): Store => {
      const store = structuredClone(officialStore)
      const rates = store['site_config/rates']! as DocData
      const house = (rates.accommodations as DocData)['house-a-camping'] as DocData
      const pricing = house.guest_pricing as DocData
      pricing[which] = patch
      return store
    }

    const stay = (id: string) =>
      allow({ path: `bookings/${id}`, method: 'create', auth: anonymousGuest(), requestData: threeGuestStay },
        drifted({ ...documented }))
    const refuse = (id: string, patch: DocData, which: 'weekday' | 'weekend_holiday' = 'weekday') =>
      deny({ path: `bookings/${id}`, method: 'create', auth: anonymousGuest(), requestData: threeGuestStay },
        drifted(patch, which))

    // The control. Without it a refusal below could be the fixture's doing.
    it('admits the three-guest stay on the documented shape', () => {
      expect(stay('ahouse-documented')).toBe(true)
    })

    // The cap pulled down below the included occupancy, so the third guest would
    // be refused by `scheduledRate`. The shape is not the documented one, so the
    // whole schedule is.
    it('refuses a cap pulled below the included occupancy', () => {
      expect(refuse('ahouse-cap-lowered', { ...documented, max_guests: 2 })).toBe(true)
    })

    // The cap stretched to admit a fourth guest the unit cannot hold, together
    // with the excess rule that would price it. This is the pair
    // `validAHouseSchedule` exists to refuse.
    it('refuses a cap and excess rule that admit a fourth guest', () => {
      expect(refuse('ahouse-fourth-allowed', {
        min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 4, excess_per_guest: 500,
      })).toBe(true)
    })

    // An excess rule on a cap that already equals the included count: it prices a
    // guest the unit cannot take, so nothing can ever charge it.
    it('refuses an excess rule on the flat per-unit rate', () => {
      expect(refuse('ahouse-excess-on-flat', { ...documented, excess_per_guest: 500 })).toBe(true)
    })

    // The base occupancy stretched up to the cap: the cap stops meaning anything
    // and the fourth guest becomes free rather than ₱500.
    it('refuses a base occupancy stretched past three', () => {
      expect(refuse('ahouse-base-stretched', { ...documented, base_max_guests: 4 })).toBe(true)
    })

    // One schedule corrected and the other left behind. Both are priced on a
    // booking, so both are checked: a weekday stay is refused over a drifted
    // weekend schedule, which is how a half-finished console edit hides.
    it('refuses a stay when only the other schedule has drifted', () => {
      expect(refuse('ahouse-weekend-behind', { min_guests: 1, base_max_guests: 3, base_rate: 1000, max_guests: 4 }, 'weekend_holiday')).toBe(true)
    })
  })

  it('rejects manipulated totals, invalid counts and multi-stays', () => {
    expect(deny({ path: 'bookings/official-tampered', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ stay_total: 1 }) }, officialStore)).toBe(true)
    expect(deny({ path: 'bookings/official-count', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ guests: 0 }) }, officialStore)).toBe(true)
    expect(deny({ path: 'bookings/official-multi', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ check_out: '2026-10-28', nights: 2 }) }, officialStore)).toBe(true)
    expect(deny({ path: 'bookings/official-wrong-class', method: 'create', auth: anonymousGuest(), requestData: officialBooking({ rate_classification: 'weekend_holiday' }) }, officialStore)).toBe(true)
  })

  it('fails closed for retired flat/fixed-fee rates and missing holiday configuration', () => {
    const withFee = structuredClone(officialStore)
    ;((withFee['site_config/rates'].accommodations as DocData)['main-house'] as DocData).reservation_fee_amount = 750
    expect(deny({ path: 'bookings/official-fixed-fee', method: 'create', auth: anonymousGuest(), requestData: officialBooking() }, withFee)).toBe(true)
    const withNightly = structuredClone(officialStore)
    ;((withNightly['site_config/rates'].accommodations as DocData)['main-house'] as DocData).nightly_rate = 5000
    expect(deny({ path: 'bookings/official-flat-rate', method: 'create', auth: anonymousGuest(), requestData: officialBooking() }, withNightly)).toBe(true)
    const noHolidayList = structuredClone(officialStore)
    delete noHolidayList['site_config/rates'].holiday_dates
    expect(deny({ path: 'bookings/official-missing-holidays', method: 'create', auth: anonymousGuest(), requestData: officialBooking() }, noHolidayList)).toBe(true)
  })

  it('captures the exact published refund policy and rejects a guest-edited copy', () => {
    const refund = {
      refund_percent: 50,
      deposit_refund_percent: 100,
      tiers: [{ min_days_before_check_in: 7, refund_percent: 75 }],
    }
    const withRefund = structuredClone(officialStore)
    withRefund['site_config/rates'].refund = refund
    expect(allow({
      path: 'bookings/official-refund-snapshot', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({ refund_policy_snapshot: refund }),
    }, withRefund)).toBe(true)
    expect(deny({
      path: 'bookings/official-refund-tampered', method: 'create', auth: anonymousGuest(),
      requestData: officialBooking({ refund_policy_snapshot: { ...refund, refund_percent: 100 } }),
    }, withRefund)).toBe(true)
  })

  it('keeps an existing booking rate, classification, policy and money snapshot immutable', () => {
    const original = officialBooking({
      status: 'Payment Pending',
      refund_policy_snapshot: { refund_percent: 50, deposit_refund_percent: 100 },
    })
    expect(deny({ path: 'bookings/historical-total', method: 'update', auth: allowlistedAdmin(), resourceData: original, requestData: { ...original, stay_total: 9999 } }, officialStore)).toBe(true)
    expect(deny({ path: 'bookings/historical-rate', method: 'update', auth: allowlistedAdmin(), resourceData: original, requestData: { ...original, rate_amount: 9999 } }, officialStore)).toBe(true)
    expect(deny({ path: 'bookings/historical-classification', method: 'update', auth: allowlistedAdmin(), resourceData: original, requestData: { ...original, rate_classification: 'weekend_holiday' } }, officialStore)).toBe(true)
    expect(deny({ path: 'bookings/historical-refund-policy', method: 'update', auth: allowlistedAdmin(), resourceData: original, requestData: { ...original, refund_policy_snapshot: { refund_percent: 100 } } }, officialStore)).toBe(true)
  })
})

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
        amount_claimed: 8500,
      }),
    })).toBe(true)
  })

  it.each(['rate_amount', 'rate_unit', 'rate_classification', 'stay_total', 'amount_due', 'security_deposit', 'balance_due'])(
    'refuses a Guest-created Booking with manipulated %s',
    (field) => {
      expect(deny({
        path: 'bookings/manipulated-money',
        method: 'create',
        auth: anonymousGuest(),
        requestData: bookingDoc({
          payment_status: 'pending',
          payment_proof_url: 'payments/guest-uid-1/proof.jpg',
          amount_claimed: 8500,
          [field]: 0,
        }),
      })).toBe(true)
    },
  )

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
// admin_security — the Security PIN's server copy (ADR-0015)
// ---------------------------------------------------------------------------

describe('admin_security: the PIN the app checks sensitive actions against', () => {
  const at = ADMIN_SECURITY_NOW
  const doc = adminSecurityDoc()
  const own = allowlistedAdmin()
  const ownPath = `admin_security/${ADMIN_UID}`

  const update = (resourceData: DocData, requestData: DocData, auth = own) =>
    deny({ path: ownPath, method: 'update', auth, resourceData, requestData, time: at })
      ? 'denied'
      : 'allowed'

  it('lets an Admin read their own record, and nobody else read it', () => {
    expect(allow({ path: ownPath, method: 'get', auth: own, resourceData: doc })).toBe(true)
    expect(deny({ path: ownPath, method: 'get', auth: promotedAdmin(), resourceData: doc })).toBe(true)
    expect(deny({ path: ownPath, method: 'get', auth: anonymousGuest(), resourceData: doc })).toBe(true)
    expect(deny({ path: ownPath, method: 'get', auth: emailGuest(), resourceData: doc })).toBe(true)
    expect(deny({ path: ownPath, method: 'get', auth: null, resourceData: doc })).toBe(true)
  })

  it('gives an Admin no write on another Admin\'s record', () => {
    const other = promotedAdmin()
    expect(deny({
      path: ownPath, method: 'update', auth: other,
      resourceData: doc, requestData: adminSecurityDoc({ failed_attempts: 1 }), time: at,
    })).toBe(true)
    // Their own first setup is fine.
    expect(allow({
      path: `admin_security/${other.uid}`, method: 'create', auth: other,
      requestData: adminSecurityDoc({ uid: other.uid, pin_updated_by: other.uid }), time: at,
    })).toBe(true)
  })

  // ADR-0015 said "never deletable — a lockout record is evidence". ADR-0016
  // reverses that for one door: the Admin's own signed-in session may dispose of
  // the record after 24 h, which is what lets a locked-out operator out. The
  // name of this case changed with it; the case itself still denies, because the
  // fixture's stamp is `request.time` and the cooldown has not passed.
  it('refuses a delete inside the 24 h cooldown', () => {
    expect(deny({ path: ownPath, method: 'delete', auth: own, resourceData: doc, time: at })).toBe(true)
  })

  // -------------------------------------------------------------------------
  // delete door 3 — the forgotten-PIN reset (ADR-0016)
  // -------------------------------------------------------------------------

  describe('delete door 3 — the Admin may dispose of their own record', () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const stamp = ADMIN_SECURITY_NOW
    /** The record as it stands when the stamp is `stamp`. */
    const stale = (overrides: DocData = {}) => adminSecurityDoc(overrides, stamp)

    const drop = (
      auth: Parameters<typeof request>[0]['auth'],
      ms: number,
      resourceData: DocData,
    ) => deny({ path: ownPath, method: 'delete', auth, resourceData, time: stamp + ms })

    it('allows it once 24 h have passed since the stamp', () => {
      // Strictly after: at exactly 24 h the comparison is still false, which is
      // the same edge the ratchet takes everywhere else — never equal, only
      // later. Verified against the engine, not assumed.
      expect(drop(own, DAY_MS, stale())).toBe(true)
      expect(drop(own, DAY_MS + 1, stale())).toBe(false)
    })

    it('refuses it a millisecond early', () => {
      expect(drop(own, DAY_MS - 1, stale())).toBe(true)
      expect(drop(own, 0, stale())).toBe(true)
    })

    it('refuses it before any time has passed at all', () => {
      // The fixture's stamp is `request.time`, so this is "just rotated".
      expect(drop(own, 0, stale())).toBe(true)
      expect(drop(own, 1000, stale())).toBe(true)
    })

    it.each([
      ['a Guest who is signed in', () => anonymousGuest()],
      ['a Guest by email', () => emailGuest()],
      ['somebody signed out', () => null],
    ])('refuses %s', (_name, who) => {
      expect(drop(who(), DAY_MS + 1, stale())).toBe(true)
    })

    it("refuses another Admin, including one promoted in Firestore", () => {
      expect(drop(promotedAdmin(), DAY_MS + 1, stale())).toBe(true)
    })

    it('refuses a record with no usable stamp', () => {
      // The rules refuse a stamp that is not a timestamp, so the cooldown cannot
      // be read and the record cannot be cleared — this cannot become a way to
      // dispose of a malformed document.
      const unstamped = adminSecurityDoc()
      delete (unstamped as Record<string, unknown>).pin_updated_at
      expect(drop(own, DAY_MS + 1, unstamped)).toBe(true)

      const stringy = adminSecurityDoc({ pin_updated_at: '2026-09-24T00:00:00Z' })
      expect(drop(own, DAY_MS + 1, stringy)).toBe(true)
    })

    it('ignores a live lockout — refusing one would restore the dead end', () => {
      // The deliberate exception, stated as a case so it cannot be lost: a
      // locked Admin can still get out, because the 24 h stamp is the brake
      // that replaces the lock check.
      const locked = stale({
        failed_attempts: 9,
        locked_until: ruleTimestamp(stamp + DAY_MS + 60_000),
      })
      expect(drop(own, DAY_MS + 1, locked)).toBe(false)
    })

    it('a raised counter does not bring the cooldown forward', () => {
      // `failed_attempts` is not the stamp, and guessing must not move it.
      expect(drop(own, DAY_MS - 1, stale({ failed_attempts: 9 }))).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // admin_security_events — the append-only trail of a PIN reset (ADR-0016)
  // ---------------------------------------------------------------------------

  describe('admin_security_events: evidence that outlives the record', () => {
    const at2 = ADMIN_SECURITY_NOW
    const own2 = allowlistedAdmin()
    const path = 'admin_security_events/pin-reset-1'
    const line = (overrides: DocData = {}): DocData => ({
      uid: ADMIN_UID,
      action: 'PinReset',
      at: ruleTimestamp(at2),
      ...overrides,
    })

    it('accepts the Admin\'s own line, server-stamped now', () => {
      expect(allow({ path, method: 'create', auth: own2, requestData: line(), time: at2 })).toBe(true)
    })

    it('lets any Admin read the trail, and no Guest', () => {
      expect(allow({ path, method: 'get', auth: own2, resourceData: line() })).toBe(true)
      expect(allow({ path, method: 'get', auth: promotedAdmin(), resourceData: line() })).toBe(true)
      expect(deny({ path, method: 'get', auth: anonymousGuest(), resourceData: line() })).toBe(true)
      expect(deny({ path, method: 'get', auth: null, resourceData: line() })).toBe(true)
    })

    it('refuses a line naming somebody else', () => {
      const other = promotedAdmin()
      expect(deny({
        path, method: 'create', auth: other,
        requestData: line({ uid: ADMIN_UID }), time: at2,
      })).toBe(true)
    })

    it.each([
      ['a Guest', () => anonymousGuest()],
      ['a Guest by email', () => emailGuest()],
      ['somebody signed out', () => null],
    ])('refuses a line from %s', (_name, who) => {
      expect(deny({ path, method: 'create', auth: who(), requestData: line(), time: at2 })).toBe(true)
    })

    it.each([
      ['an unknown action', line({ action: 'PinDeleted' })],
      ['an action from the Booking vocabulary', line({ action: 'Submit' })],
      ['an extra key', line({ note: 'anything' })],
      ['a missing key', (() => { const l = line(); delete (l as Record<string, unknown>).action; return l })()],
      ['a uid that is not a string', line({ uid: 7 })],
    ])('refuses %s', (_name, bad: DocData) => {
      expect(deny({ path, method: 'create', auth: own2, requestData: bad, time: at2 })).toBe(true)
    })

    it('refuses a timestamp the writer chose', () => {
      // `at` must equal `request.time`, so the line cannot claim to have been
      // filed at a moment of the writer's picking.
      expect(deny({
        path, method: 'create', auth: own2,
        requestData: line({ at: ruleTimestamp(at2 - 86_400_000) }), time: at2,
      })).toBe(true)
    })

    it('is append-only: no update, no delete, for anybody', () => {
      for (const auth of [own2, promotedAdmin(), anonymousGuest(), null]) {
        expect(deny({ path, method: 'update', auth, resourceData: line(), requestData: line({ action: 'PinReset' }) })).toBe(true)
        expect(deny({ path, method: 'update', auth, resourceData: line(), requestData: line({ action: 'Nope' }) })).toBe(true)
        expect(deny({ path, method: 'delete', auth, resourceData: line() })).toBe(true)
      }
    })
  })

  describe('the create', () => {
    it('accepts the Admin\'s own first setup, counters born zero', () => {
      expect(allow({ path: ownPath, method: 'create', auth: own, requestData: doc, time: at })).toBe(true)
    })

    it.each([
      ['a counter that is not born zero', adminSecurityDoc({ failed_attempts: 3 })],
      ['a pre-set lockout', adminSecurityDoc({ locked_until: ruleTimestamp(at + 30_000) })],
      ['an extra key', adminSecurityDoc({ pin_proof: 'nope' })],
      ['a missing key', (() => { const d = adminSecurityDoc(); delete d.pin_updated_by; return d })()],
      ['too few rounds', adminSecurityDoc({ iterations: 100 })],
      ['a short hash', adminSecurityDoc({ pin_hash: 'short' })],
      ['a short salt', adminSecurityDoc({ salt: 'c2FsdA==' })],
      ['somebody else\'s stamp', adminSecurityDoc({ pin_updated_by: 'promoted-admin-1' })],
    ])('refuses %s', (_name, bad) => {
      expect(deny({ path: ownPath, method: 'create', auth: own, requestData: bad, time: at })).toBe(true)
    })
  })

  describe('update door 1 — the counters, forward only', () => {
    it('records a failure', () => {
      expect(update(doc, adminSecurityDoc({ failed_attempts: 1 }))).toBe('allowed')
    })

    it('starts the ladder at five, with a lockout', () => {
      expect(update(
        adminSecurityDoc({ failed_attempts: 4 }),
        adminSecurityDoc({ failed_attempts: 5, locked_until: ruleTimestamp(at + 30_000) }),
      )).toBe('allowed')
    })

    it('refuses to lower the counter', () => {
      expect(update(
        adminSecurityDoc({ failed_attempts: 6, locked_until: ruleTimestamp(at - 60_000) }),
        adminSecurityDoc({ failed_attempts: 5 }),
      )).toBe('denied')
    })

    it('refuses to clear a live lock, even with the counter unchanged', () => {
      expect(update(
        adminSecurityDoc({ failed_attempts: 6, locked_until: ruleTimestamp(at + 30_000) }),
        adminSecurityDoc({ failed_attempts: 6 }),
      )).toBe('denied')
    })

    it('lets a lock be pushed later, and an expired one be cleared', () => {
      expect(update(
        adminSecurityDoc({ failed_attempts: 7, locked_until: ruleTimestamp(at + 30_000) }),
        adminSecurityDoc({ failed_attempts: 8, locked_until: ruleTimestamp(at + 300_000) }),
      )).toBe('allowed')
      expect(update(
        adminSecurityDoc({ failed_attempts: 6, locked_until: ruleTimestamp(at - 30_000) }),
        adminSecurityDoc({ failed_attempts: 6 }),
      )).toBe('allowed')
    })

    it('refuses a counter update that reaches for the pin fields', () => {
      expect(update(
        doc,
        adminSecurityDoc({
          failed_attempts: 1,
          pin_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        }),
      )).toBe('denied')
    })
  })

  describe('update door 2 — the rotation', () => {
    const rotated = (overrides: DocData = {}) =>
      adminSecurityDoc({
        pin_hash: 'WFlaWFlaWFlaWFlaWFlaWFlaWFlaWFlaWFlaWFlaWFla',
        pin_updated_at: ruleTimestamp(at),
        pin_updated_by: ADMIN_UID,
        ...overrides,
      })

    it('accepts a real rotation, stamped now by the writer, counters zero', () => {
      expect(update(doc, rotated())).toBe('allowed')
    })

    it('refuses a rotation with a stale or mis-attributed stamp', () => {
      expect(update(doc, rotated({ pin_updated_at: ruleTimestamp(at - 5_000) }))).toBe('denied')
      expect(update(doc, rotated({ pin_updated_by: 'promoted-admin-1' }))).toBe('denied')
    })

    it('refuses a rotation that keeps the old hash', () => {
      expect(update(doc, rotated({ pin_hash: doc.pin_hash as string }))).toBe('denied')
    })

    it('refuses a rotation out of a live lock, and accepts one past it', () => {
      const locked = adminSecurityDoc({ failed_attempts: 6, locked_until: ruleTimestamp(at + 30_000) })
      expect(update(locked, rotated())).toBe('denied')
      const expired = adminSecurityDoc({ failed_attempts: 6, locked_until: ruleTimestamp(at - 30_000) })
      expect(update(expired, rotated())).toBe('allowed')
    })
  })

  it('refuses a Guest all of it — the collection does not exist for them', () => {
    expect(deny({ path: ownPath, method: 'create', auth: anonymousGuest(), requestData: doc, time: at })).toBe(true)
    expect(deny({
      path: ownPath, method: 'update', auth: anonymousGuest(),
      resourceData: doc, requestData: adminSecurityDoc({ failed_attempts: 1 }), time: at,
    })).toBe(true)
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
        amount_claimed: 8500,
      }),
      requestData: bookingDoc({
        status: 'Approved',
        payment_proof_url: 'payments/guest-uid-1/proof.jpg',
        payment_status: 'verified',
        amount_claimed: 8500,
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

  it('accepts every name the two apps write, and refuses anything else', () => {
    // The lifecycle's own vocabulary, spelled identically by `actions.ts` and
    // `booking_lifecycle.dart`…
    const lifecycle = [
      'Submit', 'Approve', 'Reject', 'ChoosePaymentPlan', 'UploadPaymentProof',
      'VerifyPayment', 'RejectPaymentProof', 'MarkRefunded', 'RevokeKey',
      'Cancel', 'Expire', 'CheckIn', 'BeginStay', 'CheckOut', 'Complete', 'SetStatus',
    ]
    // …and the five a Review adds (ADR-0014).
    const review = ['ReviewSubmitted', 'ReviewUpdated', 'AdminReviewResponded', 'ReviewModerated', 'ReviewPublished']
    for (const action of [...lifecycle, ...review]) {
      expect(
        allow({ path: `bookings/${BOOKING_ID}/activity/${action}`, method: 'create', auth: allowlistedAdmin(), requestData: { ...entry('admin', ADMIN_UID), action } }),
        action,
      ).toBe(true)
    }
  })

  it('refuses an entry naming something the system has no such act for', () => {
    // A Guest may file an entry into their own Booking and no further. The
    // actor checks stop them signing the Admin's name; this stops them writing
    // "Payment proof verified — Booking Reserved" in their own name, which is a
    // lie in the one log the Admin reads.
    for (const action of ['VerifyPaymentVerified', 'AdminApproved', 'Refunded', 'deleted', '']) {
      expect(
        deny({ path: `bookings/${BOOKING_ID}/activity/entry-x`, method: 'create', auth: emailGuest(), requestData: { ...entry('guest', GUEST_UID), action } }),
        action,
      ).toBe(true)
    }
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
  }, 15_000)

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

  it('lets a historical unclassified Booking choose a plan from its saved total without repricing it', () => {
    const original = bookingDoc({
      status: 'Payment Pending', payment_status: 'unpaid',
      check_in: '2026-10-24', check_out: '2026-10-26', nights: 2,
      rate_amount: 4250, rate_unit: 'night', stay_total: 8500,
      security_deposit: 500, policy_version: 'historic-v1', policy_effective_date: '2026-08-01',
      refund_policy_snapshot: { refund_percent: 100, deposit_refund_percent: 100 },
    })
    delete original.rate_classification
    delete original.payment_plan
    delete original.amount_due
    delete original.balance_due
    const chosen = {
      ...original,
      payment_plan: 'down-payment',
      payment_status: 'pending',
      amount_due: 4250,
      balance_due: 4250,
    }
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: chosen })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: { ...chosen, amount_due: 1 } })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: { ...chosen, stay_total: 9000, amount_due: 4500, balance_due: 4500 } })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: { ...chosen, rate_classification: 'weekday' } })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: { ...chosen, refund_policy_snapshot: null } })).toBe(true)
  })

  it('recovers an absent legacy total only from the saved nightly rate and stay length', () => {
    const original = bookingDoc({
      status: 'Payment Pending', payment_status: 'unpaid',
      check_in: '2026-10-24', check_out: '2026-10-26', nights: 2,
      rate_amount: 4250, rate_unit: 'night', security_deposit: 500,
    })
    delete original.rate_classification
    delete original.payment_plan
    delete original.amount_due
    delete original.balance_due
    delete original.stay_total
    const chosen = {
      ...original,
      payment_plan: 'down-payment',
      payment_status: 'pending',
      stay_total: 8500,
      amount_due: 4250,
      balance_due: 4250,
    }
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: chosen })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: { ...chosen, stay_total: 9999, amount_due: 4999, balance_due: 5000 } })).toBe(true)
  })

  it('recovers a legacy camel-case totalAmount without consulting current rates', () => {
    const original = bookingDoc({
      status: 'Payment Pending', payment_status: 'unpaid',
      check_in: '2026-10-24', check_out: '2026-10-26', nights: 2,
      totalAmount: 8500, security_deposit: 500,
    })
    delete original.rate_classification
    delete original.payment_plan
    delete original.amount_due
    delete original.balance_due
    delete original.stay_total
    delete original.rate_amount
    delete original.rate_unit
    const chosen = {
      ...original,
      payment_plan: 'down-payment',
      payment_status: 'pending',
      stay_total: 8500,
      amount_due: 4250,
      balance_due: 4250,
    }
    expect(allow({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: chosen })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: emailGuest(), resourceData: original, requestData: { ...chosen, stay_total: 9000, amount_due: 4500, balance_due: 4500 } })).toBe(true)
    expect(deny({ path: `bookings/${BOOKING_ID}`, method: 'update', auth: allowlistedAdmin(), resourceData: original, requestData: { ...original, totalAmount: 9000 } })).toBe(true)
  })

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
          amount_claimed: 8500,
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
  // Guest's own and finished — which is what the rule reads. Every case that
  // writes a Review passes `time`, because the create stamps the edit window
  // from the clock and the fixture has to say the same instant the rule reads.
  const path = `reviews/${BOOKING_ID}`
  const at = DEFAULT_REVIEW_TIME
  const /** a create as the app sends it */ create = (overrides: DocData = {}, auth = emailGuest(), time = at) =>
    allow({ path, method: 'create', auth, requestData: reviewDoc(overrides, time), time })

  it('lets a Guest who stayed write a review of their own stay', () => {
    expect(create()).toBe(true)
    expect(allow({ path, method: 'create', auth: anonymousGuest(), requestData: reviewDoc({}, at), time: at })).toBe(true)
  })

  it('lets the Guest read their own review and the Admin read any', () => {
    // The stored Review is in the store, not only on the request: the rule asks
    // `exists()` before it reads `resource`, so a fixture that passes
    // `resourceData` alone would be answering a different question.
    const filed = storeWith({}, { [`reviews/${BOOKING_ID}`]: reviewDoc({}, at) })
    expect(allow({ path, method: 'get', auth: emailGuest(), resourceData: reviewDoc({}, at) }, filed)).toBe(true)
    expect(allow({ path, method: 'get', auth: allowlistedAdmin(), resourceData: reviewDoc({}, at) }, filed)).toBe(true)
    expect(deny({ path, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: reviewDoc({}, at) }, filed)).toBe(true)
  })

  it('answers the question the first submit asks: is there a review of this stay yet?', () => {
    // No document behind the id, and no `resource` for the uid test to read.
    // `submitReview` asks this before every write, so refusing it refuses the
    // write that was never attempted — and told the Guest Firestore had.
    expect(allow({ path, method: 'get', auth: emailGuest(), resourceData: null })).toBe(true)
    // The absence discloses nothing and belongs to nobody else: the Guest who
    // did not stay, and the signed-out visitor, are still refused.
    expect(deny({ path, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: null })).toBe(true)
    expect(deny({ path, method: 'get', auth: null, resourceData: null })).toBe(true)
    // And it opens nothing: the stay still has to be this Guest's own.
    expect(deny({ path: 'reviews/booking-nobody-stayed-in', method: 'get', auth: emailGuest(), resourceData: null })).toBe(true)
    // Once the Review is there, this Guest's read is the authorship test, not
    // this door.
    const filed = storeWith({}, { [`reviews/${BOOKING_ID}`]: reviewDoc({}, at) })
    expect(allow({ path, method: 'get', auth: emailGuest(), resourceData: reviewDoc({}, at) }, filed)).toBe(true)
    expect(deny({ path, method: 'get', auth: emailGuest(OTHER_GUEST_UID), resourceData: reviewDoc({}, at) }, filed)).toBe(true)
  })

  it('refuses a signed-out visitor a review', () => {
    expect(deny({ path, method: 'create', auth: null, requestData: reviewDoc() })).toBe(true)
  })

  it('refuses a review signed in somebody else\'s name', () => {
    expect(deny({ path, method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: reviewDoc({ uid: OTHER_GUEST_UID }, at), time: at })).toBe(true)
  })

  it('refuses a star rating outside 1..5 and a non-integer', () => {
    expect(create({ stars: 0 })).toBe(false)
    expect(create({ stars: 6 })).toBe(false)
    expect(create({ stars: '5' })).toBe(false)
    expect(create({ stars: 4.5 })).toBe(false)
    expect(create({ stars: -1 })).toBe(false)
    expect(create({ stars: 999 })).toBe(false)
    // The two ends of the range are the point of the check, so they are asked
    // for as well: a rule that refused everything would pass the six above.
    expect(create({ stars: 1 })).toBe(true)
    expect(create({ stars: 5 })).toBe(true)
  })

  it('refuses a Guest editing or deleting a review', () => {
    // The Admin removes a review; the Admin does not rewrite it either.
    expect(deny({ path, method: 'delete', auth: emailGuest(), resourceData: reviewDoc() })).toBe(true)
    expect(allow({ path, method: 'delete', auth: allowlistedAdmin(), resourceData: reviewDoc() })).toBe(true)
    // An Admin rewriting the Guest's rating to five stars is refused too —
    // hiding it is the Admin's door, rewriting it is nobody's.
    expect(
      deny({
        path,
        method: 'update',
        auth: allowlistedAdmin(),
        resourceData: reviewDoc({ stars: 2 }),
        requestData: reviewDoc({ stars: 5, status: 'published' }),
      }),
    ).toBe(true)
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
        requestData: reviewDoc({ uid: OTHER_GUEST_UID }, at),
        time: at,
      }),
    ).toBe(true)
  })

  it('refuses a review while the stay is not over, and accepts it once it is', () => {
    const forStatus = (status: string) =>
      allow(
        { path, method: 'create', auth: emailGuest(), requestData: reviewDoc({}, at), time: at },
        storeWith({}, { [`bookings/${BOOKING_ID}`]: bookingDoc({ status }) }),
      )
    for (const status of ['Pending', 'Payment Pending', 'Approved', 'Reserved', 'Checked-In', 'Staying']) {
      expect(forStatus(status), status).toBe(false)
    }
    expect(forStatus('Checked-Out')).toBe(true)
    expect(forStatus('Completed')).toBe(true)
    // A terminal branch is not a stay, and must never read as one.
    for (const status of ['Rejected', 'Cancelled', 'Expired']) {
      expect(forStatus(status), status).toBe(false)
    }
  })

  it('refuses a review of a Booking that does not exist', () => {
    expect(allow({ path: 'reviews/booking-does-not-exist', method: 'create', auth: emailGuest(), requestData: reviewDoc({ booking_id: 'booking-does-not-exist' }, at), time: at })).toBe(false)
  })

  it('refuses a second review for the same stay: the id is the Booking, so it is already taken', () => {
    // Once a Review is there, the document id is spoken for. There is no second
    // create to refuse — a second write at that id is an *update*, and the only
    // update the Guest gets is the edit window. So the second review arrives as
    // a create elsewhere, and the id is required to be the Booking it is about.
    const filed = storeWith({}, { [`reviews/${BOOKING_ID}`]: reviewDoc({}, at) })
    expect(
      allow({ path, method: 'update', auth: emailGuest(), resourceData: reviewDoc({}, at), requestData: reviewDoc({ stars: 4, text: 'A second try.' }, at), time: at }, filed),
    ).toBe(true) // …and it is the correction, not a replacement: stars move, it is the same document
    expect(
      deny({
        path: 'reviews/some-other-id',
        method: 'create',
        auth: emailGuest(),
        requestData: reviewDoc({ booking_id: 'some-other-id' }, at),
        time: at,
      }),
    ).toBe(true)
  })

  describe('the edit window', () => {
    const stored = reviewDoc()
    const edit = (overrides: DocData, time: number, auth = emailGuest()) =>
      allow({ path, method: 'update', auth, resourceData: stored, requestData: { ...stored, ...overrides }, time })

    it('lets the Guest correct their own words inside the fortnight', () => {
      expect(edit({ stars: 4 }, at + 86_400_000)).toBe(true)
      expect(edit({ text: 'On reflection, the fan was loud.' }, at + 86_400_000)).toBe(true)
      expect(edit({ cleanliness: 4, updated_at: 'later' }, at + 86_400_000)).toBe(true)
    })

    it('shuts on the instant the create stamped, and never reopens', () => {
      expect(edit({ stars: 4 }, at + REVIEW_EDIT_WINDOW_MS - 1000)).toBe(true)
      expect(edit({ stars: 4 }, at + REVIEW_EDIT_WINDOW_MS)).toBe(false)
      expect(edit({ stars: 4 }, at + REVIEW_EDIT_WINDOW_MS + 86_400_000)).toBe(false)
    })

    it('refuses a Guest editing somebody else\'s review, however small the patch', () => {
      expect(edit({ stars: 4 }, at + 1000, emailGuest(OTHER_GUEST_UID))).toBe(false)
    })

    it('refuses a Guest who stretches the edit window, or the words, past the rule', () => {
      // Moving `edit_until` is not among the keys a Guest may touch.
      expect(edit({ edit_until: ruleTimestamp(at + 10 * 365 * 86_400_000) }, at + 1000)).toBe(false)
      expect(edit({ uid: OTHER_GUEST_UID }, at + 1000)).toBe(false)
      expect(edit({ booking_id: 'booking-2' }, at + 1000)).toBe(false)
      // Nor the moderation, nor a self-published review.
      expect(edit({ status: 'published' }, at + 1000)).toBe(false)
      expect(edit({ status: 'hidden' }, at + 1000)).toBe(false)
      expect(edit({ admin_response: 'thanks!' }, at + 1000)).toBe(false)
      expect(edit({ moderated_by: ADMIN_UID }, at + 1000)).toBe(false)
    })

    it('refuses a Guest who edits into something invalid', () => {
      expect(edit({ stars: 6 }, at + 1000)).toBe(false)
      expect(edit({ stars: 0 }, at + 1000)).toBe(false)
      expect(edit({ text: 'x'.repeat(1001) }, at + 1000)).toBe(false)
      expect(edit({ text: '   ' }, at + 1000)).toBe(false)
      expect(edit({ cleanliness: 0 }, at + 1000)).toBe(false)
      expect(edit({ cleanliness: 6 }, at + 1000)).toBe(false)
    })
  })

  describe('what a create may carry', () => {
    it('refuses a Review that arrives already published', () => {
      expect(create({ status: 'published' })).toBe(false)
      expect(create({ status: 'hidden' })).toBe(false)
      expect(create({ status: 'pending' })).toBe(true)
    })

    it('refuses a create that smuggles in the Admin\'s fields', () => {
      expect(create({ admin_response: 'thanks!' })).toBe(false)
      expect(create({ admin_response_by: ADMIN_UID })).toBe(false)
      expect(create({ moderated_at: 'now' })).toBe(false)
      expect(create({ published_at: 'now' })).toBe(false)
    })

    it('refuses a create whose edit window the Guest chose', () => {
      expect(create({ edit_until: ruleTimestamp(at + 10 * 365 * 86_400_000) })).toBe(false)
      // And refuses one that omits it, which is what a client written before
      // the window existed would send.
      const missing = { ...reviewDoc({}, at) } as DocData
      delete missing.edit_until
      expect(deny({ path, method: 'create', auth: emailGuest(), requestData: missing, time: at })).toBe(true)
    })

    it('refuses a create with a missing status, which would leave moderation undefined', () => {
      const missing = { ...reviewDoc({}, at) } as DocData
      delete missing.status
      expect(deny({ path, method: 'create', auth: emailGuest(), requestData: missing, time: at })).toBe(true)
    })

    it('accepts category ratings inside 1..5 and refuses a zero', () => {
      expect(create({ cleanliness: 5, accommodation: 4, communication: 3, value: 2 })).toBe(true)
      expect(create({ cleanliness: 0 })).toBe(false)
      expect(create({ value: 6 })).toBe(false)
      expect(create({ value: '4' })).toBe(false)
    })

    it('refuses written feedback that is blank or over the limit', () => {
      expect(create({ text: '   ' })).toBe(false)
      expect(create({ text: '' })).toBe(false)
      expect(create({ text: 'x'.repeat(1001) })).toBe(false)
      expect(create({ text: 'x'.repeat(1000) })).toBe(true)
      // Absent is fine: the written part is optional.
      const noText = { ...reviewDoc({}, at) } as DocData
      delete noText.text
      expect(deny({ path, method: 'create', auth: emailGuest(), requestData: noText, time: at })).toBe(false)
    })
  })

  describe('the Admin\'s two doors', () => {
    const stored = reviewDoc({ status: 'pending' })

    it('lets the Admin publish, hide and answer', () => {
      const write = (overrides: DocData, auth = allowlistedAdmin()) =>
        allow({ path, method: 'update', auth, resourceData: stored, requestData: { ...stored, ...overrides } })
      expect(write({ status: 'published', published_at: 'now' })).toBe(true)
      expect(write({ status: 'hidden', moderated_at: 'now', moderated_by: ADMIN_UID })).toBe(true)
      expect(write({ admin_response: 'Thank you for staying with us!', admin_response_at: 'now', admin_response_by: ADMIN_UID })).toBe(true)
      // A Review written before moderation existed reads as `pending`, so
      // publishing it is a single-field move.
      expect(write({ status: 'published' })).toBe(true)
    })

    it('refuses a reply or a moderation signed with somebody else\'s uid', () => {
      // The Activity log already refuses to be signed in another Admin's name,
      // for the same reason this does: a record naming an author who did not
      // author it is worse than no record.
      const write = (overrides: DocData) =>
        allow({ path, method: 'update', auth: allowlistedAdmin(), resourceData: stored, requestData: { ...stored, ...overrides } })
      expect(write({ admin_response: 'We read this.', admin_response_by: ADMIN_UID })).toBe(true)
      expect(write({ admin_response: 'We read this.', admin_response_by: 'somebody-else' })).toBe(false)
      expect(write({ status: 'hidden', moderated_by: ADMIN_UID })).toBe(true)
      expect(write({ status: 'hidden', moderated_by: 'somebody-else' })).toBe(false)
      // A moderation that does not touch the stamp does not need one: a Review
      // written before moderation existed is published with a single field.
      expect(write({ status: 'published' })).toBe(true)
    })

    it('refuses a status that is not one of the three', () => {
      const write = (overrides: DocData) =>
        allow({ path, method: 'update', auth: allowlistedAdmin(), resourceData: stored, requestData: { ...stored, ...overrides } })
      expect(write({ status: 'deleted' })).toBe(false)
      expect(write({ status: '' })).toBe(false)
      expect(write({ status: 'Published' })).toBe(false)
    })

    it('refuses a Guest reaching the Admin\'s door', () => {
      expect(
        deny({
          path,
          method: 'update',
          auth: emailGuest(),
          resourceData: stored,
          requestData: { ...stored, status: 'published' },
          time: at + 1000,
        }),
      ).toBe(true)
    })

    it('refuses another Guest reaching it', () => {
      expect(
        deny({
          path,
          method: 'update',
          auth: emailGuest(OTHER_GUEST_UID),
          resourceData: stored,
          requestData: { ...stored, admin_response: 'we read this', admin_response_by: OTHER_GUEST_UID },
          time: at + 1000,
        }),
      ).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Public reviews — what a signed-out visitor may read (ADR-0014)
// ---------------------------------------------------------------------------

describe('public_reviews', () => {
  const path = `public_reviews/${BOOKING_ID}`
  const published = publicReviewDoc()

  it('lets any visitor read a published testimonial, signed in or not', () => {
    expect(allow({ path, method: 'get', auth: null, resourceData: published })).toBe(true)
    // A list query names the collection; the service evaluates a document of
    // it against the same rules, which is what `allow read: if true` answers.
    expect(allow({ path: 'public_reviews', method: 'list', auth: null })).toBe(true)
    expect(allow({ path: 'public_reviews', method: 'list', auth: emailGuest() })).toBe(true)
    expect(allow({ path, method: 'get', auth: emailGuest(), resourceData: published })).toBe(true)
  })

  it('never lets a Guest write one', () => {
    expect(deny({ path, method: 'create', auth: null, requestData: published })).toBe(true)
    expect(deny({ path, method: 'create', auth: emailGuest(), requestData: published })).toBe(true)
    expect(deny({ path, method: 'create', auth: emailGuest(OTHER_GUEST_UID), requestData: published })).toBe(true)
    expect(deny({ path, method: 'delete', auth: null, resourceData: published })).toBe(true)
  })

  it('lets the Admin publish one', () => {
    expect(allow({ path, method: 'create', auth: allowlistedAdmin(), requestData: published })).toBe(true)
    expect(allow({ path, method: 'create', auth: promotedAdmin(), requestData: published })).toBe(true)
  })

  it('refuses a testimonial that carries anything private', () => {
    const admin = allowlistedAdmin()
    // A uid, a Booking id under another name, the Admin's private reply, a
    // moderation stamp: the shape says six fields and `hasOnly` means it.
    expect(allow({ path, method: 'create', auth: admin, requestData: { ...published, uid: GUEST_UID } })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: { ...published, guest_uid: GUEST_UID } })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: { ...published, booking_id: BOOKING_ID } })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: { ...published, admin_response: 'private' } })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: { ...published, status: 'published' } })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: { ...published, email: 'ana@example.com' } })).toBe(false)
  })

  it('refuses a testimonial that names a different review than its own id', () => {
    expect(allow({ path, method: 'create', auth: allowlistedAdmin(), requestData: publicReviewDoc({ review_id: 'booking-2' }) })).toBe(false)
  })

  it('refuses an empty, oversized or unrated testimonial', () => {
    const admin = allowlistedAdmin()
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ excerpt: '' }) })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ excerpt: 'x'.repeat(401) }) })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ display_name: '' }) })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ display_name: 'x'.repeat(61) }) })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ month: '' }) })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ stars: 0 }) })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ stars: 6 }) })).toBe(false)
    expect(allow({ path, method: 'create', auth: admin, requestData: publicReviewDoc({ stars: '5' }) })).toBe(false)
  })

  it('withdraws by deleting, never by editing — so nothing is ever half-public', () => {
    expect(deny({ path, method: 'update', auth: allowlistedAdmin(), resourceData: published, requestData: { ...published, excerpt: 'something else' } })).toBe(true)
    expect(allow({ path, method: 'delete', auth: allowlistedAdmin(), resourceData: published })).toBe(true)
    expect(deny({ path, method: 'delete', auth: emailGuest(), resourceData: published })).toBe(true)
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

describe('site_config/payment', () => {
  const payment = {
    active: true,
    method: 'GCash',
    recipient_name: 'Hacienda de LuisAna',
    account_identifier: '09XX XXX XXXX',
    instructions: 'Send the exact amount and retain the receipt reference.',
    security_deposit_notes: 'Refundable after checkout.',
  }

  it('lets the Admin publish valid public payment information and everyone read it', () => {
    expect(allow({ path: 'site_config/payment', method: 'create', auth: allowlistedAdmin(), requestData: payment })).toBe(true)
    expect(allow({ path: 'site_config/payment', method: 'create', auth: allowlistedAdmin(), requestData: {
      active: true,
      methods: [
        { method: 'GCash', recipient_name: 'Agueda H.', account_identifier: '09258507707' },
        { method: 'BDO', recipient_name: 'Agueda Hortillas', account_identifier: '005438013682' },
      ],
      instructions: 'Submit a screenshot or Gmail confirmation/reference.',
    } })).toBe(true)
    expect(allow({ path: 'site_config/payment', method: 'get', auth: null, resourceData: payment })).toBe(true)
  })

  it('refuses Guests, incomplete configuration, and undeclared sensitive fields', () => {
    expect(deny({ path: 'site_config/payment', method: 'create', auth: anonymousGuest(), requestData: payment })).toBe(true)
    expect(deny({ path: 'site_config/payment', method: 'create', auth: allowlistedAdmin(), requestData: { ...payment, instructions: '' } })).toBe(true)
    expect(deny({ path: 'site_config/payment', method: 'create', auth: allowlistedAdmin(), requestData: { ...payment, secret_api_key: 'never-public' } })).toBe(true)
  })
})

describe('collections with no rule', () => {
  it('refuses a collection nobody wrote a rule for', () => {
    expect(deny({ path: 'some_future_collection/x', method: 'get', auth: allowlistedAdmin(), resourceData: { a: 1 } })).toBe(true)
    expect(deny({ path: 'some_future_collection/x', method: 'create', auth: anonymousGuest(), requestData: { a: 1 } })).toBe(true)
  })

  it('keeps public read on the site content, and only the Admin writing it', () => {
    expect(allow({ path: 'gallery/img-1', method: 'get', auth: null, resourceData: { url: 'x' } })).toBe(true)
    expect(allow({ path: 'site_config/rates', method: 'get', auth: null, resourceData: { rates: {} } })).toBe(true)
    // Publishing rates is a statement of which Accommodations exist, so it has to
    // be the canonical three and nothing else.
    expect(allow({
      path: 'site_config/rates', method: 'update', auth: allowlistedAdmin(),
      resourceData: canonicalRatesDocument, requestData: canonicalRatesDocument,
    })).toBe(true)
    expect(deny({ path: 'site_config/rates', method: 'update', auth: anonymousGuest(), resourceData: { rates: {} }, requestData: { rates: { v: 2 } } })).toBe(true)
  })

  it('refuses a published rates document that invents or drops an Accommodation', () => {
    const rates = () => structuredClone(canonicalRatesDocument)
    const publish = (requestData: DocData) =>
      deny({
        path: 'site_config/rates', method: 'update', auth: allowlistedAdmin(),
        resourceData: canonicalRatesDocument, requestData,
      })

    // A fourth property. The estate has three, and an invented one is not a
    // figure either app may publish.
    const invented = rates()
    ;(invented.accommodations as DocData)['poolside-casita-b'] = {
      rate_unit: 'standard_stay', active: true, security_deposit: 0, down_payment_percent: 50,
      guest_pricing: {
        units_per_booking: 1,
        weekday: { min_guests: 1, base_max_guests: 2, base_rate: 7500, excess_per_guest: 500 },
        weekend_holiday: { min_guests: 1, base_max_guests: 2, base_rate: 7500, excess_per_guest: 500 },
      },
    }
    expect(publish(invented)).toBe(true)

    // Silently dropping the Annex would leave the website quoting an Accommodation
    // no published rate exists for.
    const dropped = rates()
    delete (dropped.accommodations as DocData).annex
    expect(publish(dropped)).toBe(true)
  })

  it('refuses a physical inventory that is not a whole number of units', () => {
    const rates = structuredClone(canonicalRatesDocument)
    ;(rates.accommodations as DocData)['house-a-camping'].available_units = 0
    expect(deny({
      path: 'site_config/rates', method: 'update', auth: allowlistedAdmin(),
      resourceData: canonicalRatesDocument, requestData: rates,
    })).toBe(true)
  })

  it('keeps rooms to the Admin, and lets it record only a status', () => {
    expect(allow({ path: 'rooms/1', method: 'get', auth: allowlistedAdmin(), resourceData: { name: 'Main House' } })).toBe(true)
    expect(deny({ path: 'rooms/1', method: 'get', auth: anonymousGuest(), resourceData: { name: 'Main House' } })).toBe(true)
    expect(deny({ path: 'guest_profiles/1', method: 'create', auth: anonymousGuest(), requestData: { name: 'x' } })).toBe(true)

    // The one thing the register exists for.
    expect(allow({
      path: 'rooms/1', method: 'update', auth: allowlistedAdmin(),
      resourceData: { status: 'available' }, requestData: { status: 'maintenance' },
    })).toBe(true)

    // A price typed here changed no Booking: nothing on the booking or website
    // path reads `rooms`, so the write is refused rather than believed.
    expect(deny({
      path: 'rooms/1', method: 'update', auth: allowlistedAdmin(),
      resourceData: { status: 'available', pricePerNight: 16000 },
      requestData: { status: 'available', pricePerNight: 7500 },
    })).toBe(true)

    // As would a name, a capacity or an invented accommodation reference.
    for (const invented of [
      { status: 'available', name: 'Poolside Casita B' },
      { status: 'available', capacity: 6 },
      { status: 'available', accommodationId: 'poolside-casita-b' },
    ]) {
      expect(deny({
        path: 'rooms/1', method: 'update', auth: allowlistedAdmin(),
        resourceData: { status: 'available' }, requestData: invented,
      })).toBe(true)
    }

    // And it cannot grow or be pruned into the list of Accommodations.
    expect(deny({ path: 'rooms/new', method: 'create', auth: allowlistedAdmin(), requestData: { status: 'available', accommodationId: 'annex' } })).toBe(true)
    expect(deny({ path: 'rooms/1', method: 'delete', auth: allowlistedAdmin() })).toBe(true)
  })
})
