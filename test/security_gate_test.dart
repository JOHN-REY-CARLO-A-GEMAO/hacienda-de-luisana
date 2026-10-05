// Unit tests for the security gate's tier map
// (lib/services/security_gate.dart). Pure Dart — no Flutter widgets.
//
// Run: flutter test test/security_gate_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';
import 'package:hacienda_de_luisana/services/security_gate.dart';

void main() {
  group('the tier map', () {
    test('every GateAction is mapped — a future one without a tier throws',
        () {
      // The reason a new GateAction cannot silently default to "no gate":
      // gateFor throws on an unmapped action, and this loop is what catches
      // the day somebody adds the enum value and forgets the tier.
      for (final action in GateAction.values) {
        expect(
          () => gateFor(action),
          returnsNormally,
          reason: 'GateAction.$action has no tier in kGateTiers — map it '
              'before a screen can offer it (ADR-0015).',
        );
      }
    });

    test('the map covers the enum exactly', () {
      expect(kGateTiers.length, GateAction.values.length);
      for (final action in GateAction.values) {
        expect(kGateTiers.containsKey(action), isTrue);
      }
    });

    test('money, removal and publishing take the PIN', () {
      expect(gateFor(GateAction.approveBooking), GateLevel.pin);
      expect(gateFor(GateAction.verifyPayment), GateLevel.pin);
      expect(gateFor(GateAction.cancelBooking), GateLevel.pin);
      expect(gateFor(GateAction.markRefunded), GateLevel.pin);
      expect(gateFor(GateAction.rejectProofCancels), GateLevel.pin);
      expect(gateFor(GateAction.deleteBooking), GateLevel.pin);
      expect(gateFor(GateAction.revokeCredential), GateLevel.pin);
      expect(gateFor(GateAction.publishRates), GateLevel.pin);
      expect(gateFor(GateAction.publishPaymentInfo), GateLevel.pin);
      expect(gateFor(GateAction.publishReview), GateLevel.pin);
      expect(gateFor(GateAction.unpublishReview), GateLevel.pin);
    });
  });

  group('booking lifecycle actions', () {
    test('the actions that commit money or dates take the PIN', () {
      expect(
        gateForBookingAction(AdminAction.approve,
            proofRejectionCancels: false),
        GateLevel.pin,
      );
      expect(
        gateForBookingAction(AdminAction.verifyPayment,
            proofRejectionCancels: false),
        GateLevel.pin,
      );
      expect(
        gateForBookingAction(AdminAction.cancel, proofRejectionCancels: false),
        GateLevel.pin,
      );
      expect(
        gateForBookingAction(AdminAction.markRefunded,
            proofRejectionCancels: false),
        GateLevel.pin,
      );
      expect(
        gateForBookingAction(AdminAction.revokeKey, proofRejectionCancels: false),
        GateLevel.pin,
      );
    });

    test('the ordinary transitions take a confirm', () {
      for (final action in AdminAction.values) {
        switch (action) {
          case AdminAction.reject:
          case AdminAction.expire:
          case AdminAction.checkIn:
          case AdminAction.beginStay:
          case AdminAction.checkOut:
          case AdminAction.complete:
            expect(
              gateForBookingAction(action, proofRejectionCancels: false),
              GateLevel.confirm,
              reason: '$action should be confirm-tier',
            );
            break;
          default:
            break;
        }
      }
    });

    test('rejecting a proof forks on whether the rejection cancels', () {
      // Letting the Guest resend keeps the Booking alive; the reason dialog
      // was already the deliberate input.
      expect(
        gateForBookingAction(AdminAction.rejectPaymentProof,
            proofRejectionCancels: false),
        GateLevel.confirm,
      );
      // Refusing a resend cancels the Booking outright — the PIN.
      expect(
        gateForBookingAction(AdminAction.rejectPaymentProof,
            proofRejectionCancels: true),
        GateLevel.pin,
      );
    });

    test('every AdminAction answers something', () {
      for (final action in AdminAction.values) {
        expect(
          () => gateForBookingAction(action, proofRejectionCancels: false),
          returnsNormally,
        );
        expect(
          () => gateForBookingAction(action, proofRejectionCancels: true),
          returnsNormally,
        );
      }
    });
  });
}
