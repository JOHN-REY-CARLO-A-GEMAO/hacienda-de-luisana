// Unit tests for the Admin side of the Booking lifecycle
// (lib/services/booking_lifecycle.dart). Pure Dart — no Flutter, no Firebase.
//
// Run: flutter test test/booking_lifecycle_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';

Map<String, dynamic> booking({
  String id = 'bk-1',
  String status = 'Pending',
  String accommodation = 'main-house',
  String checkIn = '2026-10-10',
  String checkOut = '2026-10-12',
  Map<String, dynamic> extra = const {},
}) =>
    {
      'id': id,
      'status': status,
      'accommodation': accommodation,
      'check_in': checkIn,
      'check_out': checkOut,
      'guest_name': 'Test Guest',
      ...extra,
    };

final now = DateTime.utc(2026, 10, 1, 12);

/// A published rates document whose A-House holds [units] units.
///
/// The unit count the approval re-check uses is read from here, not from a list
/// in the app: this is the whole reason the A-House's inventory can be stated
/// once and mean the same thing to both apps and the rules.
Map<String, dynamic> ratesWithAHouseUnits(int units) => <String, dynamic>{
      'version': 'test-v1',
      'effective_date': '2026-09-01',
      'holiday_dates': <String>[],
      'accommodations': <String, dynamic>{
        'main-house': <String, dynamic>{
          'rate_unit': 'standard_stay',
          'available_units': 1,
          'security_deposit': 500,
          'down_payment_percent': 50,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 10,
              'base_rate': 5000,
              'excess_per_guest': 500,
            },
            'weekend_holiday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 10,
              'base_rate': 6000,
              'excess_per_guest': 500,
            },
          },
        },
        'annex': <String, dynamic>{
          'rate_unit': 'standard_stay',
          'available_units': 1,
          'security_deposit': 500,
          'down_payment_percent': 50,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 6,
              'base_rate': 4000,
              'excess_per_guest': 500,
            },
            'weekend_holiday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 6,
              'base_rate': 5000,
              'excess_per_guest': 500,
            },
          },
        },
        'house-a-camping': <String, dynamic>{
          'rate_unit': 'standard_stay',
          'available_units': units,
          'security_deposit': 0,
          'down_payment_percent': 50,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 3,
              'max_guests': 3,
              'base_rate': 1000,
            },
            'weekend_holiday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 3,
              'max_guests': 3,
              'base_rate': 1000,
            },
          },
        },
      },
    };
const admin = Actor.admin('admin-uid', 'The Admin');
const proof = {
  'payment_proof_url': 'payments/g/proof.jpg',
  'amount_claimed': 5000,
  'amount_due': 5000,
};

void main() {
  group('normalizeStatus', () {
    test('reads canonical, legacy and unknown spellings', () {
      expect(normalizeStatus('Reserved'), 'Reserved');
      expect(normalizeStatus('checked_in'), 'Checked-In');
      expect(normalizeStatus('payment_pending'), 'Payment Pending');
      // Retired vocabulary still reads as its successor (never as itself).
      expect(normalizeStatus('kyc submitted'), 'Pending');
      expect(normalizeStatus('Approved'), 'Approved');
      expect(normalizeStatus('Confirmed'), 'Reserved');
      expect(normalizeStatus(null), 'Pending');
      expect(normalizeStatus('garbage'), 'Pending');
    });
  });

  group('transitions', () {
    test('whitelist matches the website', () {
      // Approval accepts the downpayment screenshot (ADR-0012).
      expect(canTransition('Pending', 'Approved'), isTrue);
      expect(canTransition('Pending', 'Payment Pending'), isFalse);
      expect(canTransition('Approved', 'Checked-In'), isTrue);
      expect(canTransition('Reserved', 'Checked-In'), isTrue);
      // Money still cannot be skipped, and retired statuses never move.
      expect(canTransition('Pending', 'Payment Verified'), isFalse);
      expect(canTransition('Pending', 'Reserved'), isFalse);
      expect(canTransition('Payment Pending', 'Reserved'), isFalse);
      expect(canTransition('KYC Submitted', 'Payment Pending'), isFalse);
      expect(canTransition('Approved', 'Rejected'), isFalse);
      expect(canTransition('Approved', 'Cancelled'), isTrue);
      expect(canTransition('Completed', 'Pending'), isFalse);
      expect(canTransition('Cancelled', 'Reserved'), isFalse);
    });

    test('adminActionsFor offers only what the status allows', () {
      expect(adminActionsFor('Pending'),
          containsAll([AdminAction.approve, AdminAction.reject, AdminAction.cancel]));
      expect(adminActionsFor('Payment Pending'),
          containsAll([AdminAction.verifyPayment, AdminAction.rejectPaymentProof, AdminAction.cancel]));
      expect(adminActionsFor('Payment Pending'), isNot(contains(AdminAction.approve)));
      expect(adminActionsFor('Reserved'),
          containsAll([AdminAction.checkIn, AdminAction.cancel, AdminAction.revokeKey]));
      expect(adminActionsFor('Completed'), isEmpty);
      expect(adminActionsFor('Rejected'), isEmpty);
      expect(adminActionsFor('Pending'), isNot(contains(AdminAction.expire)));
    });
  });

  group('Approve', () {
    test('is refused on a Booking that has already passed review', () {
      final r = applyAdminAction(booking(status: 'Payment Pending'),
          AdminAction.approve, admin, now: now);
      expect(r.ok, isFalse);
      expect(r.reason, contains('Payment Pending'));
    });

    test('accepts the downpayment, stops the hold and logs the move', () {
      final r = applyAdminAction(
        booking(extra: {
          'hold_expires_at': '2026-10-02T00:00:00Z',
          'payment_proof_url': 'payments/g/proof.jpg',
          'amount_claimed': 5000,
          'amount_due': 5000,
        }),
        AdminAction.approve,
        admin,
        now: now,
      );
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Approved');
      expect(r.patch['payment_status'], 'verified');
      expect(r.patch.containsKey('hold_expires_at'), isTrue);
      expect(r.patch['hold_expires_at'], isNull);
      expect(r.entry!['action'], 'Approve');
      expect(r.entry!['from_status'], 'Pending');
      expect(r.entry!['to_status'], 'Approved');
      expect(r.entry!['actor'], 'admin');
      expect(r.entry!['actor_id'], 'admin-uid');
      expect(r.entry!['actor_name'], 'The Admin');
      expect(r.entry!['booking_id'], 'bk-1');
    });

    test('refuses when another committed Booking holds the dates', () {
      final other = booking(id: 'bk-2', status: 'Reserved', checkIn: '2026-10-11', checkOut: '2026-10-13');
      final r = applyAdminAction(
        booking(extra: proof),
        AdminAction.approve,
        admin,
        input: ActionInput(otherBookings: [other]),
        now: now,
      );
      expect(r.ok, isFalse);
      expect(r.conflicts.map((c) => c['id']), ['bk-2']);
    });

    test('a Booking still under review does not block approval', () {
      final other = booking(id: 'bk-2', extra: {'hold_expires_at': '2026-10-02T00:00:00Z'});
      final r = applyAdminAction(
        booking(extra: proof),
        AdminAction.approve,
        admin,
        input: ActionInput(otherBookings: [other]),
        now: now,
      );
      expect(r.ok, isTrue);
    });

    test('the A-House publishes two units, so one other Booking does not fill it', () {
      final other = booking(id: 'bk-2', status: 'Reserved', accommodation: 'house-a-camping');
      final r = applyAdminAction(
        booking(accommodation: 'house-a-camping', extra: proof),
        AdminAction.approve,
        admin,
        input: ActionInput(
          otherBookings: [other],
          publishedRates: ratesWithAHouseUnits(2),
        ),
        now: now,
      );
      expect(r.ok, isTrue);
    });

    test('and a second overlapping Booking fills it, because it is the second of two', () {
      final rivals = [
        booking(id: 'bk-2', status: 'Reserved', accommodation: 'house-a-camping'),
        booking(id: 'bk-3', status: 'Reserved', accommodation: 'house-a-camping'),
      ];
      final r = applyAdminAction(
        booking(accommodation: 'house-a-camping', extra: proof),
        AdminAction.approve,
        admin,
        input: ActionInput(
          otherBookings: rivals,
          publishedRates: ratesWithAHouseUnits(2),
        ),
        now: now,
      );
      expect(r.ok, isFalse);
      expect(r.reason, contains('already held'));
    });

    test('one unit unless the document publishes more, so an absent count cannot overbook', () {
      // With no published `available_units` the count is one, not "as many as
      // turn up". A single committed rival is then enough to refuse.
      final r = applyAdminAction(
        booking(accommodation: 'house-a-camping', extra: proof),
        AdminAction.approve,
        admin,
        input: ActionInput(
          otherBookings: [
            booking(id: 'bk-2', status: 'Reserved', accommodation: 'house-a-camping'),
          ],
        ),
        now: now,
      );
      expect(r.ok, isFalse);
    });

    test('refuses once the Date hold ran out', () {
      final r = applyAdminAction(
        booking(extra: {'hold_expires_at': '2026-09-30T00:00:00Z'}),
        AdminAction.approve,
        admin,
        now: now,
      );
      expect(r.ok, isFalse);
      expect(r.reason, contains('Expired'));
    });

    test('a pre-hold Booking (no hold recorded) can still be approved', () {
      final r = applyAdminAction(booking(extra: proof), AdminAction.approve, admin, now: now);
      expect(r.ok, isTrue);
    });
  });

  group('who may act', () {
    test('a guest cannot approve; the system cannot reject', () {
      const guest = Actor(kind: 'guest', id: 'g1');
      expect(applyAdminAction(booking(), AdminAction.approve, guest, now: now).ok, isFalse);
      expect(applyAdminAction(booking(), AdminAction.reject, const Actor.system(), input: const ActionInput(reason: 'x'), now: now).ok, isFalse);
    });

    test('only the system expires; the Admin app records it on its behalf', () {
      final b = booking(status: 'Pending', extra: {'hold_expires_at': '2026-09-30T00:00:00Z'});
      expect(applyAdminAction(b, AdminAction.expire, admin, now: now).ok, isFalse);
      final r = applyAdminAction(b, AdminAction.expire, const Actor.system(), now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Expired');
      expect(r.entry!['actor'], 'system');
    });

    test('Expire is refused while the hold still has time', () {
      final b = booking(status: 'Pending', extra: {'hold_expires_at': '2026-10-02T00:00:00Z'});
      expect(applyAdminAction(b, AdminAction.expire, const Actor.system(), now: now).ok, isFalse);
    });
  });

  group('Reject', () {
    test('rejection needs a reason and records why', () {
      expect(applyAdminAction(booking(), AdminAction.reject, admin, now: now).ok, isFalse);
      final r = applyAdminAction(booking(), AdminAction.reject, admin,
          input: const ActionInput(reason: 'The Guest stopped replying'), now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Rejected');
      expect(r.patch['rejection_reason'], 'The Guest stopped replying');
      expect(r.entry!['reason'], 'The Guest stopped replying');
    });

    test('a pre-money rejection also fits after approval, while money is unverified', () {
      final r = applyAdminAction(booking(status: 'Payment Pending'), AdminAction.reject, admin,
          input: const ActionInput(reason: 'Dates can no longer be offered'), now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Rejected');
    });
  });

  group('VerifyPayment', () {
    final pp = booking(status: 'Payment Pending', extra: {
      'payment_proof_url': 'https://x/gcash.jpg',
      'amount_due': 8500,
      'security_deposit': 1000,
    });

    test('needs a proof and a covering amount', () {
      expect(applyAdminAction(booking(status: 'Payment Pending'), AdminAction.verifyPayment, admin,
          input: const ActionInput(amountVerified: 9500), now: now).ok, isFalse);
      final under = applyAdminAction(pp, AdminAction.verifyPayment, admin,
          input: const ActionInput(amountVerified: 9000), now: now);
      expect(under.ok, isFalse);
      expect(under.reason, contains('9500'));
    });

    test('the screen is told before the press, not after', () {
      // `adminActionsFor` sees only the status, so it offers Verify for every
      // Payment Pending Booking — including one with no proof behind it. The
      // blocker is what stops the screen offering an action the lifecycle
      // refuses, and it must say the same thing the refusal says.
      final noProof = booking(status: 'Payment Pending');
      expect(adminActionsFor('Payment Pending'),
          contains(AdminAction.verifyPayment));
      expect(adminActionBlockedReason(noProof, AdminAction.verifyPayment),
          isNotNull);
      expect(adminActionBlockedReason(pp, AdminAction.verifyPayment), isNull);

      final refused = applyAdminAction(noProof, AdminAction.verifyPayment, admin,
          input: const ActionInput(amountVerified: 9500), now: now);
      expect(refused.ok, isFalse);
      expect(refused.reason, adminActionBlockedReason(noProof, AdminAction.verifyPayment));
    });

    test('a proof that is an empty string is still no proof', () {
      final blank = booking(status: 'Payment Pending',
          extra: {'payment_proof_url': '   '});
      expect(adminActionBlockedReason(blank, AdminAction.verifyPayment), isNotNull);
    });

    test('no other Admin action is blocked on the document alone', () {
      final pending = booking(status: 'Payment Pending');
      for (final a in adminActionsFor('Payment Pending')) {
        if (a == AdminAction.verifyPayment) continue;
        expect(adminActionBlockedReason(pending, a), isNull,
            reason: '$a should not be blocked by the booking document');
      }
    });

    test('lands the Booking on Reserved in one move', () {
      final r = applyAdminAction(pp, AdminAction.verifyPayment, admin,
          input: const ActionInput(amountVerified: 9500), now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Reserved');
      expect(r.patch['payment_status'], 'verified');
      expect(r.patch['amount_verified'], 9500);
    });

    test('rejecting the proof: resend keeps Payment Pending, otherwise cancels', () {
      final resend = applyAdminAction(pp, AdminAction.rejectPaymentProof, admin,
          input: const ActionInput(reason: 'Wrong amount', guestResubmits: true), now: now);
      expect(resend.ok, isTrue);
      expect(resend.patch['status'], 'Payment Pending');
      expect(resend.patch['payment_proof_url'], isNull);

      final cancel = applyAdminAction(pp, AdminAction.rejectPaymentProof, admin,
          input: const ActionInput(reason: 'Fake receipt', guestResubmits: false), now: now);
      expect(cancel.ok, isTrue);
      expect(cancel.patch['status'], 'Cancelled');
      expect(cancel.patch['refund_status'], 'none');
    });
  });

  group('Stay progression', () {
    test('Reserved → Checked-In → Staying → Checked-Out → Completed', () {
      var b = booking(status: 'Reserved');
      for (final step in [
        (AdminAction.checkIn, 'Checked-In'),
        (AdminAction.beginStay, 'Staying'),
        (AdminAction.checkOut, 'Checked-Out'),
        (AdminAction.complete, 'Completed'),
      ]) {
        final r = applyAdminAction(b, step.$1, admin, now: now);
        expect(r.ok, isTrue, reason: '${step.$1} should be accepted');
        expect(r.patch['status'], step.$2);
        b = {...b, ...r.patch};
      }
      expect(applyAdminAction(b, AdminAction.checkIn, admin, now: now).ok, isFalse);
    });

    test('RevokeKey logs without moving the Booking', () {
      final r = applyAdminAction(booking(status: 'Staying'), AdminAction.revokeKey, admin, now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Staying');
      expect(r.entry!['reason'], contains('revoked'));
    });
  });

  group('Cancel and refunds', () {
    test('before money is verified there is nothing to refund', () {
      final r = applyAdminAction(booking(status: 'Payment Pending'), AdminAction.cancel, admin,
          input: const ActionInput(reason: 'Guest asked'), now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Cancelled');
      expect(r.patch['refund_status'], 'none');
      expect(r.patch['cancellation_reason'], 'Guest asked');
    });

    test('from Reserved the refund is settled under the published policy', () {
      final rates = {
        'version': 'v1',
        'effective_date': '2026-01-01',
        'accommodations': {
          'main-house': {'nightly_rate': 6000, 'security_deposit': 2000},
        },
        'refund': {
          'tiers': [
            {'min_days_before_check_in': 7, 'refund_percent': 50},
            {'min_days_before_check_in': 14, 'refund_percent': 100},
          ],
        },
      };
      final r = applyAdminAction(
        booking(status: 'Reserved', extra: {
          'stay_total': 12000,
          'security_deposit': 2000,
          'amount_verified': 14000,
        }),
        AdminAction.cancel,
        admin,
        input: ActionInput(publishedRates: rates, damageDeduction: 500),
        now: now, // 9 days before the 2026-10-10 check-in → 50 % tier
      );
      expect(r.ok, isTrue);
      expect(r.patch['refund_status'], 'initiated');
      final breakdown = r.patch['refund_breakdown'] as Map;
      expect(breakdown['stayTotal'], 12000);
      expect(breakdown['depositHeld'], 2000);
      expect(breakdown['damageDeduction'], 500);
      expect(breakdown['depositRefund'], 1500);
      expect(breakdown['stayRefund'], 6000);
      expect(r.patch['refund_total'], 7500);

      final marked = applyAdminAction({...booking(status: 'Reserved'), ...r.patch},
          AdminAction.markRefunded, admin, now: now);
      expect(marked.ok, isTrue);
      expect(marked.patch['refund_status'], 'refunded');
      expect(marked.patch['status'], 'Cancelled');
    });

    test('cancellation uses the Booking rate, deposit and refund-policy snapshots after republishing', () {
      final currentRates = {
        'accommodations': {
          'main-house': {'nightly_rate': 99000, 'security_deposit': 99000},
        },
        'refund': {'refund_percent': 100, 'deposit_refund_percent': 100},
      };
      final r = applyAdminAction(
        booking(status: 'Reserved', extra: {
          'stay_total': 12000,
          'security_deposit': 2000,
          'amount_verified': 14000,
          'refund_policy_snapshot': {
            'refund_percent': 0,
            'deposit_refund_percent': 50,
            'tiers': [
              {'min_days_before_check_in': 7, 'refund_percent': 50},
            ],
          },
        }),
        AdminAction.cancel,
        admin,
        input: ActionInput(publishedRates: currentRates, damageDeduction: 500),
        now: now,
      );
      expect(r.ok, isTrue);
      final breakdown = r.patch['refund_breakdown'] as Map;
      expect(breakdown['stayTotal'], 12000);
      expect(breakdown['depositHeld'], 2000);
      expect(breakdown['depositRefund'], 750);
      expect(breakdown['stayRefund'], 6000);
      expect(r.patch['refund_total'], 6750);
    });

    test('MarkRefunded needs an initiated refund', () {
      expect(applyAdminAction(booking(status: 'Cancelled'), AdminAction.markRefunded, admin, now: now).ok, isFalse);
    });
  });

  group('settleRefund', () {
    test('part-paid Booking still returns its deposit first', () {
      final s = settleRefund(
        checkIn: '2026-10-10',
        checkOut: '2026-10-12',
        policy: const RefundPolicy(refundPercent: 100),
        cancelledAt: now,
        stayTotal: 10000,
        securityDeposit: 2000,
        verifiedAmount: 5000,
      );
      expect(s.depositHeld, 2000);
      expect(s.stayRefund, 3000);
      expect(s.refundTotal, 5000);
    });

    test('no policy refunds nothing but the deposit', () {
      final s = settleRefund(
        checkIn: '2026-10-10',
        checkOut: '2026-10-12',
        cancelledAt: now,
        stayTotal: 10000,
        securityDeposit: 2000,
      );
      expect(s.stayRefund, 0);
      expect(s.depositRefund, 2000);
    });
  });

  group('Date hold', () {
    test('countdown reads down and releases', () {
      expect(formatHoldCountdown(const Duration(hours: 2, minutes: 5)), '2h 5m');
      expect(formatHoldCountdown(const Duration(minutes: 9, seconds: 30)), '9m');
      expect(formatHoldCountdown(Duration.zero), 'Dates released');
    });

    test('effectiveStatus reads Expired once the hold ran out', () {
      final b = booking(status: 'Pending', extra: {'hold_expires_at': '2026-09-30T00:00:00Z'});
      expect(effectiveStatus(b, now), 'Expired');
      expect(effectiveStatus(booking(status: 'Payment Pending', extra: {'hold_expires_at': '2026-09-30T00:00:00Z'}), now), 'Payment Pending');
    });
  });
}
