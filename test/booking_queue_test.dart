import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/services/booking_queue.dart';

BookingModel booking({
  required String status,
  String checkIn = '2026-10-25',
  String? proof,
  String paymentStatus = 'pending',
  String? refundStatus,
}) {
  return BookingModel.fromJson({
    'guest_name': 'Test Guest',
    'phone': '09170000000',
    'email': 'guest@example.com',
    'accommodation': 'main-house',
    'check_in': checkIn,
    'check_out': '2026-10-26',
    'guests': 2,
    'status': status,
    'stay_total': 6000,
    'created_at': '2026-10-01T00:00:00.000Z',
    if (proof != null) 'payment_proof_url': proof,
    'payment_status': paymentStatus,
    if (refundStatus != null) 'refund_status': refundStatus,
  });
}

void main() {
  final now = DateTime(2026, 10, 25, 12);

  test('the five operational queues use canonical booking facts', () {
    final approval = booking(status: 'Pending', proof: 'payments/proof.png');
    final arrival = booking(status: 'Reserved');
    final current = booking(status: 'Staying');
    final payment = booking(status: 'Payment Pending', proof: 'payments/proof.png');
    final refund = booking(status: 'Cancelled', refundStatus: 'initiated');

    expect(bookingNeedsApproval(approval), isTrue);
    expect(bookingArrivesToday(arrival, now), isTrue);
    expect(bookingIsCurrentGuest(current), isTrue);
    expect(bookingNeedsPaymentReview(payment), isTrue);
    expect(bookingNeedsAdminAction(refund), isTrue);
  });

  test('future or unapproved stays are not arrivals or current guests', () {
    expect(bookingArrivesToday(booking(status: 'Pending'), now), isFalse);
    expect(bookingArrivesToday(booking(status: 'Reserved', checkIn: '2026-10-26'), now), isFalse);
    expect(bookingIsCurrentGuest(booking(status: 'Approved')), isFalse);
    expect(bookingIsCurrentGuest(booking(status: 'Checked-Out')), isFalse);
  });

  test('payment review requires actual proof and an unverified payment', () {
    expect(bookingNeedsPaymentReview(booking(status: 'Payment Pending')), isFalse);
    expect(
      bookingNeedsPaymentReview(booking(status: 'Payment Pending', proof: 'payments/proof.png')),
      isTrue,
    );
    expect(
      bookingNeedsPaymentReview(booking(
        status: 'Payment Pending',
        proof: 'payments/proof.png',
        paymentStatus: 'verified',
      )),
      isFalse,
    );
    expect(bookingNeedsPaymentReview(booking(status: 'Cancelled', proof: 'payments/proof.png')), isFalse);
  });

  test('dashboard filters and list membership share the same predicate', () {
    final arrival = booking(
      status: 'Approved',
      proof: 'payments/proof.png',
      paymentStatus: 'verified',
    );
    expect(bookingMatchesFilter(arrival, BookingListFilter.arrivalsToday, now), isTrue);
    expect(bookingMatchesFilter(arrival, BookingListFilter.pendingVerification, now), isFalse);
    expect(bookingFilterLabel(BookingListFilter.arrivalsToday), 'Darating Ngayon');
  });
}
