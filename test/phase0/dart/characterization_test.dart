// Phase 0 Flutter/Dart CURRENT-behavior characterization. NOT EXECUTED in this
// sandbox (Flutter SDK unavailable): run via `npm run test:flutter`, which
// enters the same loopback-only namespace. Pure Dart models only; no Firebase.
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';

const adminA = Actor.admin('phase0-admin-a', 'Synthetic Admin A');
const adminB = Actor.admin('phase0-admin-b', 'Synthetic Admin B');
final now = DateTime.utc(2026, 10, 1, 4);

Map<String, dynamic> pending([Map<String, dynamic> extra = const {}]) => {
      'id': 'phase0-booking-a', 'status': 'Pending', 'accommodation': 'main-house',
      'check_in': '2026-12-01', 'check_out': '2026-12-03',
      'hold_expires_at': '2026-10-02T04:00:00.000Z',
      'payment_proof_url': 'payments/phase0-anonymous-guest/HDL-PHASE0-A/proof-1.png',
      'amount_claimed': 12000, 'amount_due': 12000, 'stay_total': 24000,
      'security_deposit': 1500, 'balance_due': 13500, ...extra,
    };

void main() {
  test('F06-DART-CURRENT: two Admins deciding from the same cached Pending both pass', () {
    final a = applyAdminAction(pending(), AdminAction.approve, adminA, now: now);
    final b = applyAdminAction(pending(), AdminAction.approve, adminB, now: now);
    expect([a.ok, b.ok], [true, true]);
  });
  test('F02/F07-DART-CURRENT: zero-due/₱1 claim is approved and copied as verified', () {
    final r = applyAdminAction(pending({'amount_claimed': 1, 'amount_due': 0}), AdminAction.approve, adminA, now: now);
    expect(r.ok, isTrue);
    expect(r.patch['amount_verified'], 1);
  });
  test('F09-DART-CURRENT: future stay progresses to Completed with balance still recorded', () {
    var doc = {...pending(), 'status': 'Approved', 'payment_status': 'verified', 'balance_due': 23999};
    for (final a in [AdminAction.checkIn, AdminAction.beginStay, AdminAction.checkOut, AdminAction.complete]) {
      final r = applyAdminAction(doc, a, adminA, now: now);
      expect(r.ok, isTrue, reason: r.reason);
      doc = {...doc, ...r.patch};
    }
    expect(doc['status'], 'Completed');
    expect(doc['balance_due'], 23999);
  });
  test('F11-DART-CURRENT: disjoint single nights exhaust a two-unit count', () {
    final others = [
      {'id': 'n1', 'accommodation': 'house-a-camping', 'check_in': '2026-12-01', 'check_out': '2026-12-02', 'status': 'Approved'},
      {'id': 'n2', 'accommodation': 'house-a-camping', 'check_in': '2026-12-02', 'check_out': '2026-12-03', 'status': 'Approved'},
    ];
    final conflicts = findDateConflicts(pending({'accommodation': 'house-a-camping'}), others,
        unitsAvailable: 2, now: now, excludeId: 'phase0-booking-a', forApproval: true);
    expect(conflicts, isNotEmpty);
  });
  test('F28-DART-CURRENT: totalAmount ignores stay_total and defaults to nights*12000', () {
    final m = BookingModel.fromJson({...pending(), 'stay_total': 5000}, 'phase0-booking-a');
    expect(m.stayTotal, 5000);
    expect(m.totalAmount, 24000);
  });
  test('F14-DART-CURRENT: non-integer guest count throws in the parser (whole-list fallback risk)', () {
    expect(() => BookingModel.fromJson({...pending(), 'guests': '2'}, 'x'), throwsA(isA<TypeError>()));
  });
}
