// ----------------------------------------------------------------------------
// Booking lifecycle — the published rate card & cancellation policy
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The one document the Admin publishes so that money can move: per-
// Accommodation rates, the Security deposit, the down-payment percent and the
// cancellation policy, under a version that takes effect on a date.
//
// Why a version: ChoosePaymentPlan stamps the version in force on the Booking
// at the moment the Guest commits to a plan, so a later republish changes the
// terms for *future* choices only — never the refund terms of a stay already
// promised. A policy that is not published refunds nothing (settleRefund),
// which is what an unpublished or invalid document amounts to.
//
// This file owns the document's shape and its validator, and nothing else: it
// is pure, so the check a publishing surface runs before it writes
// `site_config` is the same check a test runs, and neither needs Firebase.
// ----------------------------------------------------------------------------

import { roundMoney } from './internal'
import type { RefundPolicy, RefundTier, RateCard } from './money'

/** The Admin's published figures for one Accommodation. */
export type GuestRateSchedule = {
  min_guests: number
  base_max_guests: number
  base_rate: number
  upper_min_guests?: number
  upper_max_guests?: number
  upper_rate?: number
  excess_after?: number
  excess_per_guest?: number
}

export type GuestBracketPricing = {
  weekday: GuestRateSchedule
  weekend_holiday: GuestRateSchedule
  /** Quantity represented by one Booking. Phase 2 keeps this at one unit. */
  units_per_booking?: 1
}

export type AccommodationRates = {
  /** Display name managed by the Admin. Optional on legacy documents. */
  property_name?: string
  /** `night` is the legacy flat model; official rates are per 22-hour standard stay. */
  rate_unit?: 'night' | 'standard_stay'
  /** Whether this property can receive new bookings. Optional means active for legacy documents. */
  active?: boolean
  /** Legacy flat nightly figure. Kept for already-published Phase 1 documents. */
  nightly_rate?: number
  /** Official guest-count schedule. Mutually exclusive with `nightly_rate`. */
  guest_pricing?: GuestBracketPricing
  /** Refundable amount held against damage, settled at check-out. */
  security_deposit: number
  /** Down-payment percentage; omitted means full payment only. */
  down_payment_percent?: number
  /** Exact reservation fee, when the client publishes one. Takes priority over a percentage. */
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

export type PublishedRates = {
  /** Which policy version this is. Stamped on the Booking at choice time. */
  version: string
  /** When this version took effect (ISO date, YYYY-MM-DD). */
  effective_date: string
  /** Admin-maintained Philippine holiday dates. No holiday calendar is guessed in code. */
  holiday_dates?: string[]
  /** Figures per Accommodation id; accommodations absent here have no machine price. */
  accommodations: Record<string, AccommodationRates>
  /** Guest-visible non-automatic policies and optional charges. */
  policies?: PublishedStayPolicies
  /** The cancellation policy; absent means publish nothing and refund nothing. */
  refund?: PublishedRefundPolicy
}

/** The one translation from the document's vocabulary to the money module's. */
function toRefundPolicy(published: PublishedRefundPolicy): RefundPolicy {
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
  stayTotal: number
  classification: RateClassification | 'legacy_flat'
  bracket: string
  units: 1
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
  return holidayDates.includes(date) || day === 0 || day === 6 ? 'weekend_holiday' : 'weekday'
}

function scheduledAmount(schedule: GuestRateSchedule, guests: number): { amount: number; bracket: string } | undefined {
  if (!Number.isInteger(guests) || guests < schedule.min_guests) return undefined
  if (guests <= schedule.base_max_guests) return { amount: schedule.base_rate, bracket: `${schedule.min_guests}-${schedule.base_max_guests}` }
  if (schedule.upper_min_guests !== undefined && schedule.upper_max_guests !== undefined && schedule.upper_rate !== undefined) {
    if (guests >= schedule.upper_min_guests && guests <= schedule.upper_max_guests) {
      return { amount: schedule.upper_rate, bracket: `${schedule.upper_min_guests}-${schedule.upper_max_guests}` }
    }
    if (schedule.excess_after !== undefined && schedule.excess_per_guest !== undefined && guests > schedule.excess_after) {
      return {
        amount: roundMoney(schedule.upper_rate + (guests - schedule.excess_after) * schedule.excess_per_guest),
        bracket: `${schedule.excess_after}+`,
      }
    }
  }
  return undefined
}

/**
 * The single authoritative quote path for both legacy flat prices and the
 * official guest-count schedules. Tiered rates are per one 22-hour standard
 * stay; multi-stay mixing is refused until the business defines that policy.
 */
export function quoteAccommodation(
  doc: PublishedRates,
  accommodationId: string,
  input: { check_in: string; check_out: string; guests: number },
): PropertyQuote | undefined {
  const figures = doc.accommodations[accommodationId]
  if (!figures || figures.active === false) return undefined
  const common = {
    policy: doc.refund !== undefined ? toRefundPolicy(doc.refund) : undefined,
    snapshot: { version: doc.version, effectiveDate: doc.effective_date },
    units: 1 as const,
  }
  const nights = calendarNights(input.check_in, input.check_out)
  if (figures.guest_pricing) {
    if (figures.rate_unit !== 'standard_stay' || nights !== 1) return undefined
    const classification = classifyRateDate(input.check_in, doc.holiday_dates)
    if (!classification) return undefined
    const scheduled = scheduledAmount(figures.guest_pricing[classification], input.guests)
    if (!scheduled) return undefined
    return {
      ...common,
      classification,
      bracket: scheduled.bracket,
      stayTotal: scheduled.amount,
      rateCard: {
        nightlyRate: scheduled.amount,
        securityDeposit: figures.security_deposit,
        ...(figures.reservation_fee_amount !== undefined ? { reservationFeeAmount: figures.reservation_fee_amount } : {}),
        ...(figures.down_payment_percent !== undefined ? { downPaymentPercent: figures.down_payment_percent } : {}),
      },
    }
  }
  if (figures.rate_unit !== undefined && figures.rate_unit !== 'night') return undefined
  if (!isFiniteNumber(figures.nightly_rate) || nights < 1) return undefined
  return {
    ...common,
    classification: 'legacy_flat',
    bracket: 'flat',
    stayTotal: roundMoney(nights * figures.nightly_rate),
    rateCard: {
      nightlyRate: figures.nightly_rate,
      securityDeposit: figures.security_deposit,
      ...(figures.reservation_fee_amount !== undefined ? { reservationFeeAmount: figures.reservation_fee_amount } : {}),
      ...(figures.down_payment_percent !== undefined ? { downPaymentPercent: figures.down_payment_percent } : {}),
    },
  }
}

function scheduleProblems(path: string, node: unknown): RatesProblem[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return [{ path, message: 'must be a guest-count rate schedule.' }]
  }
  const schedule = node as Record<string, unknown>
  const problems: RatesProblem[] = []
  const positiveInt = (value: unknown) => Number.isInteger(value) && (value as number) > 0
  if (!positiveInt(schedule.min_guests)) problems.push({ path: `${path}.min_guests`, message: 'must be a positive whole number.' })
  if (!positiveInt(schedule.base_max_guests) || (positiveInt(schedule.min_guests) && (schedule.base_max_guests as number) < (schedule.min_guests as number))) {
    problems.push({ path: `${path}.base_max_guests`, message: 'must be at or above min_guests.' })
  }
  if (!isFiniteNumber(schedule.base_rate) || schedule.base_rate <= 0) problems.push({ path: `${path}.base_rate`, message: 'must be a positive peso amount.' })

  const upperFields = ['upper_min_guests', 'upper_max_guests', 'upper_rate'] as const
  const hasUpper = upperFields.some((key) => schedule[key] !== undefined)
  if (hasUpper) {
    if (!positiveInt(schedule.upper_min_guests) || (positiveInt(schedule.base_max_guests) && schedule.upper_min_guests !== (schedule.base_max_guests as number) + 1)) {
      problems.push({ path: `${path}.upper_min_guests`, message: 'must immediately follow the base bracket.' })
    }
    if (!positiveInt(schedule.upper_max_guests) || (positiveInt(schedule.upper_min_guests) && (schedule.upper_max_guests as number) < (schedule.upper_min_guests as number))) {
      problems.push({ path: `${path}.upper_max_guests`, message: 'must be at or above upper_min_guests.' })
    }
    if (!isFiniteNumber(schedule.upper_rate) || schedule.upper_rate <= 0) problems.push({ path: `${path}.upper_rate`, message: 'must be a positive peso amount.' })
  }

  const hasExcess = schedule.excess_after !== undefined || schedule.excess_per_guest !== undefined
  if (hasExcess) {
    if (!hasUpper) problems.push({ path: `${path}.excess_after`, message: 'requires an upper bracket.' })
    if (!positiveInt(schedule.excess_after) || (positiveInt(schedule.upper_max_guests) && schedule.excess_after !== schedule.upper_max_guests)) {
      problems.push({ path: `${path}.excess_after`, message: 'must equal the upper bracket maximum.' })
    }
    if (!isFiniteNumber(schedule.excess_per_guest) || schedule.excess_per_guest <= 0) {
      problems.push({ path: `${path}.excess_per_guest`, message: 'must be a positive per-person amount.' })
    }
  }
  return problems
}

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
  const hasFlatRate = rates.nightly_rate !== undefined
  const hasGuestPricing = rates.guest_pricing !== undefined
  if (hasFlatRate === hasGuestPricing) {
    problems.push({
      path: `accommodations.${accommodationId}`,
      message: 'must publish exactly one pricing model: nightly_rate or guest_pricing.',
    })
  }
  if (hasFlatRate && (!isFiniteNumber(rates.nightly_rate) || rates.nightly_rate <= 0)) {
    problems.push({
      path: `accommodations.${accommodationId}.nightly_rate`,
      message: 'must be a number of pesos per night, greater than zero.',
    })
  }
  if (hasGuestPricing) {
    const pricing = rates.guest_pricing as Record<string, unknown>
    if (typeof pricing !== 'object' || pricing === null || Array.isArray(pricing)) {
      problems.push({ path: `accommodations.${accommodationId}.guest_pricing`, message: 'must contain weekday and weekend_holiday schedules.' })
    } else {
      problems.push(...scheduleProblems(`accommodations.${accommodationId}.guest_pricing.weekday`, pricing.weekday))
      problems.push(...scheduleProblems(`accommodations.${accommodationId}.guest_pricing.weekend_holiday`, pricing.weekend_holiday))
      if (pricing.units_per_booking !== undefined && pricing.units_per_booking !== 1) {
        problems.push({ path: `accommodations.${accommodationId}.guest_pricing.units_per_booking`, message: 'must be 1 until quantity booking is defined.' })
      }
    }
    if (rates.rate_unit !== 'standard_stay') {
      problems.push({ path: `accommodations.${accommodationId}.rate_unit`, message: 'guest bracket pricing must use standard_stay.' })
    }
  }
  if (!isFiniteNumber(rates.security_deposit) || rates.security_deposit < 0) {
    problems.push({
      path: `accommodations.${accommodationId}.security_deposit`,
      message: 'must be a peso amount, zero or more.',
    })
  }
  if (rates.down_payment_percent !== undefined) {
    if (!isFiniteNumber(rates.down_payment_percent) || rates.down_payment_percent <= 0 || rates.down_payment_percent >= 100) {
      problems.push({
        path: `accommodations.${accommodationId}.down_payment_percent`,
        message: 'must be a percentage strictly between 0 and 100 (omit it for full payment only).',
      })
    }
  }
  if (rates.reservation_fee_amount !== undefined && (!isFiniteNumber(rates.reservation_fee_amount) || rates.reservation_fee_amount <= 0)) {
    problems.push({ path: `accommodations.${accommodationId}.reservation_fee_amount`, message: 'must be a positive peso amount.' })
  }
  if (rates.reservation_fee_amount !== undefined && rates.down_payment_percent !== undefined) {
    problems.push({ path: `accommodations.${accommodationId}`, message: 'cannot publish both a reservation fee and a down-payment percentage.' })
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
  if (rates.holiday_dates !== undefined) {
    if (!Array.isArray(rates.holiday_dates)) {
      problems.push({ path: 'holiday_dates', message: 'must be a list of YYYY-MM-DD dates.' })
    } else {
      rates.holiday_dates.forEach((date, index) => {
        if (!isValidDate(date)) problems.push({ path: `holiday_dates[${index}]`, message: 'must be a real YYYY-MM-DD date.' })
      })
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
      ...(figures.reservation_fee_amount !== undefined ? { reservationFeeAmount: figures.reservation_fee_amount } : {}),
      ...(figures.down_payment_percent !== undefined ? { downPaymentPercent: figures.down_payment_percent } : {}),
    },
    policy: doc.refund !== undefined ? toRefundPolicy(doc.refund) : undefined,
    snapshot: { version: doc.version, effectiveDate: doc.effective_date },
  }
}

/** The recorded figures, as the money module's roundMoney would store them. */
export function quotedStayTotal(doc: PublishedRates, accommodationId: string, nights: number): number | undefined {
  const quoted = ratesForAccommodation(doc, accommodationId)
  if (!quoted) return undefined
  return roundMoney(Math.max(1, nights) * quoted.rateCard.nightlyRate)
}
