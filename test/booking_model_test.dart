// BookingModel reads the website's Booking documents (snake_case, Firestore
// Timestamps or ISO strings) and keeps the exact lifecycle status.
//
// Run: flutter test test/booking_model_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';

void main() {
  final webDoc = <String, dynamic>{
    'ref_id': 'HDL-2026-0001',
    'uid': 'guest-uid',
    'source': 'web',
    'guest_name': 'Ana Santos',
    'phone': '0917 000 0000',
    'email': 'ana@example.com',
    'accommodation': 'main-house',
    'check_in': '2026-10-10',
    'check_out': '2026-10-12',
    'guests': 4,
    'status': 'KYC Submitted',
    'kyc_status': 'submitted',
    'kyc_id_url': 'https://x/id.jpg',
    'hold_expires_at': '2026-10-02T00:00:00.000Z',
    'created_at': '2026-10-01T00:00:00.000Z',
    'stay_total': 12000,
  };

  test('parses a website Booking', () {
    final b = BookingModel.fromJson(webDoc, 'doc-1');
    expect(b.id, 'doc-1');
    expect(b.guestName, 'Ana Santos');
    expect(b.accommodation, 'The Main House');
    expect(b.rawStatus, 'KYC Submitted');
    expect(b.status, BookingStatus.pending);
    expect(b.kycStatus, 'submitted');
    expect(b.refId, 'HDL-2026-0001');
    expect(b.uid, 'guest-uid');
    expect(b.stayTotal, 12000);
    expect(b.totalNights, 2);
    expect(b.holdExpiresAt, DateTime.parse('2026-10-02T00:00:00.000Z'));
  });

  test('stages bucket the thirteen statuses', () {
    expect(BookingStatusX.fromString('Reserved'), BookingStatus.confirmed);
    expect(BookingStatusX.fromString('Payment Pending'), BookingStatus.confirmed);
    expect(BookingStatusX.fromString('Staying'), BookingStatus.checkedIn);
    expect(BookingStatusX.fromString('Checked-Out'), BookingStatus.completed);
    expect(BookingStatusX.fromString('Expired'), BookingStatus.cancelled);
    expect(BookingStatusX.fromString('Confirmed'), BookingStatus.confirmed);
  });

  test('toLifecycleDoc keeps the stored fields the rules read', () {
    final doc = BookingModel.fromJson(webDoc, 'doc-1').toLifecycleDoc();
    expect(doc['id'], 'doc-1');
    expect(doc['status'], 'KYC Submitted');
    expect(doc['accommodation'], 'main-house');
    expect(doc['check_in'], '2026-10-10');
    expect(doc['hold_expires_at'], '2026-10-02T00:00:00.000Z');
  });

  test('applyPatch reflects an accepted action locally', () {
    final b = BookingModel.fromJson(webDoc, 'doc-1');
    final after = b.applyPatch({'status': 'Approved', 'kyc_status': 'approved', 'hold_expires_at': null});
    expect(after.rawStatus, 'Approved');
    expect(after.status, BookingStatus.confirmed);
    expect(after.kycStatus, 'approved');
    expect(after.holdExpiresAt, isNull);
    expect(after.guestName, 'Ana Santos');
    expect(after.id, 'doc-1');
  });

  test('nextStep tells the Admin what is waiting', () {
    expect(BookingModel.fromJson(webDoc).nextStep, contains('Review the ID'));
    expect(
      BookingModel.fromJson({...webDoc, 'status': 'Payment Pending', 'payment_proof_url': 'https://x/p.jpg'}).nextStep,
      contains('Verify'),
    );
  });
}
