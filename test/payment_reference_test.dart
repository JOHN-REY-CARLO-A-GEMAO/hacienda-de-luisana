import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/models/receipt_extraction.dart';
import 'package:hacienda_de_luisana/services/payment_reference_service.dart';
import 'package:hacienda_de_luisana/services/receipt_ocr_service.dart';

/// A Booking shaped like one the website creates: a pending downpayment with a
/// proof attached, plus whatever OCR fields a test needs.
BookingModel bookingWith(Map<String, dynamic> extra) => BookingModel.fromJson({
      'guest_name': 'Ana Cruz',
      'phone': '09171234567',
      'email': 'ana@example.com',
      'check_in': '2026-09-01',
      'check_out': '2026-09-02',
      'guests': 2,
      'accommodation': 'main-house',
      'status': 'Pending',
      'payment_status': 'pending',
      'payment_proof_url': 'payments/uid123/HDL-1/proof-1.jpg',
      'amount_claimed': 4500,
      'amount_due': 4500,
      'stay_total': 9000,
      'created_at': '2026-08-01T09:00:00Z',
      ...extra,
    }, 'booking-1');

void main() {
  group('the Payment Reference field the Admin app shows', () {
    test('is empty when neither a human nor OCR supplied a number', () {
      final booking = bookingWith({});
      expect(booking.effectivePaymentReference, isNull);
      expect(booking.paymentReferenceIsMachineRead, isFalse);
    });

    test('falls back to the OCR read, and says it is not confirmed', () {
      final booking = bookingWith({'ocr_reference': '7044357122304'});
      expect(booking.effectivePaymentReference, '7044357122304');
      expect(booking.paymentReferenceIsMachineRead, isTrue);
    });

    test('prefers the reference a human accepted over the machine read', () {
      final booking = bookingWith({
        'ocr_reference': '7044357122304',
        'payment_reference': 'GCASH-123456',
        'payment_reference_source': 'admin_corrected',
      });
      expect(booking.effectivePaymentReference, 'GCASH-123456');
      expect(booking.paymentReferenceIsMachineRead, isFalse);
      expect(booking.paymentReferenceWasCorrected, isTrue);
    });

    test('only reads as verified with both the status and a verified amount', () {
      final flaggedOnly = bookingWith({'payment_status': 'verified'});
      expect(flaggedOnly.paymentIsVerified, isFalse);

      final halfWritten = bookingWith({'amount_verified': 4500});
      expect(halfWritten.paymentIsVerified, isFalse);

      final verified =
          bookingWith({'payment_status': 'verified', 'amount_verified': 4500});
      expect(verified.paymentIsVerified, isTrue);
    });

    test('a read that describes another proof is stale', () {
      final fresh = bookingWith({
        'ocr_proof_url': 'payments/uid123/HDL-1/proof-1.jpg',
      });
      expect(fresh.ocrReadIsStale, isFalse);

      final replaced = bookingWith({
        'ocr_proof_url': 'payments/uid123/HDL-1/proof-1.jpg',
        'payment_proof_url': 'payments/uid123/HDL-1/proof-2.jpg',
      });
      expect(replaced.ocrReadIsStale, isTrue);
    });

    test('a legacy row with no ocr_proof_url is not treated as stale', () {
      final legacy = bookingWith({'ocr_reference': '7044357122304'});
      expect(legacy.ocrReadIsStale, isFalse);
    });
  });

  group('ReceiptExtraction.fromBooking', () {
    test('reads the stored OCR fields the website wrote', () {
      final booking = bookingWith({
        'ocr_reference': '7044357122304',
        'ocr_amount': '1020.00',
        'ocr_sender_name': 'JUAN DELA CRUZ',
        'ocr_payment_date': '2026-08-26',
      });
      final extraction = ReceiptExtraction.fromBooking(booking);
      expect(extraction.reference, '7044357122304');
      expect(extraction.amount, '1020.00');
      expect(extraction.senderName, 'JUAN DELA CRUZ');
      expect(extraction.paymentDateIso, '2026-08-26');
      expect(extraction.confidence, ReceiptConfidence.high);
    });

    test('normalizes a lower-case reference and drops an invalid date', () {
      final booking = bookingWith({
        'ocr_reference': ' gcash-123456 ',
        'ocr_payment_date': 'not a date',
      });
      final extraction = ReceiptExtraction.fromBooking(booking);
      expect(extraction.reference, 'GCASH-123456');
      expect(extraction.paymentDateIso, '');
      expect(extraction.confidence, ReceiptConfidence.low);
    });

    test('an empty Booking has nothing to show and no confidence', () {
      final extraction = ReceiptExtraction.fromBooking(bookingWith({}));
      expect(extraction.hasAnything, isFalse);
      expect(extraction.confidence, ReceiptConfidence.none);
    });
  });

  group('ReceiptOcrService.storedReadIsCurrent', () {
    test('a stored read for the attached proof needs no re-scan', () {
      final booking = bookingWith({
        'ocr_reference': '7044357122304',
        'ocr_proof_url': 'payments/uid123/HDL-1/proof-1.jpg',
      });
      expect(ReceiptOcrService.storedReadIsCurrent(booking), isTrue);
    });

    test('a re-sent proof makes the stored read stale', () {
      final booking = bookingWith({
        'ocr_reference': '7044357122304',
        'ocr_proof_url': 'payments/uid123/HDL-1/proof-1.jpg',
        'payment_proof_url': 'payments/uid123/HDL-1/proof-2.jpg',
      });
      expect(ReceiptOcrService.storedReadIsCurrent(booking), isFalse);
    });

    test('a Booking without a proof has nothing current', () {
      final booking = bookingWith({'payment_proof_url': null});
      expect(ReceiptOcrService.storedReadIsCurrent(booking), isFalse);
    });

    test('a legacy read with no recorded proof path is trusted while it has values',
        () {
      expect(
        ReceiptOcrService.storedReadIsCurrent(
            bookingWith({'ocr_reference': '7044357122304'})),
        isTrue,
      );
      expect(ReceiptOcrService.storedReadIsCurrent(bookingWith({})), isFalse);
    });
  });

  group('ReferenceLookup', () {
    test('a reference filed against another Booking is a duplicate', () {
      const lookup = ReferenceLookup(otherBookingId: 'booking-2');
      expect(lookup.isDuplicate, isTrue);
    });

    test('a reference already filed for this Booking is not a duplicate', () {
      const lookup = ReferenceLookup(filedForThisBooking: true);
      expect(lookup.isDuplicate, isFalse);
    });

    test('a catalogue entry is worth showing, and is not a duplicate', () {
      const lookup = ReferenceLookup(catalogStatus: 'available');
      expect(lookup.isPublished, isTrue);
      expect(lookup.isDuplicate, isFalse);
      expect(lookup.catalogAlreadyUsed, isFalse);

      const used = ReferenceLookup(catalogStatus: 'used');
      expect(used.catalogAlreadyUsed, isTrue);
    });
  });

  group('a manual reference correction that could not be saved', () {
    test('a permission refusal names the deployed rules and the real role sources', () {
      final result = PaymentReferenceSaveResult.writeError(FirebaseException(
        plugin: 'cloud_firestore',
        code: 'permission-denied',
        message: 'Missing or insufficient permissions.',
      ));
      expect(result.ok, isFalse);
      expect(result.status, PaymentReferenceSaveStatus.failed);
      expect(result.failure, ReceiptWriteFailure.permissionDenied);
      expect(result.message, startsWith('Hindi na-save ang reference.'));
      expect(result.message, contains('firestore.rules'));
      expect(result.message, contains('profiles/<uid>.role'));
      expect(result.message, contains('token'));
      expect(result.message, isNot(contains('users/{uid}')));
    });

    test('an unacknowledged write is not reported as saved or queued', () {
      for (final code in ['unavailable', 'deadline-exceeded']) {
        final result = PaymentReferenceSaveResult.writeError(
          FirebaseException(plugin: 'cloud_firestore', code: code),
        );
        expect(result.ok, isFalse);
        expect(result.failure, ReceiptWriteFailure.offline);
        expect(result.message, contains('signal'));
        expect(result.message, isNot(contains('nai-queue')));
      }
    });

    test('a missing Booking asks for a refresh rather than a blind retry', () {
      final result = PaymentReferenceSaveResult.writeError(
        FirebaseException(plugin: 'cloud_firestore', code: 'not-found'),
      );
      expect(result.ok, isFalse);
      expect(result.failure, ReceiptWriteFailure.missingBooking);
      expect(result.message, contains('I-refresh ang listahan'));
    });

    test('an unexpected exception keeps its raw details out of the notice', () {
      final result = PaymentReferenceSaveResult.writeError(
        StateError('private implementation detail'),
      );
      expect(result.ok, isFalse);
      expect(result.failure, ReceiptWriteFailure.unknown);
      expect(result.message, 'Hindi na-save ang reference. Subukan muli.');
      expect(result.message, isNot(contains('private implementation detail')));
    });
  });

  group('a read that could not be filed', () {
    // The panel used to show one sentence for every accident — a dropped
    // connection, a refused write, a deleted Booking — which is why a screenshot
    // was needed to tell them apart. These pin the mapping it now prints.
    test('names the cause Firestore reported', () {
      expect(
        receiptWriteFailureFor(FirebaseException(
          plugin: 'cloud_firestore',
          code: 'permission-denied',
          message: 'Missing or insufficient permissions.',
        )),
        ReceiptWriteFailure.permissionDenied,
      );
      expect(
        receiptWriteFailureFor(
            FirebaseException(plugin: 'cloud_firestore', code: 'unavailable')),
        ReceiptWriteFailure.offline,
      );
      expect(
        receiptWriteFailureFor(
            FirebaseException(plugin: 'cloud_firestore', code: 'not-found')),
        ReceiptWriteFailure.missingBooking,
      );
      expect(
        receiptWriteFailureFor(StateError('not a Firebase error')),
        ReceiptWriteFailure.unknown,
      );
    });

    test('tells the Admin what to do, and stays quiet when the message says it', () {
      final denied = receiptWriteAdvice(ReceiptWriteFailure.permissionDenied);
      // The advice has to name this project's role sources: profiles/{uid},
      // a verified allowlisted email, and a token refresh. Pointing the Admin
      // at users/{uid} or an `admin` custom claim sends them to a collection
      // and a claim the rules never read.
      expect(denied, contains('firestore.rules'));
      expect(denied, contains('profiles/<uid>.role'));
      expect(denied, contains('verified'));
      expect(denied, contains('token'));
      expect(receiptWriteAdvice(ReceiptWriteFailure.offline), isNotEmpty);
      expect(receiptWriteAdvice(ReceiptWriteFailure.missingBooking), isNotEmpty);
      // A stale proof and a demo build already explain themselves in the
      // sentence the service returns; repeating it is noise on a phone screen.
      expect(receiptWriteAdvice(ReceiptWriteFailure.staleProof), isEmpty);
      expect(receiptWriteAdvice(ReceiptWriteFailure.noDatabase), isEmpty);
      expect(receiptWriteAdvice(ReceiptWriteFailure.unknown), isEmpty);
    });
  });
}
