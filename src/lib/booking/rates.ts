// ----------------------------------------------------------------------------
// Booking lifecycle — the published rate card & cancellation policy
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The shared rates document publishes per-Accommodation weekday and
// weekend/holiday guest-count schedules, the Security deposit, a 50% down
// payment and cancellation policy. Every quote is one 22-hour standard stay.
// A Booking records the version, date, and rate classification used at submit;
// later rate publications do not rewrite an existing Booking.
//
// This file owns the document's shape and its pure validator so both publishing
// surfaces and tests check one contract without requiring Firebase.
// ----------------------------------------------------------------------------

import { roundMoney } from './internal'
import type { RefundPolicy, RefundTier, RateCard } from './money'

/** The Admin's published figures for one Accommodation. */
export type GuestRateSchedule = {
  /** Minimum count is one; base occupancy is included at the base rate. */
  min_guests: number
  base_max_guests: number
  base_rate: number
  /** Linear charge for each guest above base_max_guests. */
  excess_per_guest?: number
  /** A separately documented occupancy limit, if one exists (A-House: 3). */
  max_guests?: number
}

export type GuestBracketPricing = {
  weekday: GuestRateSchedule
  weekend_holiday: GuestRateSchedule
  /** Quantity represented by one Booking. Phase 2 keeps this at one unit. */
  units_per_booking?: 1
}

export type AccommodationRates = {
  /**
   * Display name managed by the Admin. Optional on legacy documents.
   *
   * This is the canonical Accommodation name for both apps and for Booking
   * display. A Booking stores the id; the name is resolved from here.
   */
  property_name?: string
  /**
   * How many units of this Accommodation the estate holds at once.
   *
   * Physical inventory, and a different fact from `units_per_booking`, which is
   * how many units one Booking takes: the A-House publishes `available_units: 2`
   * and `units_per_booking: 1`, because there are two units and a Booking takes
   * one of them. Availability counts committed Bookings against this number.
   */
  available_units?: number
  /** `night` is the legacy flat model; official rates are per 22-hour standard stay. */
  rate_unit?: 'night' | 'standard_stay'
  /** Whether this property can receive new bookings. Optional means active for legacy documents. */
  active?: boolean
  /** Legacy flat nightly figure; accepted only as a read-time type for older records. */
  nightly_rate?: number
  /** Required guest-count schedules for new bookings. */
  guest_pricing?: GuestBracketPricing
  /** Refundable amount held against damage, settled at check-out. */
  security_deposit: number
  /** Required 50% down payment for all new guest bookings. */
  down_payment_percent?: number
  /** Retired fixed fee; new rate publications reject this field. */
  reservation_fee_amount?: number
  /** Informational/manual pricing review notice; never adds invented money. */
  manual_review_notice?: string
}

/** One tier of the published cancellation policy. */
export type PublishedRefundTier = {
  min_days_before_check_in: number
  refund_percent: number
}

/**
 * The published cancellation policy, in the document's own snake-case
 * vocabulary. The money module speaks camelCase (`RefundPolicy`);
 * `ratesForAccommodation` is the one place the two are translated.
 */
export type PublishedRefundPolicy = {
  /** Flat percentage of the stay refunded on cancellation. */
  refund_percent?: number
  /** Tiered percentages; applied instead of `refund_percent` when published. */
  tiers?: PublishedRefundTier[]
  /** Percentage of the Security deposit returned; 100 unless published otherwise. */
  deposit_refund_percent?: number
}

/**
 * The document the Admin publishes (the `rates` document in `site_config`).
 *
 * Snake-case on purpose: this shape crosses into Firestore, and the rest of
 * the stored vocabulary is snake-case.
 */
export type OptionalChargePolicy = {
  label: string
  amount?: number
  unit?: 'pet' | 'set' | 'hour' | 'manual'
  automatic: false
  note: string
}

export type PublishedStayPolicies = {
  standard_stay_hours?: number
  check_in?: string
  check_out?: string
  special_event_notice?: string
  clean_as_you_go?: string
  optional_charges?: Record<string, OptionalChargePolicy>
}

/**
 * The pet fee: a per-pet amount added to the stay total, so one Booking is one
 * receipt and one 50/50 split rather than a second payment to arrange.
 */
export type PetPolicy = {
  /** Pesos per pet, per stay. */
  fee_per_pet: number
  /** Most pets one Booking may declare. Without a policy there are no pets. */
  max_pets?: number
}

/**
 * The wedding-prep arrangement prices a whole event rather than a guest count,
 * and it is published as an ordinary Accommodation rather than as a special
 * case: same formula, same validator, same rules arithmetic — `base_rate` for the
 * included guests plus `excess_per_guest` for each above it.
 *
 * That is deliberate. A separate `event_packages` list would have to be looked up
 * by the Booking inside `firestore.rules`, and the rules language has no lambda,
 * so a package could not be found by its id at all. Published as an
 * Accommodation it is priced by the schedule that already works.
 *
 * The id is `wedding-prep`; its `guest_pricing` is the published quote, so the
 * Admin changes the ₱8,500 and the ₱500 in the Rates screen like any other rate.
 */
export const WEDDING_PREP_ACCOMMODATION_ID = 'wedding-prep'

export type PublishedRates = {
  /** Which policy version this is. Stamped on the Booking at choice time. */
  version: string
  /** When this version took effect (ISO date, YYYY-MM-DD). */
  effective_date: string
  /** Admin-maintained Philippine holiday dates. No holiday calendar is guessed in code. */
  holiday_dates: string[]
  /** Figures per Accommodation id; accommodations absent here have no machine price. */
  accommodations: Record<string, AccommodationRates>
  /** Guest-visible non-automatic policies and optional charges. */
  policies?: PublishedStayPolicies
  /** The cancellation policy; absent means publish nothing and refund nothing. */
  refund?: PublishedRefundPolicy
  /** The per-pet fee. Absent means the Hacienda takes no pets. */
  pet_policy?: PetPolicy
  /** Pesos per hour for keeping the unit past noon check-out. Absent means no extension. */
  late_checkout_per_hour?: number
}

/** The one translation from the document's vocabulary to the money module's. */
export function refundPolicyFromPublished(published: PublishedRefundPolicy): RefundPolicy {
  const tiers: RefundTier[] | undefined = published.tiers?.map((t) => ({
    minDaysBeforeCheckIn: t.min_days_before_check_in,
    refundPercent: t.refund_percent,
  }))
  return {
    ...(published.refund_percent !== undefined ? { refundPercent: published.refund_percent } : {}),
    ...(tiers ? { tiers } : {}),
    ...(published.deposit_refund_percent !== undefined ? { depositRefundPercent: published.deposit_refund_percent } : {}),
  }
}

export type RatesProblem = {
  /** Where the problem is, dot-path from the document root. */
  path: string
  /** Why it is a problem, in words a Admin can act on. */
  message: string
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * YYYY-MM-DD, and a real calendar date (2026-02-30 is not one).
 *
 * `Date.parse` is not trusted with the day: engines normalise out-of-range
 * days to the following month, so the day is checked against the month's own
 * length instead.
 */
function isValidDate(value: unknown): value is string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value : '')
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return false
  const firstOfNextMonth = Date.UTC(year, month, 1)
  return day >= 1 && Date.UTC(year, month - 1, day) < firstOfNextMonth
}

/** The identity of the policy in force: which version, and since when. */
export type PolicySnapshot = {
  version: string
  effectiveDate: string
}

export type RateClassification = 'weekday' | 'weekend_holiday'

export type PropertyQuote = {
  rateCard: RateCard
  policy: RefundPolicy | undefined
  snapshot: PolicySnapshot
  /** What the guest owes for the stay itself, before pet, event and late fees. */
  stayTotal: number
  classification: RateClassification
  bracket: string
  units: 1
  /** Pesos added on top of `stayTotal`, and what each was for. */
  addons: StayAddons
}

/**
 * The charges added to a stay total, each kept apart so a Guest is told what
 * they are paying for rather than handed one larger number.
 *
 * `rateAmount` is the accommodation's own published figure from its guest-count
 * schedule. `stayTotal` is what is owed, and the two differ exactly by the
 * addons — which is what makes the breakdown explainable.
 */
export type StayAddons = {
  /** `pet_count * pet_policy.fee_per_pet`; zero when no policy or no pets. */
  petFee: number
  /** `late_checkout_hours * late_checkout_per_hour`; zero when neither is published. */
  lateCheckoutFee: number
  /** The accommodation's own published figure, before any addon. */
  rateAmount: number
  /** Pets declared for this Booking. */
  petCount: number
  /** Hours kept past noon check-out. */
  lateCheckoutHours: number
}

/** What a Guest may add to a stay. Anything absent is simply not offered. */
export type StayExtras = {
  /** Pets staying over; a whole number, zero or more. */
  pet_count?: number
  /** Whole hours kept past noon check-out. */
  late_checkout_hours?: number
}

function positiveWhole(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

/**
 * The charges added to a stay total, or `undefined` when a declared extra cannot
 * be honoured — pets with no published fee, or an extension with no published
 * hourly rate. `undefined` means the quote is refused: the Guest is never quoted
 * a stay whose addons nobody has priced, and `firestore.rules` refuses the same
 * Booking the same way.
 */
export function stayAddons(doc: PublishedRates, extras: StayExtras): StayAddons | undefined {
  const petCount = extras.pet_count ?? 0
  const lateHours = extras.late_checkout_hours ?? 0
  if (!positiveWhole(petCount) || !positiveWhole(lateHours)) return undefined
  if (petCount > 0) {
    const policy = doc.pet_policy
    if (!policy || !isFiniteNumber(policy.fee_per_pet) || policy.fee_per_pet < 0) return undefined
    if (policy.max_pets !== undefined && petCount > policy.max_pets) return undefined
  }
  if (lateHours > 0 && (!isFiniteNumber(doc.late_checkout_per_hour) || doc.late_checkout_per_hour < 0)) {
    return undefined
  }
  return {
    petFee: roundMoney(petCount * (doc.pet_policy?.fee_per_pet ?? 0)),
    lateCheckoutFee: roundMoney(lateHours * (doc.late_checkout_per_hour ?? 0)),
    rateAmount: 0,
    petCount,
    lateCheckoutHours: lateHours,
  }
}

function calendarNights(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`)
  const end = Date.parse(`${checkOut}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.round((end - start) / 86_400_000)
}

export function classifyRateDate(date: string, holidayDates: readonly string[] = []): RateClassification | undefined {
  if (!isValidDate(date)) return undefined
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return holidayDates.includes(date) || day === 5 || day === 6 ? 'weekend_holiday' : 'weekday'
}

function scheduledAmount(schedule: GuestRateSchedule, guests: number): { amount: number; bracket: string } | undefined {
  if (!Number.isInteger(guests) || guests < schedule.min_guests) return undefined
  if (schedule.max_guests !== undefined && guests > schedule.max_guests) return undefined
  if (guests <= schedule.base_max_guests) return { amount: schedule.base_rate, bracket: `up to ${schedule.base_max_guests}` }
  const excessPerGuest = schedule.excess_per_guest
  if (!isFiniteNumber(excessPerGuest) || excessPerGuest < 0) return undefined
  return {
    amount: roundMoney(schedule.base_rate + (guests - schedule.base_max_guests) * excessPerGuest),
    bracket: `${schedule.base_max_guests} included + ${guests - schedule.base_max_guests} extra`,
  }
}

/**
 * The authoritative quote path for new guest bookings. Tiered rates are per
 * one 22-hour standard stay; multi-stay mixing is refused until the business
 * defines that policy.
 *
 * A stay is priced either by the accommodation's guest-count schedule or, when
 * the Guest names one, by an event package — never both. Pets and a late
 * checkout are added on top of whichever priced it, and they are added to the
 * stay total rather than billed separately so the 50/50 split stays one payment.
 */
export function quoteAccommodation(
  doc: PublishedRates,
  accommodationId: string,
  input: { check_in: string; check_out: string; guests: number } & StayExtras,
): PropertyQuote | undefined {
  const figures = doc.accommodations[accommodationId]
  if (!figures || figures.active === false || !figures.guest_pricing
      || figures.rate_unit !== 'standard_stay' || calendarNights(input.check_in, input.check_out) !== 1) return undefined
  const classification = classifyRateDate(input.check_in, doc.holiday_dates)
  if (!classification) return undefined
  const addons = stayAddons(doc, input)
  if (!addons) return undefined

  let bracket: string
  let rateAmount: number
  const scheduled = scheduledAmount(figures.guest_pricing[classification], input.guests)
  if (!scheduled) return undefined
  rateAmount = scheduled.amount
  bracket = scheduled.bracket

  const stayTotal = roundMoney(rateAmount + addons.petFee + addons.lateCheckoutFee)
  return {
    policy: doc.refund !== undefined ? refundPolicyFromPublished(doc.refund) : undefined,
    snapshot: { version: doc.version, effectiveDate: doc.effective_date },
    units: 1,
    classification,
    bracket,
    stayTotal,
    addons: { ...addons, rateAmount },
    rateCard: {
      nightlyRate: rateAmount,
      securityDeposit: figures.security_deposit,
      ...(figures.down_payment_percent !== undefined ? { downPaymentPercent: figures.down_payment_percent } : {}),
    },
  }
}

function scheduleProblems(path: string, node: unknown, allowDocumentedCap: boolean, requireExcess: boolean): RatesProblem[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return [{ path, message: 'must be a guest-count rate schedule.' }]
  }
  const schedule = node as Record<string, unknown>
  const problems: RatesProblem[] = []
  const positiveInt = (value: unknown) => Number.isInteger(value) && (value as number) > 0
  if (!positiveInt(schedule.min_guests)) {
    problems.push({ path: `${path}.min_guests`, message: 'must be a positive whole number.' })
  } else if (schedule.min_guests !== 1) {
    problems.push({ path: `${path}.min_guests`, message: 'must be 1; base occupancy is not a minimum booking size.' })
  }
  if (!positiveInt(schedule.base_max_guests) || (schedule.base_max_guests as number) < (positiveInt(schedule.min_guests) ? schedule.min_guests as number : 1)) {
    problems.push({ path: `${path}.base_max_guests`, message: 'must be at or above min_guests.' })
  }
  if (!isFiniteNumber(schedule.base_rate) || schedule.base_rate <= 0) {
    problems.push({ path: `${path}.base_rate`, message: 'must be a positive peso amount.' })
  }
  if (schedule.max_guests !== undefined && !allowDocumentedCap) {
    problems.push({ path: `${path}.max_guests`, message: 'is not supported without a separately documented physical/safety limit.' })
  } else if (schedule.max_guests !== undefined && (!positiveInt(schedule.max_guests)
      || (positiveInt(schedule.base_max_guests) && (schedule.max_guests as number) < (schedule.base_max_guests as number)))) {
    problems.push({ path: `${path}.max_guests`, message: 'must be a whole-number cap at or above base_max_guests.' })
  }
  if (requireExcess && schedule.excess_per_guest === undefined) {
    problems.push({ path: `${path}.excess_per_guest`, message: 'is required when there is no absolute guest cap.' })
  } else if (schedule.excess_per_guest !== undefined && (!isFiniteNumber(schedule.excess_per_guest) || schedule.excess_per_guest < 0)) {
    problems.push({ path: `${path}.excess_per_guest`, message: 'must be a non-negative per-person peso amount.' })
  }
  for (const retired of ['upper_min_guests', 'upper_max_guests', 'upper_rate', 'excess_after']) {
    if (schedule[retired] !== undefined) {
      problems.push({ path: `${path}.${retired}`, message: 'is retired; use base_rate plus excess_per_guest.' })
    }
  }
  return problems
}

/**
 * The documented occupancy of the A-House camping unit: three people share it,
 * and three is the ceiling. It is the one Accommodation with a hard physical
 * limit rather than an open excess rule, which is why it alone may publish
 * `max_guests`.
 *
 * Because the cap equals the included count, an A-House schedule carries no
 * `excess_per_guest`: there is no guest it could charge. Publishing one would
 * state a price for a fourth person the unit cannot take.
 */
const A_HOUSE_ID = 'house-a-camping'
const A_HOUSE_INCLUDED_GUESTS = 3
const A_HOUSE_MAX_GUESTS = 3

/** Validate one Accommodation's figures. */
function accommodationProblems(accommodationId: string, node: unknown): RatesProblem[] {
  const problems: RatesProblem[] = []
  if (typeof node !== 'object' || node === null) {
    problems.push({ path: `accommodations.${accommodationId}`, message: 'must be an object of figures.' })
    return problems
  }
  const rates = node as Record<string, unknown>

  if (rates.property_name !== undefined && (typeof rates.property_name !== 'string' || rates.property_name.trim() === '')) {
    problems.push({
      path: `accommodations.${accommodationId}.property_name`,
      message: 'must be a non-empty property name when supplied.',
    })
  }
  if (rates.rate_unit !== undefined && !['night', 'standard_stay'].includes(rates.rate_unit as string)) {
    problems.push({
      path: `accommodations.${accommodationId}.rate_unit`,
      message: 'must be "night" or "standard_stay".',
    })
  }
  if (rates.active !== undefined && typeof rates.active !== 'boolean') {
    problems.push({
      path: `accommodations.${accommodationId}.active`,
      message: 'must be true or false.',
    })
  }
  if (rates.nightly_rate !== undefined) {
    problems.push({
      path: `accommodations.${accommodationId}.nightly_rate`,
      message: 'legacy flat nightly pricing cannot be published for new bookings; use guest_pricing.',
    })
  }
  if (rates.available_units !== undefined
      && (!Number.isInteger(rates.available_units) || (rates.available_units as number) < 1)) {
    problems.push({
      path: `accommodations.${accommodationId}.available_units`,
      message: 'must be a whole number of units, at least 1.',
    })
  }
  if (rates.guest_pricing === undefined) {
    problems.push({
      path: `accommodations.${accommodationId}.guest_pricing`,
      message: 'must publish weekday and weekend_holiday guest-count schedules.',
    })
  } else {
    const pricing = rates.guest_pricing as Record<string, unknown>
    if (typeof pricing !== 'object' || pricing === null || Array.isArray(pricing)) {
      problems.push({ path: `accommodations.${accommodationId}.guest_pricing`, message: 'must contain weekday and weekend_holiday schedules.' })
    } else {
      const hasDocumentedCap = accommodationId === A_HOUSE_ID
      const weekdayPath = `accommodations.${accommodationId}.guest_pricing.weekday`
      const weekendPath = `accommodations.${accommodationId}.guest_pricing.weekend_holiday`
      // The Main House and the Annex have no documented ceiling, so a guest
      // above the included count is priced rather than refused — hence the
      // excess rule they must publish. The A-House caps that guest instead.
      problems.push(...scheduleProblems(weekdayPath, pricing.weekday, hasDocumentedCap, !hasDocumentedCap))
      problems.push(...scheduleProblems(weekendPath, pricing.weekend_holiday, hasDocumentedCap, !hasDocumentedCap))
      if (hasDocumentedCap) {
        for (const [path, schedule] of [[weekdayPath, pricing.weekday], [weekendPath, pricing.weekend_holiday]] as const) {
          if (typeof schedule === 'object' && schedule !== null && !Array.isArray(schedule)) {
            const node = schedule as Record<string, unknown>
            if (node.base_max_guests !== A_HOUSE_INCLUDED_GUESTS || node.max_guests !== A_HOUSE_MAX_GUESTS) {
              problems.push({
                path,
                message: `A-House is one unit per booking and takes up to ${A_HOUSE_MAX_GUESTS} guests, at the base rate.`,
              })
            }
            // The cap equals the included count, so an excess rule would price a
            // guest the unit cannot hold. Reject it rather than publish a figure
            // that can never be charged.
            if (node.excess_per_guest !== undefined) {
              problems.push({
                path: `${path}.excess_per_guest`,
                message: 'A-House is a flat per-unit amount through its three-guest maximum; it prices no guest beyond it.',
              })
            }
          }
        }
      }
      if (pricing.units_per_booking !== undefined && pricing.units_per_booking !== 1) {
        problems.push({ path: `accommodations.${accommodationId}.guest_pricing.units_per_booking`, message: 'must be 1 until quantity booking is defined.' })
      }
    }
  }
  if (rates.rate_unit !== 'standard_stay') {
    problems.push({ path: `accommodations.${accommodationId}.rate_unit`, message: 'new guest-count prices must use the standard_stay rate unit.' })
  }
  if (!isFiniteNumber(rates.security_deposit) || rates.security_deposit < 0) {
    problems.push({
      path: `accommodations.${accommodationId}.security_deposit`,
      message: 'must be a peso amount, zero or more.',
    })
  }
  if (!isFiniteNumber(rates.down_payment_percent) || rates.down_payment_percent !== 50) {
    problems.push({
      path: `accommodations.${accommodationId}.down_payment_percent`,
      message: 'must be 50; the remaining 50% is due at check-in.',
    })
  }
  if (rates.reservation_fee_amount !== undefined) {
    problems.push({
      path: `accommodations.${accommodationId}.reservation_fee_amount`,
      message: 'fixed reservation fees are not accepted; the down payment is 50% of the computed stay total.',
    })
  }
  if (rates.manual_review_notice !== undefined && (typeof rates.manual_review_notice !== 'string' || rates.manual_review_notice.length > 500)) {
    problems.push({ path: `accommodations.${accommodationId}.manual_review_notice`, message: 'must be text of at most 500 characters.' })
  }
  return problems
}

/** Validate the cancellation policy, if one is published. */
function refundProblems(node: unknown): RatesProblem[] {
  const problems: RatesProblem[] = []
  if (typeof node !== 'object' || node === null) {
    problems.push({ path: 'refund', message: 'must be an object, or be absent.' })
    return problems
  }
  const policy = node as Record<string, unknown>

  if (policy.refund_percent !== undefined && (!isFiniteNumber(policy.refund_percent) || policy.refund_percent < 0 || policy.refund_percent > 100)) {
    problems.push({ path: 'refund.refund_percent', message: 'must be a percentage between 0 and 100.' })
  }
  if (policy.deposit_refund_percent !== undefined && (!isFiniteNumber(policy.deposit_refund_percent) || policy.deposit_refund_percent < 0 || policy.deposit_refund_percent > 100)) {
    problems.push({ path: 'refund.deposit_refund_percent', message: 'must be a percentage between 0 and 100.' })
  }
  if (policy.tiers !== undefined) {
    if (!Array.isArray(policy.tiers)) {
      problems.push({ path: 'refund.tiers', message: 'must be a list of { min_days_before_check_in, refund_percent }, or be absent.' })
    } else {
      policy.tiers.forEach((tier, i) => {
        const t = tier as Record<string, unknown>
        if (!isFiniteNumber(t.min_days_before_check_in) || t.min_days_before_check_in < 0) {
          problems.push({ path: `refund.tiers[${i}].min_days_before_check_in`, message: 'must be a whole number of days, zero or more.' })
        }
        if (!isFiniteNumber(t.refund_percent) || t.refund_percent < 0 || t.refund_percent > 100) {
          problems.push({ path: `refund.tiers[${i}].refund_percent`, message: 'must be a percentage between 0 and 100.' })
        }
      })
    }
  }
  return problems
}

/** The problems with a pet policy, if one is published. */
function petPolicyProblems(node: unknown): RatesProblem[] {
  const problems: RatesProblem[] = []
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return [{ path: 'pet_policy', message: 'must be an object, or be absent to take no pets.' }]
  }
  const policy = node as Record<string, unknown>
  if (!isFiniteNumber(policy.fee_per_pet) || policy.fee_per_pet <= 0) {
    problems.push({ path: 'pet_policy.fee_per_pet', message: 'must be a positive peso amount per pet.' })
  }
  if (policy.max_pets !== undefined && (!Number.isInteger(policy.max_pets) || (policy.max_pets as number) < 1)) {
    problems.push({ path: 'pet_policy.max_pets', message: 'must be a whole number of at least 1 when supplied.' })
  }
  return problems
}

/**
 * The problems with a published-rates document, in reading order.
 *
 * An empty list means the document is publishable as-is. `knownAccommodationIds`,
 * when given, also flags figures published for an Accommodation the site does
 * not list — a rate for a unit that does not exist cannot be chosen, and a
 * choice for a unit with no published rate refuses.
 */
export function validatePublishedRates(doc: unknown, knownAccommodationIds?: readonly string[]): RatesProblem[] {
  const problems: RatesProblem[] = []
  if (typeof doc !== 'object' || doc === null) {
    return [{ path: '', message: 'the rates document must be an object.' }]
  }
  const rates = doc as Record<string, unknown>

  if (typeof rates.version !== 'string' || rates.version.trim() === '') {
    problems.push({ path: 'version', message: 'must name the version this policy is published under.' })
  }
  if (!isValidDate(rates.effective_date)) {
    problems.push({ path: 'effective_date', message: 'must be the date this version took effect (YYYY-MM-DD).' })
  }
  if (!Array.isArray(rates.holiday_dates)) {
    problems.push({ path: 'holiday_dates', message: 'must be an explicit Admin-maintained list of YYYY-MM-DD dates (use [] when none are configured).' })
  } else {
    const holidayDates = rates.holiday_dates as unknown[]
    holidayDates.forEach((date, index) => {
      if (!isValidDate(date)) problems.push({ path: `holiday_dates[${index}]`, message: 'must be a real YYYY-MM-DD date.' })
    })
    if (new Set(holidayDates).size !== holidayDates.length) {
      problems.push({ path: 'holiday_dates', message: 'must not contain duplicate dates.' })
    }
  }

  if (typeof rates.accommodations !== 'object' || rates.accommodations === null || Array.isArray(rates.accommodations)) {
    problems.push({ path: 'accommodations', message: 'must be an object of Accommodation id → figures.' })
  } else {
    const accommodations = rates.accommodations as Record<string, unknown>
    for (const [id, node] of Object.entries(accommodations)) {
      if (knownAccommodationIds && !knownAccommodationIds.includes(id)) {
        problems.push({ path: `accommodations.${id}`, message: 'is not an Accommodation the site lists.' })
        continue
      }
      problems.push(...accommodationProblems(id, node))
    }
  }

  if (rates.pet_policy !== undefined) {
    problems.push(...petPolicyProblems(rates.pet_policy))
  }
  if (rates.late_checkout_per_hour !== undefined
      && (!isFiniteNumber(rates.late_checkout_per_hour) || rates.late_checkout_per_hour < 0)) {
    problems.push({ path: 'late_checkout_per_hour', message: 'must be a non-negative peso amount per hour, or be absent to refuse extensions.' })
  }

  if (rates.refund !== undefined) {
    problems.push(...refundProblems(rates.refund))
  }

  return problems
}

/**
 * The rate card and the policy for one Accommodation, read back out of a
 * published document — the values ChoosePaymentPlan and settleRefund take as
 * arguments. `undefined` when the Accommodation has no published figures:
 * the action refuses rather than inventing a price.
 */
export function ratesForAccommodation(
  doc: PublishedRates,
  accommodationId: string,
): { rateCard: RateCard; policy: RefundPolicy | undefined; snapshot: PolicySnapshot } | undefined {
  const figures = doc.accommodations[accommodationId]
  if (!figures || figures.active === false || figures.guest_pricing
      || (figures.rate_unit !== undefined && figures.rate_unit !== 'night')
      || !isFiniteNumber(figures.nightly_rate)) return undefined
  return {
    rateCard: {
      nightlyRate: figures.nightly_rate,
      securityDeposit: figures.security_deposit,
      ...(figures.down_payment_percent !== undefined ? { downPaymentPercent: figures.down_payment_percent } : {}),
    },
    policy: doc.refund !== undefined ? refundPolicyFromPublished(doc.refund) : undefined,
    snapshot: { version: doc.version, effectiveDate: doc.effective_date },
  }
}

/** The recorded figures, as the money module's roundMoney would store them. */
export function quotedStayTotal(doc: PublishedRates, accommodationId: string, nights: number): number | undefined {
  const quoted = ratesForAccommodation(doc, accommodationId)
  if (!quoted) return undefined
  return roundMoney(Math.max(1, nights) * quoted.rateCard.nightlyRate)
}
