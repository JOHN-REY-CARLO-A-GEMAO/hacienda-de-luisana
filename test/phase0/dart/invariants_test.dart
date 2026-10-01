// Phase 0 Flutter/Dart DESIRED invariants. Expected RED until remediation.
// NOT EXECUTED here (Flutter SDK unavailable).
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';

const adminA = Actor.admin('phase0-admin-a');
final now = DateTime.utc(2026, 10, 1, 4);
Map<String, dynamic> approved([Map<String, dynamic> extra = const {}]) => {
      'id': 'phase0-booking-a', 'status': 'Approved', 'payment_status': 'verified',
      'accommodation': 'main-house', 'check_in': '2026-12-01', 'check_out': '2026-12-03',
      'amount_verified': 12000, 'stay_total': 24000, 'balance_due': 13500, ...extra,
    };
void main() {
  test('F09 DESIRED: cannot check in two months early', () {
    expect(applyAdminAction(approved(), AdminAction.checkIn, adminA, now: now).ok, isFalse);
  });
  test('F09 DESIRED: cannot complete with unresolved balance', () {
    expect(applyAdminAction(approved({'status': 'Checked-Out'}), AdminAction.complete, adminA, now: now).ok, isFalse);
  });
  test('F28 DESIRED: reported total reflects recorded stay_total', () {
    expect(BookingModel.fromJson(approved({'stay_total': 5000}), 'x').totalAmount, 5000);
  });
  test('F14 DESIRED: one malformed document is quarantined rather than throwing', () {
    expect(() => BookingModel.fromJson(approved({'guests': '2'}), 'x'), returnsNormally);
  });
}
