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
  MAX_STAY_NIGHTS,
  approvalCouplingSet,
  calendarAvailability,
  datesOverlap,
  effectiveStatus,
  findDateConflicts,
  holdMsRemaining,
  holdsDates,
  isAvailable,
  isHoldExpirable,
  isHoldExpired,
  maximumCheckoutDate,
  nightsBetween,
  stayLengthProblem,
  suggestAlternativeDates,
  type AlternativeDateOptions,
  type AvailabilityOptions,
  type CalendarAvailabilityDay,
  type CalendarAvailabilityRequest,
  type CalendarAvailabilityState,
  type DateHoldFields,
  type DateRange,
  type HoldBearingBooking,
  type StayLengthProblem,
} from './availability'

export {
  downPaymentAmount,
  paymentOptions,
  paymentOptionsForTotal,
  quoteStay,
  recordedStayTotal,
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
  formatRefundPolicySummary,
  ratesForAccommodation,
  quoteAccommodation,
  classifyRateDate,
  quotedStayTotal,
  validatePublishedRates,
  stayAddons,
  WEDDING_PREP_ACCOMMODATION_ID,
  type AccommodationRates,
  type GuestBracketPricing,
  type GuestRateSchedule,
  type PetPolicy,
  type PropertyQuote,
  type RateClassification,
  type PolicySnapshot,
  type PublishedRates,
  type PublishedRefundPolicy,
  type PublishedRefundTier,
  type RatesProblem,
  type StayAddons,
  type StayExtras,
} from './rates'

export {
  EVENT_PURPOSES,
  EVENT_PURPOSE_DETAIL_MAX,
  MAX_BONFIRE_WOOD_SETS,
  MAX_LATE_CHECKOUT_HOURS,
  MAX_REQUEST_PETS,
  REQUEST_NOTES_MAX,
  addonFeeLines,
  addonPricingState,
  composeSpecialRequests,
  estimatedAdditionalFees,
  eventPurposeLabel,
  formatPesos,
  maxPetsFor,
  pricedStayExtras,
  sanitizeStayRequests,
  summarizeStayRequests,
  type AddonFallbackAmounts,
  type AddonFeeLine,
  type AddonLineId,
  type ComposeRequestMeta,
  type EventPurpose,
  type StayRequests,
} from './requests'

export { formatHoldCountdown, unitsForAccommodation, type UnitBearing } from './holds'

export { assertSubmittable, type SubmissionProof, type SubmissionReady } from './submit'

export {
  BOOKING_TIME_ZONE,
  MINIMUM_BOOKING_LEAD_TIME_DAYS,
  bookingBusinessDate,
  configuredBookingLeadTimeDays,
  minimumBookingLeadTimeMessage,
  minimumCheckInDate,
  validateMinimumBookingLeadTime,
  type BookingDateValidation,
} from './leadTime'

export {
  genericRulesRefusal,
  validateBookingPayload,
  validateBookingSelection,
  type BookingPayloadForValidation,
  type BookingPayloadValidation,
  type BookingRuleFailure,
  type BookingRuleFailureCode,
  type BookingRuleField,
  type BookingSelection,
  type BookingSelectionOptions,
  type BookingSelectionValidation,
} from './validation'

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
