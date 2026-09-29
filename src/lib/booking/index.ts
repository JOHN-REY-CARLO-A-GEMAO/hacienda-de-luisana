// ----------------------------------------------------------------------------
// Booking lifecycle module — public interface
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// One deep module owning everything the Booking lifecycle knows: the canonical
// statuses and the legal transitions between them, date-overlap, the 24-hour
// Date hold and its read-time expiry, Security deposit / Refund arithmetic, and
// the actions that move a Booking while writing the Activity log.
//
// Nothing in here imports Firebase — the module is pure, so every slice of the
// booking lifecycle plan is tested through this interface (spec #9, ticket #10).
// Callers and tests import `src/lib/booking`; the files behind this entry point
// are implementation detail.
//
// Vocabulary: CONTEXT.md. Decisions respected here:
//   ADR-0012 — a Booking is submitted only with a downpayment screenshot, as
//              Pending, and is confirmed only when the Admin approves that proof.
//   ADR-0002 — Date hold expiry is a read-time rule, never a scheduled sweep.
// ----------------------------------------------------------------------------

export {
  BOOKING_STATUSES,
  canTransition,
  interpretStoredStatus,
  normalizeStatus,
  type BookingStatus,
} from './statuses'

export {
  DATE_HOLD_MS,
  approvalCouplingSet,
  datesOverlap,
  effectiveStatus,
  findDateConflicts,
  holdMsRemaining,
  holdsDates,
  isAvailable,
  isHoldExpirable,
  isHoldExpired,
  nightsBetween,
  suggestAlternativeDates,
  type AlternativeDateOptions,
  type AvailabilityOptions,
  type DateHoldFields,
  type DateRange,
  type HoldBearingBooking,
} from './availability'

export {
  downPaymentAmount,
  paymentOptions,
  paymentOptionsForTotal,
  quoteStay,
  settleRefund,
  stayQuote,
  type PaymentOption,
  type PaymentPlan,
  type RateCard,
  type RefundInput,
  type RefundPolicy,
  type RefundSettlement,
  type RefundTier,
} from './money'

export { describeActivity, type ActivityLine } from './activity'

export {
  ratesForAccommodation,
  quotedStayTotal,
  validatePublishedRates,
  type AccommodationRates,
  type PolicySnapshot,
  type PublishedRates,
  type PublishedRefundPolicy,
  type PublishedRefundTier,
  type RatesProblem,
} from './rates'

export { formatHoldCountdown, unitsForAccommodation, type UnitBearing } from './holds'

export { assertSubmittable, type SubmissionProof, type SubmissionReady } from './submit'

export {
  applyAction,
  instantOf,
  type ActionAccepted,
  type ActionRefused,
  type ActionResult,
  type ActionType,
  type ActivityActionType,
  type ReviewActionType,
  type ActivityLogEntry,
  type Actor,
  type ActorKind,
  type AvailabilityCheck,
  type BookingAction,
  type BookingPatch,
  type BookingState,
  type PaymentStatus,
  type RefundStatus,
} from './actions'
