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
export type AccommodationRates = {
  /** Philippine pesos per night. */
  nightly_rate: number
  /** Refundable amount held against damage, settled at check-out. */
  security_deposit: number
  /** Down-payment percentage; omitted means full payment only. */
  down_payment_percent?: number
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
export type PublishedRates = {
  /** Which policy version this is. Stamped on the Booking at choice time. */
  version: string
  /** When this version took effect (ISO date, YYYY-MM-DD). */
  effective_date: string
  /** Figures per Accommodation id; accommodations absent here have no machine price. */
  accommodations: Record<string, AccommodationRates>
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

/** Validate one Accommodation's figures. */
function accommodationProblems(accommodationId: string, node: unknown): RatesProblem[] {
  const problems: RatesProblem[] = []
  if (typeof node !== 'object' || node === null) {
    problems.push({ path: `accommodations.${accommodationId}`, message: 'must be an object of figures.' })
    return problems
  }
  const rates = node as Record<string, unknown>

  if (!isFiniteNumber(rates.nightly_rate) || rates.nightly_rate <= 0) {
    problems.push({
      path: `accommodations.${accommodationId}.nightly_rate`,
      message: 'must be a number of pesos per night, greater than zero.',
    })
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
  if (!figures) return undefined
  return {
    rateCard: {
      nightlyRate: figures.nightly_rate,
      securityDeposit: figures.security_deposit,
      ...(figures.down_payment_percent !== undefined ? { downPaymentPercent: figures.down_payment_percent } : {}),
    },
    policy: doc.refund !== undefined ? toRefundPolicy(doc.refund) : undefined,
    snapshot: { version: doc.version, effectiveDate: doc.effective_date },
  }
}

/** The recorded figures, as the money module's roundMoney would store them. */
export function quotedStayTotal(doc: PublishedRates, accommodationId: string, nights: number): number | undefined {
  const figures = doc.accommodations[accommodationId]
  if (!figures) return undefined
  return roundMoney(Math.max(1, nights) * figures.nightly_rate)
}
