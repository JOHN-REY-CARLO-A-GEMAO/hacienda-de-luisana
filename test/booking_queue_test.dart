import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/services/booking_queue.dart';

BookingModel booking({
  required String status,
  String checkIn = '2026-10-25',
  String? proof,
  String paymentStatus = 'pending',
  String? refundStatus,
  DateTime? holdExpiresAt,
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
    // Only a *recorded* expiry can have run out (the web's rule too), so a
    // Pending without one stays reviewable rather than vanishing from the queue.
    // Test holds are built relative to `now` so the suite does not depend on the
    // runner's timezone.
    if (holdExpiresAt != null)
      'hold_expires_at': holdExpiresAt.toUtc().toIso8601String(),
    if (proof != null) 'payment_proof_url': proof,
    'payment_status': paymentStatus,
    if (refundStatus != null) 'refund_status': refundStatus,
  });
}

void main() {
  final now = DateTime(2026, 10, 25, 12);
  // A hold that ran out an hour ago, and one still running well past any
  // timezone offset the suite might run in.
  final lapsedHold = now.toUtc().subtract(const Duration(hours: 1));
  final runningHold = now.toUtc().add(const Duration(hours: 6));

  test('the five operational queues use canonical booking facts', () {
    final approval = booking(
      status: 'Pending',
      proof: 'payments/proof.png',
      holdExpiresAt: runningHold,
    );
    final arrival = booking(status: 'Reserved');
    final current = booking(status: 'Staying');
    final payment = booking(status: 'Payment Pending', proof: 'payments/proof.png');
    final refund = booking(status: 'Cancelled', refundStatus: 'initiated');

    expect(bookingNeedsApproval(approval, now), isTrue);
    expect(bookingArrivesToday(arrival, now), isTrue);
    expect(bookingIsCurrentGuest(current), isTrue);
    expect(bookingNeedsPaymentReview(payment), isTrue);
    expect(bookingNeedsAdminAction(refund, now), isTrue);
    expect(bookingIsUnattended(refund), isTrue);
  });

  test('approvals, payments and the "other" row never double-count a booking', () {
    final approval = booking(
      status: 'Pending',
      proof: 'payments/proof.png',
      holdExpiresAt: runningHold,
    );
    final payment = booking(status: 'Payment Pending', proof: 'payments/proof.png');
    final closing = booking(status: 'Checked-Out');
    final refund = booking(status: 'Cancelled', refundStatus: 'initiated');

    // The combined working queue still holds all four...
    for (final b in [approval, payment, closing, refund]) {
      expect(bookingNeedsAdminAction(b, now), isTrue);
    }
    // ...but the row named "Other admin actions" holds only what nothing else
    // owns. This is what made the dashboard print 7 payments and 8 "other"
    // actions for the same seven proofs.
    expect(bookingIsUnattended(approval), isFalse);
    expect(bookingIsUnattended(payment), isFalse);
    expect(bookingIsUnattended(closing), isTrue);
    expect(bookingIsUnattended(refund), isTrue);
  });

  test('one booking, one queue row: no Guest is listed twice', () {
    // A Pending that already carries a proof answers two questions at once —
    // "approve this" and "verify the payment". The dashboard used to print it
    // under both headings with the same next step, which is how the same guest
    // appeared in "Payments to verify" and again in "Other admin actions".
    final approvalWithProof = booking(
      status: 'Pending',
      proof: 'payments/proof.png',
      holdExpiresAt: runningHold,
    );
    final payment = booking(status: 'Payment Pending', proof: 'payments/proof.png');
    final closing = booking(status: 'Checked-Out');
    final refund = booking(status: 'Cancelled', refundStatus: 'initiated');
    final noDecision = booking(status: 'Staying');

    // The approval still matches both older predicates...
    expect(bookingNeedsApproval(approvalWithProof, now), isTrue);
    expect(bookingNeedsPaymentReview(approvalWithProof), isTrue);
    // ...but it is placed by exactly one action, the first in lifecycle order.
    expect(bookingQueueAction(approvalWithProof, now),
        BookingListFilter.pendingVerification);
    expect(bookingQueueAction(payment, now), BookingListFilter.paymentQueue);
    expect(bookingQueueAction(closing, now), BookingListFilter.needsAction);
    expect(bookingQueueAction(refund, now), BookingListFilter.needsAction);
    expect(bookingQueueAction(noDecision, now), isNull);

    // Placing every booking once means the row totals add up to the combined
    // working queue instead of exceeding it.
    final all = [approvalWithProof, payment, closing, refund, noDecision];
    final placed = all.where((b) => bookingQueueAction(b, now) != null).length;
    final inWorkingQueue = all.where((b) => bookingNeedsAdminAction(b, now)).length;
    expect(placed, inWorkingQueue);
    expect(placed, 4);
  });

  test('a Pending whose recorded date hold ran out is not live admin work', () {
    final lapsed = booking(
      status: 'Pending',
      proof: 'payments/proof.png',
      holdExpiresAt: lapsedHold,
    );

    expect(bookingHoldLapsed(lapsed, now), isTrue);
    expect(bookingNeedsApproval(lapsed, now), isFalse);
    expect(bookingNeedsAdminAction(lapsed, now), isFalse);
    expect(bookingMatchesFilter(lapsed, BookingListFilter.archivedExpired, now), isTrue);
    expect(bookingMatchesFilter(lapsed, BookingListFilter.pendingVerification, now), isFalse);
    // The stored status is untouched; only the reading changed.
    expect(lapsed.rawStatus, 'Pending');
  });

  test('a hold still running, or none on record, keeps the Booking reviewable', () {
    final live = booking(
      status: 'Pending',
      proof: 'payments/proof.png',
      holdExpiresAt: runningHold,
    );
    expect(bookingHoldLapsed(live, now), isFalse);
    expect(bookingNeedsApproval(live, now), isTrue);
    expect(bookingMatchesFilter(live, BookingListFilter.pendingVerification, now), isTrue);

    // A Booking stored before Date holds existed has no countdown to run out.
    // The web refuses to act only when a recorded hold has lapsed, so hiding
    // this one would strand it forever; it stays in the queue.
    final legacy = booking(status: 'Pending', proof: 'payments/proof.png');
    expect(bookingHoldLapsed(legacy, now), isFalse);
    expect(bookingNeedsApproval(legacy, now), isTrue);
    expect(bookingNeedsAdminAction(legacy, now), isTrue);
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

  test('archive buckets match their terminal statuses', () {
    expect(bookingMatchesFilter(booking(status: 'Completed'), BookingListFilter.archivedCompleted, now), isTrue);
    expect(bookingMatchesFilter(booking(status: 'Cancelled'), BookingListFilter.archivedCancelled, now), isTrue);
    expect(bookingMatchesFilter(booking(status: 'Rejected'), BookingListFilter.archivedRejected, now), isTrue);
    expect(bookingMatchesFilter(booking(status: 'Expired'), BookingListFilter.archivedExpired, now), isTrue);
    // A live stay is not archived anywhere.
    for (final bucket in BookingListFilter.archived) {
      expect(bookingMatchesFilter(booking(status: 'Staying'), bucket, now), isFalse);
      // A Pending whose hold is still running is live work, not an archive
      // bucket; the lapsed-hold test below covers the other half.
      expect(
        bookingMatchesFilter(
          booking(status: 'Pending', holdExpiresAt: runningHold),
          bucket,
          now,
        ),
        isFalse,
      );
      expect(
        bookingMatchesFilter(booking(status: 'Pending'), bucket, now),
        isFalse,
      );
    }
  });

  test('a Pending whose 24h hold lapsed reads as Expired in the archive', () {
    final lapsed = booking(
      status: 'Pending',
      checkIn: '2026-10-20',
      holdExpiresAt: lapsedHold,
    );
    expect(bookingMatchesFilter(lapsed, BookingListFilter.archivedExpired, now), isTrue);
    expect(bookingMatchesFilter(lapsed, BookingListFilter.archivedNoShow, now), isFalse);
  });

  test('no-show is derived: committed dates whose check-in day passed', () {
    final past = booking(status: 'Reserved', checkIn: '2026-10-20');
    expect(bookingMatchesFilter(past, BookingListFilter.archivedNoShow, now), isTrue);
    // A future reservation is not a no-show; a same-day one is not yet either.
    expect(bookingMatchesFilter(booking(status: 'Reserved', checkIn: '2026-10-26'), BookingListFilter.archivedNoShow, now), isFalse);
    expect(bookingMatchesFilter(booking(status: 'Reserved'), BookingListFilter.archivedNoShow, now), isFalse);
    // Checked-in stays never count as no-show.
    expect(bookingMatchesFilter(booking(status: 'Checked-In', checkIn: '2026-10-20'), BookingListFilter.archivedNoShow, now), isFalse);
    expect(bookingFilterLabel(BookingListFilter.archivedNoShow), 'No-show · Walang dumating');
  });
}
