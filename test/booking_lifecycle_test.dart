// Unit tests for the Admin side of the Booking lifecycle
// (lib/services/booking_lifecycle.dart). Pure Dart — no Flutter, no Firebase.
//
// Run: flutter test test/booking_lifecycle_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';

Map<String, dynamic> booking({
  String id = 'bk-1',
  String status = 'KYC Submitted',
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
const admin = Actor.admin('admin-uid', 'The Admin');

void main() {
  group('normalizeStatus', () {
    test('reads canonical, legacy and unknown spellings', () {
      expect(normalizeStatus('Reserved'), 'Reserved');
      expect(normalizeStatus('checked_in'), 'Checked-In');
      expect(normalizeStatus('kyc submitted'), 'KYC Submitted');
      expect(normalizeStatus('Confirmed'), 'Reserved');
      expect(normalizeStatus(null), 'Pending');
      expect(normalizeStatus('garbage'), 'Pending');
    });
  });

  group('transitions', () {
    test('whitelist matches the website', () {
      expect(canTransition('Pending', 'KYC Submitted'), isTrue);
      expect(canTransition('KYC Submitted', 'Approved'), isTrue);
      expect(canTransition('Reserved', 'Checked-In'), isTrue);
      expect(canTransition('Pending', 'Approved'), isFalse);
      expect(canTransition('Completed', 'Pending'), isFalse);
      expect(canTransition('Cancelled', 'Reserved'), isFalse);
    });

    test('adminActionsFor offers only what the status allows', () {
      expect(adminActionsFor('KYC Submitted'),
          containsAll([AdminAction.approve, AdminAction.reject, AdminAction.rejectKyc, AdminAction.cancel]));
      expect(adminActionsFor('Payment Pending'),
          containsAll([AdminAction.verifyPayment, AdminAction.rejectPaymentProof, AdminAction.cancel]));
      expect(adminActionsFor('Reserved'),
          containsAll([AdminAction.checkIn, AdminAction.cancel, AdminAction.revokeKey]));
      expect(adminActionsFor('Completed'), [AdminAction.purgeKyc]);
      expect(adminActionsFor('Rejected'), isEmpty);
      expect(adminActionsFor('Pending'), isNot(contains(AdminAction.expire)));
    });
  });

  group('Approve', () {
    test('needs a submitted ID', () {
      final r = applyAdminAction(booking(extra: {'kyc_status': 'required'}),
          AdminAction.approve, admin, now: now);
      expect(r.ok, isFalse);
      expect(r.reason, contains('government ID'));
    });

    test('approves, stops the hold and logs the move', () {
      final r = applyAdminAction(
        booking(extra: {'kyc_status': 'submitted', 'hold_expires_at': '2026-10-02T00:00:00Z'}),
        AdminAction.approve,
        admin,
        now: now,
      );
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Approved');
      expect(r.patch['kyc_status'], 'approved');
      expect(r.patch.containsKey('hold_expires_at'), isTrue);
      expect(r.patch['hold_expires_at'], isNull);
      expect(r.entry!['action'], 'Approve');
      expect(r.entry!['from_status'], 'KYC Submitted');
      expect(r.entry!['to_status'], 'Approved');
      expect(r.entry!['actor'], 'admin');
      expect(r.entry!['actor_id'], 'admin-uid');
      expect(r.entry!['actor_name'], 'The Admin');
      expect(r.entry!['booking_id'], 'bk-1');
    });

    test('refuses when another committed Booking holds the dates', () {
      final other = booking(id: 'bk-2', status: 'Reserved', checkIn: '2026-10-11', checkOut: '2026-10-13');
      final r = applyAdminAction(
        booking(extra: {'kyc_status': 'submitted'}),
        AdminAction.approve,
        admin,
        input: ActionInput(otherBookings: [other]),
        now: now,
      );
      expect(r.ok, isFalse);
      expect(r.conflicts.map((c) => c['id']), ['bk-2']);
    });

    test('a Booking still under review does not block approval', () {
      final other = booking(id: 'bk-2', status: 'KYC Submitted', extra: {'hold_expires_at': '2026-10-02T00:00:00Z'});
      final r = applyAdminAction(
        booking(extra: {'kyc_status': 'submitted'}),
        AdminAction.approve,
        admin,
        input: ActionInput(otherBookings: [other]),
        now: now,
      );
      expect(r.ok, isTrue);
    });

    test('camping has two units', () {
      final other = booking(id: 'bk-2', status: 'Reserved', accommodation: 'house-a-camping');
      final r = applyAdminAction(
        booking(accommodation: 'house-a-camping', extra: {'kyc_status': 'submitted'}),
        AdminAction.approve,
        admin,
        input: ActionInput(otherBookings: [other]),
        now: now,
      );
      expect(r.ok, isTrue);
    });

    test('refuses once the Date hold ran out', () {
      final r = applyAdminAction(
        booking(extra: {'kyc_status': 'submitted', 'hold_expires_at': '2026-09-30T00:00:00Z'}),
        AdminAction.approve,
        admin,
        now: now,
      );
      expect(r.ok, isFalse);
      expect(r.reason, contains('Expired'));
    });

    test('a pre-hold Booking (no hold recorded) can still be approved', () {
      final r = applyAdminAction(booking(extra: {'kyc_status': 'submitted'}),
          AdminAction.approve, admin, now: now);
      expect(r.ok, isTrue);
    });
  });

  group('who may act', () {
    test('a guest cannot approve; the system cannot reject', () {
      const guest = Actor(kind: 'guest', id: 'g1');
      expect(applyAdminAction(booking(extra: {'kyc_status': 'submitted'}), AdminAction.approve, guest, now: now).ok, isFalse);
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

  group('Reject / RejectKyc', () {
    test('rejection needs a reason and marks a submitted ID rejected', () {
      expect(applyAdminAction(booking(extra: {'kyc_status': 'submitted'}), AdminAction.reject, admin, now: now).ok, isFalse);
      final r = applyAdminAction(booking(extra: {'kyc_status': 'submitted'}), AdminAction.reject, admin,
          input: const ActionInput(reason: 'Blurry ID'), now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'Rejected');
      expect(r.patch['rejection_reason'], 'Blurry ID');
      expect(r.patch['kyc_status'], 'rejected');
      expect(r.entry!['reason'], 'Blurry ID');
    });

    test('RejectKyc keeps the Booking in KYC Submitted', () {
      final r = applyAdminAction(
          booking(extra: {'kyc_status': 'submitted', 'kyc_id_url': 'https://x/id.jpg'}),
          AdminAction.rejectKyc, admin, input: const ActionInput(reason: 'Expired ID'), now: now);
      expect(r.ok, isTrue);
      expect(r.patch['status'], 'KYC Submitted');
      expect(r.patch['kyc_status'], 'rejected');
      expect(r.patch['kyc_reject_reason'], 'Expired ID');
    });
  });

  group('VerifyPayment', () {
    final pp = booking(status: 'Payment Pending', extra: {
      'kyc_status': 'approved',
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

    test('PurgeKyc clears both URLs only when something is there', () {
      expect(applyAdminAction(booking(status: 'Completed'), AdminAction.purgeKyc, admin, now: now).ok, isFalse);
      final r = applyAdminAction(
          booking(status: 'Completed', extra: {'kyc_id_url': 'https://x/id.jpg'}),
          AdminAction.purgeKyc, admin, now: now);
      expect(r.ok, isTrue);
      expect(r.patch['kyc_id_url'], isNull);
      expect(r.patch['kyc_receipt_url'], isNull);
      expect(r.patch['status'], 'Completed');
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
      final r = applyAdminAction(booking(status: 'Approved'), AdminAction.cancel, admin,
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
        booking(status: 'Reserved', extra: {'amount_verified': 14000}),
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
      expect(effectiveStatus(booking(status: 'Approved', extra: {'hold_expires_at': '2026-09-30T00:00:00Z'}), now), 'Approved');
    });
  });
}
