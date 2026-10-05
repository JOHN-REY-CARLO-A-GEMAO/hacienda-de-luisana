// ----------------------------------------------------------------------------
// Security gate — which Admin actions need more than a tap
// Hacienda de LuisAna Admin app
// ----------------------------------------------------------------------------
// A pure-Dart map from the actions this app can take to how deliberate the
// app forces the Admin to be before taking them (ADR-0015):
//
//   GateLevel.pin      — the Security PIN, on the keypad sheet.
//   GateLevel.confirm  — a modal that names the consequence and waits.
//
// This is a guard rail, not a trust boundary. The money and audit invariants
// live in firestore.rules (ADR-0010) and cannot be added to from here; what
// the gate buys is that a mis-tap, a borrowed unlocked phone or an online
// guessing run all stop at a deliberate second input. ADR-0015 says exactly
// this, so nobody later mistakes the PIN for enforcement.
//
// Two boundaries hold this file in place:
//
//   - The check lives HERE, never in booking_lifecycle.dart. That module is
//     shared with the website (ADR-0007/0010) and a Guest has no PIN; it
//     stays the single source of truth for what a transition does. The gate
//     is an admin-app-only concern layered on top.
//   - The word Credential (CONTEXT.md § Access) is taken — the door RFID /
//     Mobile Key. This is a Security PIN behind a Security gate, and the
//     naming below keeps to that.
//
// No Flutter or Firebase imports: `test/security_gate_test.dart` runs it like
// review_policy.dart.
// ----------------------------------------------------------------------------

import 'booking_lifecycle.dart';

/// How deliberate an action must be before this app will take it (ADR-0015).
enum GateLevel {
  /// The Admin enters their Security PIN on the keypad sheet, or presents a
  /// [SecurityTicket] minted by a recent correct entry.
  pin,

  /// A confirm modal names the consequence and waits for Confirm.
  confirm,
}

/// The sensitive actions the gate knows about, in the app's own words.
///
/// Screens map their local controls onto these; `adminActionsFor()` in
/// booking_lifecycle.dart is never touched, so the website's picture of the
/// lifecycle is unchanged. Adding a value here without a tier below is a
/// test failure, not a silent no-gate default.
enum GateAction {
  approveBooking,
  verifyPayment,
  cancelBooking,
  markRefunded,
  rejectProofCancels,
  deleteBooking,
  revokeCredential,
  publishRates,
  publishPaymentInfo,
  publishReview,
  unpublishReview,
}

/// The tier of every [GateAction], with no default: an action is mapped or
/// the app refuses to gate it, and `gateFor` throws rather than guess.
const Map<GateAction, GateLevel> kGateTiers = {
  // Money and dates. Approving verifies the downpayment and firms the dates;
  // one mis-tap on the bookings list must not do that.
  GateAction.approveBooking: GateLevel.pin,
  GateAction.verifyPayment: GateLevel.pin,
  GateAction.cancelBooking: GateLevel.pin,
  GateAction.markRefunded: GateLevel.pin,
  GateAction.rejectProofCancels: GateLevel.pin,
  // Irreversible removals.
  GateAction.deleteBooking: GateLevel.pin,
  GateAction.revokeCredential: GateLevel.pin,
  // Publishing — what every visitor sees.
  GateAction.publishRates: GateLevel.pin,
  GateAction.publishPaymentInfo: GateLevel.pin,
  GateAction.publishReview: GateLevel.pin,
  GateAction.unpublishReview: GateLevel.pin,
};

/// The tier of [action], or a thrown [StateError] when it is unmapped.
///
/// The throw is the point: a GateAction added next quarter with no entry in
/// [kGateTiers] must not quietly read as "no gate".
GateLevel gateFor(GateAction action) {
  final level = kGateTiers[action];
  if (level == null) {
    throw StateError(
      'GateAction.$action has no tier in the security gate. Map it in '
      'kGateTiers (and say why) before any screen offers it — an unmapped '
      'action must not default to no gate. See ADR-0015.',
    );
  }
  return level;
}

/// The tier of a Booking lifecycle action, shared by the bookings list, the
/// detail screen and `FirestoreService.applyBookingAction` — the last of
/// those re-asks this question on every call, so a forgotten check at a call
/// site cannot turn into a bypass (ADR-0015).
///
/// [proofRejectionCancels] is the Reject-proof fork the screen alone knows:
/// sending the Guest back to re-send keeps the Booking alive (the reason
/// dialog was already the deliberate input), while refusing to let them
/// resend cancels the Booking — that one takes the PIN.
GateLevel gateForBookingAction(
  AdminAction action, {
  required bool proofRejectionCancels,
}) {
  switch (action) {
    case AdminAction.approve:
      return gateFor(GateAction.approveBooking);
    case AdminAction.verifyPayment:
      return gateFor(GateAction.verifyPayment);
    case AdminAction.cancel:
      return gateFor(GateAction.cancelBooking);
    case AdminAction.markRefunded:
      return gateFor(GateAction.markRefunded);
    case AdminAction.revokeKey:
      return gateFor(GateAction.revokeCredential);
    case AdminAction.rejectPaymentProof:
      return proofRejectionCancels
          ? gateFor(GateAction.rejectProofCancels)
          : GateLevel.confirm;
    // Reject already forces a reason the Guest reads; the stay transitions
    // and the recorded expiry are ordinary operations whose mistake costs a
    // second tap, not money or data.
    case AdminAction.reject:
    case AdminAction.expire:
    case AdminAction.checkIn:
    case AdminAction.beginStay:
    case AdminAction.checkOut:
    case AdminAction.complete:
      return GateLevel.confirm;
  }
}
