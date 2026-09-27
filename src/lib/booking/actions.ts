// ----------------------------------------------------------------------------
// Booking lifecycle — actions
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The one place a Booking's state changes. Every action is checked against the
// legal transitions, the actor allowed to take it, and the facts it depends on
// (dates still free, money verified), and every accepted action
// returns the Activity log entries it owes — so a transition cannot happen
// unlogged (spec #9).
//
// This is an internal file of the `src/lib/booking` module: callers and tests
// go through `src/lib/booking`, never through here directly.
// ----------------------------------------------------------------------------

import { canTransition, normalizeStatus, type BookingStatus } from './statuses'
import { effectiveStatus, findDateConflicts, type HoldBearingBooking } from './availability'
import {
  paymentOptions,
  paymentOptionsForTotal,
  settleRefund,
  type RateCard,
  type RefundPolicy,
  type RefundSettlement,
} from './money'
import { roundMoney } from './internal'
import type { PaymentPlan } from './money'
import type { PolicySnapshot } from './rates'

export type PaymentStatus = 'unpaid' | 'pending' | 'verified' | 'rejected'
export type RefundStatus = 'none' | 'initiated' | 'refunded'

/** Who a Booking is, as far as the lifecycle is concerned. */
export type BookingState = {
  id: string
  ref_id?: string
  accommodation: string
  check_in: string
  check_out: string
  guests?: number
  status: BookingStatus | string
  /** Why the Admin refused this Booking at review. */
  rejection_reason?: string | null
  payment_plan?: PaymentPlan
  payment_status?: PaymentStatus | string
  /**
   * Where the proof bytes live: a Supabase Storage path in cloud mode, a
   * local demo-mode path otherwise (ADR-0011). Dual-written with
   * `payment_proof_url`, which stays canonical for verification.
   */
  payment_proof_url?: string | null
  paymentProofUrl?: string | null
  /** The reference number OCR read off the receipt, as extracted (never verified). */
  extractedRefNumber?: string | null
  payment_reject_reason?: string | null
  /** What the Guest says they sent, before the Admin verifies it. */
  amount_claimed?: number
  payment_reference?: string
  ocr_reference?: string
  ocr_amount?: string
  payment_verified_at?: string | null
  payment_verified_by?: string | null
  stay_total?: number
  amount_due?: number
  security_deposit?: number
  balance_due?: number
  amount_verified?: number
  refund_status?: RefundStatus | string
  refund_total?: number
  refund_breakdown?: RefundSettlement | null
  cancellation_reason?: string | null
  /**
   * The published policy version in force when the Guest chose their payment
   * plan, stamped so a later republish changes the terms of future choices
   * only — never the refund terms of a stay already promised. Null when the
   * Admin had published nothing: that refunds nothing, which is what an
   * unpublished policy amounts to.
   */
  policy_version?: string | null
  /** When the stamped policy version took effect (YYYY-MM-DD). */
  policy_effective_date?: string | null
  hold_expires_at?: string | null
  created_at?: string
}

/** The fields an accepted action changes. Absent means untouched. */
export type BookingPatch = Partial<Omit<BookingState, 'id' | 'ref_id' | 'created_at'>>

export type ActorKind = 'guest' | 'admin' | 'system'

/** Who is acting. The Activity log is worthless without this. */
export type Actor = {
  actor: ActorKind
  actor_id: string
  actor_name?: string
  /** Read-time instant for every date rule. Defaults to the moment of the call. */
  now?: string | number | Date
}

export type AvailabilityCheck = {
  /** Bookings already stored for this Accommodation. */
  bookings: readonly HoldBearingBooking[]
  /** Units of the Accommodation that can be held at once. */
  unitsAvailable?: number
}

export type BookingAction =
  | { type: 'Approve'; availability: AvailabilityCheck }
  | { type: 'Reject'; reason: string }
  | {
      type: 'ChoosePaymentPlan'
      plan: PaymentPlan
      /** The Admin's published figures; the stay is quoted from them when no total is recorded. */
      rateCard?: RateCard
      /** The quoted stay total, when the quote is a recorded number rather than a card quote. */
      stayTotal?: number
      /** The deposit and down-payment percent, when quoting from a recorded total. */
      rate?: Pick<RateCard, 'securityDeposit' | 'downPaymentPercent'>
      /** The published policy in force at choice time; stamped on the Booking so a later republish cannot change this stay's refund terms. */
      policy?: PolicySnapshot
    }
  | {
      type: 'UploadPaymentProof'
      payment_proof_url: string
      /** Storage path twin of `payment_proof_url` (ADR-0011). */
      paymentProofUrl?: string
      /** OCR-extracted reference kept alongside the proof (never verified). */
      extractedRefNumber?: string
      amount_claimed?: number
      payment_reference?: string
      ocr_reference?: string
      ocr_amount?: string
    }
  | { type: 'VerifyPayment'; amount_verified: number }
  | { type: 'RejectPaymentProof'; reason: string; guestResubmits: boolean }
  | {
      type: 'Cancel'
      reason?: string
      /** Required to settle a Refund once money has been verified. */
      refund?: { rateCard?: RateCard; policy?: RefundPolicy; damageDeduction?: number }
    }
  | { type: 'MarkRefunded' }
  | { type: 'RevokeKey' }
  | { type: 'Expire' }
  | { type: 'CheckIn' }
  | { type: 'BeginStay' }
  | { type: 'CheckOut' }
  | { type: 'Complete' }

/**
 * Every action name the Activity log can carry.
 *
 * `Submit` is not a transition — it is the creation of the Booking itself, which
 * is a state change like any other and is logged the same way (spec #9: the log
 * is written by the state change, not by the UI that triggered it).
 *
 * `SetStatus` is not an action anybody can take: it is what the store records
 * when a caller writes a status straight past the lifecycle, which the Admin
 * dashboard still does today. It exists so that no status change is unlogged;
 * ticket #13 moves those writes onto the actions above and retires it.
 */
export type ActionType = BookingAction['type'] | 'Submit' | 'SetStatus'

/** One Activity log entry. Append-only: nothing in the system edits or deletes these. */
export type ActivityLogEntry = {
  booking_id: string
  action: ActionType
  from_status: BookingStatus
  to_status: BookingStatus
  actor: ActorKind
  actor_id: string
  actor_name?: string
  at: string
  reason?: string
  /**
   * Position in this Booking's log, assigned as the entry is appended.
   *
   * Two state changes can share an instant — a Guest's upload and the Admin's
   * approval inside the same millisecond — and the Admin still has to read them
   * in the order they happened, so the order cannot rest on the timestamp alone.
   */
  seq?: number
}

export type ActionAccepted = {
  ok: true
  patch: BookingPatch
  /** Entries the caller must append to the Activity log, in order. */
  entries: ActivityLogEntry[]
}

export type ActionRefused = {
  ok: false
  /** Plain-language reason, safe to show the Guest or the Admin. */
  reason: string
  /** Set when the refusal is a date clash, so the Admin can suggest alternatives. */
  conflicts?: HoldBearingBooking[]
}

export type ActionResult = ActionAccepted | ActionRefused

/**
 * The interface each action presents: who may take it, which statuses it needs,
 * and which status it produces. `stays` means the action records something
 * without moving the Booking (a resubmitted ID, an uploaded Payment proof).
 */
const ACTION_RULES: Record<
  BookingAction['type'],
  { actors: readonly ActorKind[]; from: readonly BookingStatus[]; to: BookingStatus | 'stays' }
> = {
  // The Admin's review lands directly on `Payment Pending`: with Government ID
  // KYC gone, approving a Booking *is* opening it for payment (ADR-0001 —
  // nothing moves before the Admin has said yes).
  Approve: { actors: ['admin'], from: ['Pending'], to: 'Payment Pending' },
  // `Payment Pending` covers everything the pre-KYC `Approved` stage covered:
  // an approved Booking the Guest has not paid for yet, and one whose proof is
  // already in — rejecting either is a pre-money rejection.
  Reject: { actors: ['admin'], from: ['Pending', 'Payment Pending'], to: 'Rejected' },
  ChoosePaymentPlan: { actors: ['guest'], from: ['Payment Pending'], to: 'stays' },
  UploadPaymentProof: { actors: ['guest'], from: ['Payment Pending'], to: 'stays' },
  VerifyPayment: { actors: ['admin'], from: ['Payment Pending'], to: 'Reserved' },
  RejectPaymentProof: { actors: ['admin'], from: ['Payment Pending'], to: 'stays' },
  Cancel: {
    actors: ['guest', 'admin'],
    from: ['Pending', 'Payment Pending', 'Reserved'],
    to: 'Cancelled',
  },
  // Flow §2 step 11: the Refund pipeline ends when the money is back with the
  // Guest. The Booking stays Cancelled; the Refund is what moves.
  MarkRefunded: { actors: ['admin'], from: ['Cancelled'], to: 'stays' },
  // An access decision, not a lifecycle move: the Admin pulls the Credential
  // from a stay that is live. The Booking does not move; the lock's allowlist
  // entry is removed on the next physical touch (first hardware generation),
  // and the log records who decided and when.
  RevokeKey: { actors: ['admin'], from: ['Reserved', 'Checked-In', 'Staying'], to: 'stays' },
  Expire: { actors: ['system'], from: ['Pending'], to: 'Expired' },
  // The first successful Credential use on the check-in day (flow §3 step 6).
  CheckIn: { actors: ['system', 'admin'], from: ['Reserved'], to: 'Checked-In' },
  BeginStay: { actors: ['system', 'admin'], from: ['Checked-In'], to: 'Staying' },
  CheckOut: { actors: ['system', 'admin'], from: ['Staying'], to: 'Checked-Out' },
  // Only once cleaning and inspection have passed (flow §5 step 10). The Admin
  // records it — there is no separate Staff role (ADR-0007).
  Complete: { actors: ['admin', 'system'], from: ['Checked-Out'], to: 'Completed' },
}

/**
 * Is this move legal for an action to make?
 *
 * Mostly one step along the lifecycle, with one exception: verifying a Payment
 * proof records Payment Verified and lands the Booking on Reserved in the same
 * action, because Payment Verified is a fact the Admin recorded rather than a
 * place a Booking rests (CONTEXT.md § Booking status).
 */
function isLegalMove(from: BookingStatus, to: BookingStatus): boolean {
  if (canTransition(from, to)) return true
  return (
    from === 'Payment Pending' &&
    to === 'Reserved' &&
    canTransition('Payment Pending', 'Payment Verified') &&
    canTransition('Payment Verified', 'Reserved')
  )
}

function refuse(reason: string, conflicts?: HoldBearingBooking[]): ActionRefused {
  return conflicts ? { ok: false, reason, conflicts } : { ok: false, reason }
}

/**
 * The ISO instant an actor's action is recorded at: the `now` they passed, or the
 * moment of the call. Every date rule in this module reasons from this, so a
 * caller — or a test — can pin the instant instead of racing the clock.
 */
export function instantOf(actor: Pick<Actor, 'now'>): string {
  return new Date(actor.now === undefined ? Date.now() : actor.now).toISOString()
}

/**
 * Take one action on a Booking.
 *
 * Pure: the Booking given in is never mutated. An accepted action returns the
 * patch to store and the Activity log entries to append; a refused one returns
 * a reason safe to show whoever asked.
 */
export function applyAction(booking: BookingState, action: BookingAction, actor: Actor): ActionResult {
  const rule = ACTION_RULES[action.type]
  const from = normalizeStatus(booking.status)
  const at = instantOf(actor)

  if (!rule.actors.includes(actor.actor)) {
    return refuse(`A ${actor.actor} cannot ${action.type} a Booking — only ${join(rule.actors)} can.`)
  }

  // A Booking whose Date hold ran out reads as Expired before anything else is
  // checked, so no surface can act on dates that are already back in the pool.
  // Only a recorded expiry counts here: a Booking stored before holds existed has
  // no countdown to run out, and refusing the Admin's review of it would strand it
  // forever. Availability still treats that Booking as holding nothing.
  if (action.type !== 'Expire' && booking.hold_expires_at && effectiveStatus(booking, at) === 'Expired') {
    return refuse(
      `This Booking's Date hold ran out at ${booking.hold_expires_at}; it reads as Expired and its dates are free again.`,
    )
  }

  if (!rule.from.includes(from)) {
    return refuse(`${action.type} needs a Booking in ${join(rule.from)} — this one is ${from}.`)
  }

  const to = rule.to === 'stays' ? from : rule.to
  if (to !== from && !isLegalMove(from, to)) {
    return refuse(`A Booking cannot move from ${from} to ${to}.`)
  }

  const patch: BookingPatch = {}
  let reason: string | undefined

  switch (action.type) {
    case 'Approve': {
      // G2: the system re-checks availability at approval, not the Admin's eyeball.
      const conflicts = findDateConflicts(booking, action.availability.bookings, {
        unitsAvailable: action.availability.unitsAvailable,
        now: at,
        excludeId: booking.id,
        forApproval: true,
      })
      if (conflicts.length > 0) {
        return refuse(
          'These dates are already held by another Booking, so this one cannot be approved. Offer the Guest alternative dates.',
          conflicts,
        )
      }
      // Approval means the dates are firmly held: the countdown stops here.
      patch.hold_expires_at = null
      break
    }

    case 'Reject': {
      if (!action.reason.trim()) return refuse('A rejection has to say why, so the Guest knows what to fix.')
      reason = action.reason
      patch.rejection_reason = action.reason
      break
    }

    case 'ChoosePaymentPlan': {
      // The money the Guest commits to must come from a quote: from the
      // published card when the Admin has one, from the recorded total when the
      // quote is a number the Booking carries (the card for this property is
      // not yet a machine-readable document). Neither is published — there is
      // no price to commit the Guest to, so the choice is refused.
      let option: ReturnType<typeof paymentOptions>[number] | undefined
      if (action.stayTotal !== undefined) {
        option = paymentOptionsForTotal(action.stayTotal, action.rate ?? { securityDeposit: 0 }).find(
          (o) => o.plan === action.plan,
        )
      } else if (action.rateCard) {
        option = paymentOptions(booking, action.rateCard).find((o) => o.plan === action.plan)
      }
      if (!option) {
        return refuse('The Admin has not published that payment option for this Accommodation.')
      }
      patch.payment_plan = option.plan
      patch.payment_status = 'pending'
      patch.stay_total = option.stayTotal
      patch.amount_due = option.dueNow
      patch.security_deposit = option.securityDeposit
      patch.balance_due = option.balance
      // The policy in force is stamped with the choice: republishing later
      // changes the terms of future choices, never of a stay already promised.
      // A Booking chosen under no published policy carries nulls and refunds
      // nothing — which is what an unpublished policy amounts to.
      patch.policy_version = action.policy?.version ?? null
      patch.policy_effective_date = action.policy?.effectiveDate ?? null
      break
    }

    case 'UploadPaymentProof': {
      // A Payment proof is submitted whole or not at all. The photo, the
      // reference read off it and the amount it claims are all the Admin has to
      // go on — the Admin's Verify Payment acts on this Booking and can see
      // nothing the Guest did not put here — so a half-submitted Payment proof
      // is refused rather than stored as a photo and a hope. The rule lives in
      // the lifecycle, not in the form that happens to ask for these three.
      if (!action.payment_proof_url.trim()) return refuse('Payment proof has to be attached before it can be verified.')
      const reference = action.payment_reference?.trim() ?? ''
      if (!reference) return refuse('Enter the payment reference number from the Payment proof.')
      if (!action.amount_claimed || !(action.amount_claimed > 0)) {
        return refuse('Enter the amount the Payment proof claims, so the Admin has something to check it against.')
      }
      patch.payment_proof_url = action.payment_proof_url
      patch.paymentProofUrl = action.paymentProofUrl ?? action.payment_proof_url
      if (action.extractedRefNumber) patch.extractedRefNumber = action.extractedRefNumber
      patch.payment_status = 'pending'
      patch.amount_claimed = action.amount_claimed
      patch.payment_reference = reference
      if (action.ocr_reference) patch.ocr_reference = action.ocr_reference
      if (action.ocr_amount) patch.ocr_amount = action.ocr_amount
      if (booking.payment_reject_reason) patch.payment_reject_reason = null
      break
    }

    case 'VerifyPayment': {
      if (!booking.payment_proof_url) return refuse('There is no Payment proof to verify yet.')
      if (!(action.amount_verified > 0)) return refuse('The verified amount has to be more than zero.')
      // Verifying less than the Guest was asked for would make Reserved a lie,
      // so an underpayment is refused rather than quietly accepted.
      const owed = roundMoney((booking.amount_due ?? 0) + (booking.security_deposit ?? 0))
      if (owed > 0 && action.amount_verified < owed) {
        return refuse(`The proof covers ${action.amount_verified} but ${owed} is due — verify only a payment that covers it.`)
      }
      // Reserved is the first status a Guest can truly rely on (ADR-0001).
      patch.payment_status = 'verified'
      patch.amount_verified = action.amount_verified
      patch.payment_verified_at = at
      patch.payment_verified_by = actor.actor_id
      break
    }

    case 'RejectPaymentProof': {
      if (!action.reason.trim()) return refuse('Say why the Payment proof was rejected, so the Guest can resend the right one.')
      reason = action.reason
      patch.payment_status = 'rejected'
      patch.payment_reject_reason = action.reason
      if (action.guestResubmits) {
        // The Guest sends another proof inside the same Payment Pending stage.
        patch.payment_proof_url = null
        patch.paymentProofUrl = null
        patch.extractedRefNumber = null
        break
      }
      // Flow §2 step 9: no verified money yet, so there is nothing to refund.
      patch.status = 'Cancelled'
      patch.refund_status = 'none'
      break
    }

    case 'Cancel': {
      reason = action.reason
      patch.cancellation_reason = action.reason ?? null
      if (from === 'Reserved') {
        // Money was verified, so the cancellation goes through the Refund pipeline.
        const settlement = settleRefund(booking, action.refund?.policy ?? {}, {
          cancelledAt: at,
          rateCard: action.refund?.rateCard,
          stay_total: booking.stay_total,
          security_deposit: booking.security_deposit,
          verifiedAmount: booking.amount_verified,
          damageDeduction: action.refund?.damageDeduction,
        })
        patch.refund_status = 'initiated'
        patch.refund_total = settlement.refundTotal
        patch.refund_breakdown = settlement
      } else {
        patch.refund_status = 'none'
      }
      break
    }

    case 'MarkRefunded': {
      if (normalizeRefund(booking.refund_status) !== 'initiated') {
        return refuse('There is no Refund waiting on this Booking to mark as returned.')
      }
      reason = 'Refund returned to the Guest.'
      patch.refund_status = 'refunded'
      break
    }

    case 'RevokeKey': {
      // Nothing moves on the Booking: the Admin is pulling the Credential off a
      // stay that is live. The lock's allowlist entry leaves on the next
      // physical touch; what is stored is the decision, and who made it.
      reason = 'Credential revoked by the Admin.'
      break
    }

    case 'Expire': {
      if (!isExpireDue(booking, at)) {
        return refuse(
          booking.hold_expires_at
            ? "This Booking's Date hold has not run out yet."
            : 'This Booking has no Date hold recorded, so there is no expiry to write.',
        )
      }
      reason = 'Date hold ran out before the Admin reviewed the Booking.'
      break
    }

    case 'CheckIn':
    case 'BeginStay':
    case 'CheckOut':
    case 'Complete':
      break
  }

  // An action may set the status itself (a rejected Payment proof that is never
  // resent cancels the Booking); otherwise the transition rule decides it.
  const toStatus: BookingStatus = patch.status === undefined ? to : normalizeStatus(patch.status)
  patch.status = toStatus

  const entries: ActivityLogEntry[] = [
    {
      booking_id: booking.id,
      action: action.type,
      from_status: from,
      to_status: toStatus,
      actor: actor.actor,
      actor_id: actor.actor_id,
      ...(actor.actor_name ? { actor_name: actor.actor_name } : {}),
      at,
      ...(reason ? { reason } : {}),
    },
  ]

  return { ok: true, patch, entries }
}

/**
 * Is the read-time expiry rule actually due on this Booking?
 *
 * `Expire` only materialises what every surface already reads (ADR-0002): it is
 * refused while the Date hold still has time left, and refused once the Admin has
 * acted, because an approved Booking's dates are firmly held.
 */
function isExpireDue(booking: BookingState, at: string): boolean {
  return effectiveStatus(booking, at) === 'Expired'
}

function normalizeRefund(status: RefundStatus | string | undefined): RefundStatus {
  switch ((status ?? 'none').toString().toLowerCase()) {
    case 'initiated':
      return 'initiated'
    case 'refunded':
      return 'refunded'
    default:
      return 'none'
  }
}

function join(values: readonly string[]): string {
  return values.length === 1 ? values[0] : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`
}
