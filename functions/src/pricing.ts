/**
 * The authoritative price of a stay, computed on the server.
 *
 * Pure: no SDK, no Firestore, no clock of its own. Everything it needs arrives as
 * an argument, which is what makes it testable and what makes it *trustworthy* —
 * the same code path is what the callable runs and what the tests run.
 *
 * It does not implement pricing. It calls the module the website quotes from
 * (`src/lib/booking/rates.ts`, mirrored into `functions/src/booking/` and
 * hash-checked by `test/booking-sync.test.ts`), because two implementations of a
 * price is the bug this file exists to remove: a Guest's total is only meaningful
 * if it is compared against the figure the estate actually publishes, computed the
 * way the estate actually computes it.
 *
 * ADR-0018 records why the same arithmetic was pulled out of `firestore.rules`
 * (the 1,000-expression budget, and an evaluation error that arrives as a plain
 * `permission-denied`). This is where it lives instead: a function with no budget,
 * whose result the rules can then check in a handful of comparisons against a
 * document a client cannot write.
 */

import {
  classifyRateDate,
  quoteAccommodation,
  validatePublishedRates,
  type PublishedRates,
  type PublishedRefundPolicy,
  type RateClassification,
} from './booking/rates'
import { paymentOptionsForTotal } from './booking/money'
import { configuredBookingLeadTimeDays, validateMinimumBookingLeadTime } from './booking/leadTime'

/** What a quote is for. No money here: money is what this module produces. */
export interface QuoteRequest {
  accommodation: string
  check_in: string
  check_out: string
  guests: number
  pet_count: number
  late_checkout_hours: number
}

/** The figures a Booking must carry, keyed as `bookings` stores them. */
export interface AuthoritativeMoney {
  rate_unit: 'standard_stay'
  rate_amount: number
  rate_classification: RateClassification
  nights: 1
  stay_total: number
  amount_due: number
  balance_due: number
  security_deposit: number
  payment_plan: 'down-payment'
  policy_version: string
  policy_effective_date: string
  refund_policy_snapshot: PublishedRefundPolicy | null
}

export interface DerivedQuote {
  request: QuoteRequest
  money: AuthoritativeMoney
  /** The `site_config/rates` version this price came from, for staleness. */
  rates_version: string
  /** Human-readable pricing, so a Guest is told what they are paying for. */
  bracket: string
}

/**
 * Every reason a price cannot be produced, named.
 *
 * The message a *Guest* sees is deliberately separate from the cause: several of
 * these are the estate's own configuration being wrong, and telling a Guest that
 * the rate document is malformed is both unfixed-by-them and information about
 * the server. The cause goes to the log and to the Admin's verification report.
 */
export type QuoteCause =
  | 'REQUEST_SHAPE'
  | 'NOT_A_STANDARD_STAY'
  | 'LEAD_TIME'
  | 'PUBLISHED_RATES_MISSING'
  | 'PUBLISHED_RATES_MALFORMED'
  | 'ACCOMMODATION_UNKNOWN'
  | 'ACCOMMODATION_INACTIVE'
  | 'NO_PUBLISHED_RATE'
  | 'GUEST_COUNT_UNPRICED'
  | 'EXTRAS_UNPRICED'
  | 'NO_DOWN_PAYMENT_PUBLISHED'

export interface QuoteRefusal {
  ok: false
  cause: QuoteCause
  /** What an Admin is shown: precise, and points at the thing to fix. */
  detail: string
  /** What a Guest is shown: actionable, and says nothing about the server. */
  guestMessage: string
  /** Mapped onto an HTTPS callable error code by `functions-https.ts`. `internal` is for
  a defect the Guest can neither see nor fix; everything else is the Guest's input
  (`invalid-argument`) or the estate's own publication (failed-precondition/unavailable). */
  status: 'invalid-argument' | 'failed-precondition' | 'unavailable' | 'internal'
}

export type QuoteResult = { ok: true; quote: DerivedQuote } | QuoteRefusal

const DAY_MS = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const GUEST_MESSAGES: Record<QuoteCause, string> = {
  REQUEST_SHAPE: 'We could not read the dates or the party size you sent. Please check the form and try again.',
  NOT_A_STANDARD_STAY: 'That stay is not one we can quote online. Please contact the Hacienda.',
  LEAD_TIME: 'Those dates are too soon to book.',
  PUBLISHED_RATES_MISSING: 'Prices are being updated right now, so we cannot take a booking this minute. Please try again shortly.',
  PUBLISHED_RATES_MALFORMED: 'Prices are being updated right now, so we cannot take a booking this minute. Please try again shortly.',
  ACCOMMODATION_UNKNOWN: 'That unit is not one we can book online. Please choose from the page and try again.',
  ACCOMMODATION_INACTIVE: 'That unit is not taking bookings for those dates.',
  NO_PUBLISHED_RATE: 'That unit has no published price yet, so we cannot take a booking for it online.',
  GUEST_COUNT_UNPRICED: 'That party size is outside what this unit takes. Please adjust the guest count.',
  EXTRAS_UNPRICED: 'That extra is not something we can price online. Please note it in your request instead.',
  NO_DOWN_PAYMENT_PUBLISHED: 'We could not confirm the deposit for this stay. Please try again shortly.',
}

function refuse(cause: QuoteCause, detail: string, status: QuoteRefusal['status'] = 'failed-precondition'): QuoteRefusal {
  return { ok: false, cause, detail, guestMessage: GUEST_MESSAGES[cause], status }
}

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/**
 * The Guest-supplied half of a quote request, checked before anything is computed.
 *
 * Only the parts a Guest legitimately chooses are read at all — which unit, which
 * dates, how many people, which extras. Any money in the request is *ignored*, not
 * merely rejected: the price is this function's to produce, and a caller that could
 * nudge it even once would put the gap back.
 */
export function parseQuoteRequest(raw: unknown): { ok: true; value: QuoteRequest } | QuoteRefusal {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return refuse('REQUEST_SHAPE', 'the request must be an object', 'invalid-argument')
  }
  const body = raw as Record<string, unknown>
  const accommodation = typeof body.accommodation === 'string' ? body.accommodation.trim() : ''
  const checkIn = typeof body.check_in === 'string' ? body.check_in.trim() : ''
  const checkOut = typeof body.check_out === 'string' ? body.check_out.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(accommodation)) {
    return refuse('REQUEST_SHAPE', '`accommodation` must be a canonical id (lowercase letters, digits, hyphens)', 'invalid-argument')
  }
  for (const [name, value] of [['check_in', checkIn], ['check_out', checkOut]] as const) {
    if (!ISO_DATE.test(value)) {
      return refuse('REQUEST_SHAPE', `\`${name}\` must be YYYY-MM-DD`, 'invalid-argument')
    }
    // V8's ISO parser *rolls an impossible day over* instead of rejecting it —
    // `2026-02-30` comes back as 2 March — and a rolled date would be silently
    // priced for a night the Guest never asked for. Round-tripping is the check.
    const parsed = Date.parse(`${value}T00:00:00Z`)
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
      return refuse('REQUEST_SHAPE', `\`${name}\` is not a real date`, 'invalid-argument')
    }
  }
  if (!isWhole(body.guests) || (body.guests as number) < 1 || (body.guests as number) > 100) {
    return refuse('REQUEST_SHAPE', '`guests` must be a whole number from 1 to 100', 'invalid-argument')
  }
  // Absent means none. A number here that is not a whole non-negative count is a
  // refusal, not a zero: silently dropping a declared pet would price a stay that
  // the Admin later finds has one.
  const counts: Partial<Record<'pet_count' | 'late_checkout_hours', number>> = {}
  for (const key of ['pet_count', 'late_checkout_hours'] as const) {
    const value = body[key]
    if (value === undefined || value === null) {
      counts[key] = 0
      continue
    }
    if (!isWhole(value) || (value as number) < 0 || (value as number) > 999) {
      return refuse('REQUEST_SHAPE', `\`${key}\` must be a whole number of hours or pets, or be absent`, 'invalid-argument')
    }
    counts[key] = value as number
  }
  return {
    ok: true,
    value: {
      accommodation,
      check_in: checkIn,
      check_out: checkOut,
      guests: body.guests as number,
      pet_count: counts.pet_count ?? 0,
      late_checkout_hours: counts.late_checkout_hours ?? 0,
    },
  }
}

/**
 * The price of a stay, from the document the Admin published.
 *
 * `now` is `Date.now()` from the *server*, and it is what the lead time is
 * measured against — a Guest's clock cannot lengthen or shorten the 30 days, and
 * neither can a quote be issued for a date the rules would refuse.
 */
export function deriveQuote(
  ratesDocument: unknown,
  request: QuoteRequest,
  options: { now: number; bookingConfig?: unknown } = { now: Date.now() },
): QuoteResult {
  const minimumLeadTimeDays = configuredBookingLeadTimeDays(options.bookingConfig)
  if (ratesDocument === null || ratesDocument === undefined) {
    return refuse('PUBLISHED_RATES_MISSING', 'site_config/rates does not exist')
  }
  const problems = validatePublishedRates(ratesDocument)
  if (problems.length > 0) {
    const list = problems.slice(0, 4).map((p) => `${p.path || '(document)'} ${p.message}`).join('; ')
    return refuse('PUBLISHED_RATES_MALFORMED', `the published rates document is not publishable: ${list}`, 'unavailable')
  }
  const rates = ratesDocument as PublishedRates

  // The same validator the submit path runs and the same rule the write enforces,
  // so a quote can never be issued for a date the Booking write would refuse.
  const leadTime = validateMinimumBookingLeadTime(request.check_in, new Date(options.now), minimumLeadTimeDays)
  if (!leadTime.ok) {
    return refuse('LEAD_TIME', `check_in ${request.check_in}: ${leadTime.reason}`, 'invalid-argument')
  }
  const nights = Math.round((Date.parse(`${request.check_out}T00:00:00Z`) - Date.parse(`${request.check_in}T00:00:00Z`)) / DAY_MS)
  if (nights !== 1) {
    return refuse('NOT_A_STANDARD_STAY', `a quote is one 22-hour standard stay; the range asked for is ${nights} night(s)`, 'invalid-argument')
  }

  const figures = (rates.accommodations as Record<string, unknown>)[request.accommodation]
  if (figures === undefined) {
    return refuse('ACCOMMODATION_UNKNOWN', `${request.accommodation} has no entry in the published document`, 'invalid-argument')
  }
  if ((figures as { active?: boolean }).active === false) {
    return refuse('ACCOMMODATION_INACTIVE', `${request.accommodation} is published inactive`)
  }

  const quoted = quoteAccommodation(rates, request.accommodation, {
    check_in: request.check_in,
    check_out: request.check_out,
    guests: request.guests,
    pet_count: request.pet_count,
    late_checkout_hours: request.late_checkout_hours,
  })
  // `quoteAccommodation` answers "no price" for several distinct reasons, and one of
  // them — a party outside the published tiers — is a Guest-correctable mistake the
  // website already has words for. The checks below exist only to name the cause
  // when the shared module refused; the figure itself never comes from this code.
  type Schedule = { min_guests: number; base_max_guests: number; max_guests?: number; excess_per_guest?: number }
  const classification = classifyRateDate(request.check_in, rates.holiday_dates)
  const schedule = classification === undefined
    ? undefined
    : (figures as { guest_pricing?: Partial<Record<'weekday' | 'weekend_holiday', Schedule>> }).guest_pricing?.[classification]
  if (!quoted) {
    if (classification === undefined) {
      return refuse('PUBLISHED_RATES_MALFORMED', 'the check-in date could not be classified against the published holiday list', 'internal')
    }
    if (schedule === undefined) {
      return refuse('EXTRAS_UNPRICED', `${request.accommodation} publishes no ${classification} schedule as a minimum/included/cap band`, 'failed-precondition')
    }
    if (request.guests < schedule.min_guests
      || (schedule.max_guests !== undefined && request.guests > schedule.max_guests)
      || (request.guests > schedule.base_max_guests && schedule.excess_per_guest === undefined)) {
      return refuse(
        'GUEST_COUNT_UNPRICED',
        `${request.guests} guests is outside ${request.accommodation}/${classification} (included up to ${schedule.base_max_guests}, cap ${schedule.max_guests ?? 'none'}, excess ${schedule.excess_per_guest ?? 'none'})`,
        'invalid-argument',
      )
    }
    if (request.pet_count > 0 || request.late_checkout_hours > 0) {
      return refuse(
        'EXTRAS_UNPRICED',
        `pets ${request.pet_count} / late checkout ${request.late_checkout_hours}h are not publishable extras (pet_policy ${JSON.stringify(rates.pet_policy ?? null)}, late_checkout_per_hour ${rates.late_checkout_per_hour ?? 'absent'})`,
        'invalid-argument',
      )
    }
    return refuse(
      'NO_PUBLISHED_RATE',
      `quoteAccommodation refused ${request.accommodation} for ${request.check_in} at ${request.guests} guest(s) for a reason the checks above did not name`,
      'failed-precondition',
    )
  }


  const option = paymentOptionsForTotal(quoted.stayTotal, quoted.rateCard).find((o) => o.plan === 'down-payment')
  if (!option) {
    return refuse(
      'NO_DOWN_PAYMENT_PUBLISHED',
      `${request.accommodation} publishes no down-payment plan (down_payment_percent ${quoted.rateCard.downPaymentPercent ?? 'absent'})`,
    )
  }

  return {
    ok: true,
    quote: {
      request,
      rates_version: rates.version,
      bracket: quoted.bracket,
      money: {
        rate_unit: 'standard_stay',
        rate_amount: quoted.addons.rateAmount,
        rate_classification: quoted.classification,
        nights: 1,
        stay_total: quoted.stayTotal,
        amount_due: option.dueNow,
        balance_due: option.balance,
        security_deposit: quoted.rateCard.securityDeposit,
        payment_plan: 'down-payment',
        policy_version: rates.version,
        policy_effective_date: rates.effective_date,
        refund_policy_snapshot: rates.refund === undefined ? null : (rates.refund as PublishedRefundPolicy),
      },
    },
  }
}

/** The keys a quote attests, and therefore the keys a Booking must match. */
export const ATTESTED_KEYS = [
  'accommodation', 'check_in', 'check_out', 'guests', 'pet_count', 'late_checkout_hours',
  'rate_unit', 'rate_amount', 'rate_classification', 'nights', 'stay_total', 'amount_due',
  'balance_due', 'security_deposit', 'payment_plan', 'policy_version', 'policy_effective_date',
  'refund_policy_snapshot',
] as const

/** A quote's own identity: the same request under the same document hashes the same. */
export function quotePayload(request: QuoteRequest, ratesVersion: string): string {
  return JSON.stringify({ ...request, rates_version: ratesVersion })
}

/**
 * Every way a stored Booking diverges from its quote, named.
 *
 * This is the approval-side check the ADR asks for, and it is deliberately a
 * *list*: an Admin who is told "one number is wrong" cannot tell a rounding bug
 * from a forgery, and refuses both the same way.
 */
export function moneyMismatches(stored: Record<string, unknown>, quote: { request: QuoteRequest; money: AuthoritativeMoney }): string[] {
  const expected: Record<string, unknown> = { ...quote.request, ...quote.money }
  const found: string[] = []
  for (const key of ATTESTED_KEYS) {
    const want = expected[key]
    const have = stored[key]
    if (typeof want === 'number' || typeof have === 'number') {
      // Floats on a Firestore document are not bit-exact across a JSON round
      // trip; centavos are the smallest unit the estate prices in.
      const asCents = (value: unknown) => Math.round(Number(value) * 100)
      if (!Number.isFinite(Number(have)) || asCents(have) !== asCents(want)) found.push(key)
      continue
    }
    if (JSON.stringify(have ?? null) !== JSON.stringify(want ?? null)) found.push(key)
  }
  return found
}

/** Is the Booking's own stamp on the document it was quoted from still current? */
export function ratesVersionDrift(stored: Record<string, unknown>, currentVersion: string): boolean {
  return typeof stored.policy_version === 'string' && stored.policy_version !== currentVersion
}

