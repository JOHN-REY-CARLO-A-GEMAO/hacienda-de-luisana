// ----------------------------------------------------------------------------
// Booking lifecycle — money
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// Rates, payment options, and Security deposit / Refund arithmetic.
//
// The Host still owes the system a real rate card, a Security deposit amount and
// cancellation percentages (spec #9, Further Notes). Nothing here invents them:
// every figure is an argument, and a policy the Host has not published refunds
// nothing rather than guessing in either party's favour.
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------

import { DAY_MS, parseDate, parseInstant, roundMoney } from './internal'
import { nightsBetween } from './availability'

/** The Host's published figures for one Accommodation. */
export type RateCard = {
  /** Philippine pesos per night. */
  nightlyRate: number
  /** Refundable amount held against damage, settled at check-out. */
  securityDeposit: number
  /** Down-payment percentage offered alongside full payment; omitted means full payment only. */
  downPaymentPercent?: number
}

/** One refund tier: cancel at least this many days before check-in, get this percentage back. */
export type RefundTier = {
  minDaysBeforeCheckIn: number
  refundPercent: number
}

/** The Host's published cancellation policy. */
export type RefundPolicy = {
  /** Flat percentage of the stay refunded on cancellation. */
  refundPercent?: number
  /** Tiered percentages, applied instead of `refundPercent` when published. */
  tiers?: RefundTier[]
  /** Percentage of the Security deposit returned; 100 unless the Host says otherwise. */
  depositRefundPercent?: number
}

/** The stay total for a date range under a rate card. */
export function quoteStay(dates: { check_in: string; check_out: string }, rateCard: RateCard): number {
  return roundMoney(nightsBetween(dates.check_in, dates.check_out) * rateCard.nightlyRate)
}

export type PaymentPlan = 'down-payment' | 'full'

export type PaymentOption = {
  plan: PaymentPlan
  stayTotal: number
  /** What the Guest sends now: the down payment or the whole stay. */
  dueNow: number
  /** The refundable Security deposit, on top of the stay. */
  securityDeposit: number
  /** What is still owed at or before the stay. */
  balance: number
}

/**
 * The payment choices for a stay total, under the Host's published figures.
 *
 * Flow §2 step 7: 50% down payment plus a refundable Security deposit, or full
 * payment plus the same deposit. The down payment is rounded down to whole
 * centavos so the Guest is never asked for more than the stay costs.
 */
function optionsFromTotal(
  stayTotal: number,
  rate: Pick<RateCard, 'securityDeposit' | 'downPaymentPercent'>,
): PaymentOption[] {
  const total = roundMoney(Math.max(0, stayTotal))
  const options: PaymentOption[] = []

  const percent = rate.downPaymentPercent
  if (typeof percent === 'number' && percent > 0 && percent < 100) {
    // Floor at whole centavos, off the quoted total, so the down payment and
    // the balance add back up to exactly what the Guest was quoted.
    const dueNow = Math.floor(roundMoney((total * percent) / 100) * 100) / 100
    options.push({
      plan: 'down-payment',
      stayTotal: total,
      dueNow,
      securityDeposit: rate.securityDeposit,
      balance: roundMoney(total - dueNow),
    })
  }

  options.push({
    plan: 'full',
    stayTotal: total,
    dueNow: total,
    securityDeposit: rate.securityDeposit,
    balance: 0,
  })

  return options
}

/**
 * The payment choices a Guest is offered once the Host has approved, quoted
 * from the rate card.
 */
export function paymentOptions(
  dates: { check_in: string; check_out: string },
  rateCard: RateCard,
): PaymentOption[] {
  return optionsFromTotal(quoteStay(dates, rateCard), rateCard)
}

/**
 * The payment choices for a stay whose total is already quoted and recorded.
 *
 * The Host's rate card for this property is not yet a machine-readable
 * document — a quote can be a phone call the Host made and the amount the
 * Booking carries. Quoting from the recorded total keeps the Guest's money
 * tied to the number they were actually offered, while the arithmetic stays
 * identical to quoting from a card: same flooring, same deposit, same balance.
 */
export function paymentOptionsForTotal(
  stayTotal: number,
  rate: Pick<RateCard, 'securityDeposit' | 'downPaymentPercent'>,
): PaymentOption[] {
  return optionsFromTotal(stayTotal, rate)
}

/**
 * The stay total for a Booking: quoted from the rate card when the Host has
 * published one, otherwise the amount recorded on the Booking when the Guest
 * chose their payment plan.
 */
export function stayQuote(
  dates: { check_in: string; check_out: string },
  money: { rateCard?: RateCard; stay_total?: number } = {},
): number {
  if (money.rateCard) return quoteStay(dates, money.rateCard)
  return roundMoney(Math.max(0, money.stay_total ?? 0))
}

export type RefundSettlement = {
  stayTotal: number
  stayRefund: number
  /** The Security deposit the system actually holds. */
  depositHeld: number
  /** The verified damage claim settled out of the deposit. */
  damageDeduction: number
  depositRefund: number
  refundTotal: number
}

export type RefundInput = {
  /** When the Booking was cancelled. Defaults to now. */
  cancelledAt?: string | number | Date
  /** The rate card to quote from; without one, the recorded amounts are used. */
  rateCard?: RateCard
  /** Stay total recorded on the Booking when the Guest chose their plan. */
  stay_total?: number
  /** Security deposit recorded on the Booking. */
  security_deposit?: number
  /** Money the Host verified for this Booking; caps the Refund. */
  verifiedAmount?: number
  /** A verified damage claim, settled against the Security deposit. */
  damageDeduction?: number
}

function refundPercentFor(policy: RefundPolicy, daysBeforeCheckIn: number): number {
  const tiers = policy.tiers
  if (!tiers || tiers.length === 0) return policy.refundPercent ?? 0
  const applicable = [...tiers]
    .sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn)
    .find((tier) => daysBeforeCheckIn >= tier.minDaysBeforeCheckIn)
  // No tier reached: the Host published no refund for cancelling this late.
  return applicable ? applicable.refundPercent : 0
}

/**
 * Settle the Refund for a cancelled Booking.
 *
 * The Security deposit is settled first — the damage claim is deducted from it
 * and the remainder is returned — then the stay is refunded by the policy tier
 * the cancellation date falls in. The total is capped at the money the Host
 * actually verified, and a deduction can never exceed the deposit held, so the
 * Guest is never billed beyond what they handed over.
 *
 * With no rate card and nothing recorded on the Booking, no money was ever
 * verified and nothing is refundable.
 */
export function settleRefund(
  dates: { check_in: string; check_out: string },
  policy: RefundPolicy = {},
  input: RefundInput = {},
): RefundSettlement {
  const stayTotal = stayQuote(dates, input)
  const cancelledAtMs = input.cancelledAt === undefined ? Date.now() : parseInstant(input.cancelledAt)
  const checkInMs = parseDate(dates.check_in)
  const daysBeforeCheckIn =
    checkInMs === null ? 0 : Math.max(0, Math.ceil((checkInMs - cancelledAtMs) / DAY_MS))

  const percent = refundPercentFor(policy, daysBeforeCheckIn)
  const depositPercent = policy.depositRefundPercent ?? 100
  const depositExpected = input.rateCard
    ? input.rateCard.securityDeposit
    : Math.max(0, input.security_deposit ?? 0)

  const verified = input.verifiedAmount === undefined ? stayTotal + depositExpected : input.verifiedAmount
  const capped = Math.max(0, Math.min(verified, stayTotal + depositExpected))

  // The deposit settles first, so a part-paid Booking still returns its deposit.
  const depositHeld = roundMoney(Math.min(depositExpected, capped))
  const damageDeduction = roundMoney(Math.max(0, Math.min(input.damageDeduction ?? 0, depositHeld)))
  const depositRefund = roundMoney((depositHeld - damageDeduction) * (depositPercent / 100))

  const roomForStay = Math.max(0, capped - depositHeld)
  const stayRefund = roundMoney(Math.min(stayTotal * (percent / 100), roomForStay))

  return {
    stayTotal,
    stayRefund,
    depositHeld,
    damageDeduction,
    depositRefund,
    refundTotal: roundMoney(stayRefund + depositRefund),
  }
}
