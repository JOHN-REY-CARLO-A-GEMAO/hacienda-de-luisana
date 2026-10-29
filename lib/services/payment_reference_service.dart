// ---------------------------------------------------------------------------
// The Admin's write side of receipt extraction: the OCR result, and the
// reference a human has accepted.
//
// Three guarantees this file exists to hold, all of them checked here rather
// than in a screen so a second call site cannot forget them:
//
//  1. **Extraction never moves money.** The OCR write touches `ocr_*` fields
//     only. It cannot change `status`, `payment_status`, `amount_verified` or
//     the verification marker, so a receipt cannot approve itself no matter what
//     the recognizer read (ADR-0012).
//  2. **A verified reference is not overwritten by accident.** Once a Booking's
//     payment is verified, changing its reference needs an explicit
//     confirmation, and the previous value is kept on the record.
//  3. **The same reference does not quietly pay twice.** Before a reference is
//     stored, the Admin's `payment_references` rows are checked for it, and a
//     reference already filed against a different Booking is refused unless the
//     Admin says, on the record, that they have looked at both.
//
// Firestore, not a Cloud Function, because the Admin app already writes Bookings
// directly under `adminUpdate()` in `firestore.rules`; the new fields
// (`ocr_proof_url`, `ocr_engine`, `ocr_confidence`, `ocr_extracted_at`,
// `ocr_recipient_name`, `payment_reference_source`,
// `payment_reference_corrected_at/by`, `payment_reference_previous`) are outside
// the Guest's `hasOnly` vocabulary, so a Guest can neither write nor clear them.
// ---------------------------------------------------------------------------

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';

import '../core/constants/app_constants.dart';
import '../models/booking_model.dart';
import '../models/receipt_extraction.dart';
import 'receipt_ocr_service.dart';

/// Why a reference could not be stored.
enum PaymentReferenceSaveStatus {
  saved,

  /// The reference is not 6–40 letters, digits or hyphens.
  invalidReference,

  /// The date is not a real `YYYY-MM-DD`.
  invalidDate,

  /// Another Booking's payment row already carries this reference.
  duplicateReference,

  /// The Booking's payment is verified and its reference would change.
  overwriteNotConfirmed,

  /// No Firestore in this build (demo mode) or the write was refused.
  failed,
}

class PaymentReferenceSaveResult {
  final PaymentReferenceSaveStatus status;
  final String? message;

  /// The Booking the duplicate reference was filed against, when there is one.
  final String? duplicateBookingId;

  const PaymentReferenceSaveResult(this.status, {this.message, this.duplicateBookingId});

  bool get ok => status == PaymentReferenceSaveStatus.saved;
  bool get needsDuplicateConfirmation =>
      status == PaymentReferenceSaveStatus.duplicateReference;
  bool get needsOverwriteConfirmation =>
      status == PaymentReferenceSaveStatus.overwriteNotConfirmed;
}

/// What the Admin's reference catalogue says about one number.
class ReferenceLookup {
  /// A catalogue row (`available`/`used`/`void`, no Booking link) exists.
  final String? catalogStatus;

  /// A payment row filed against a *different* Booking.
  final String? otherBookingId;
  final String? otherGuestName;

  /// A payment row already filed against this very Booking.
  final bool filedForThisBooking;

  const ReferenceLookup({
    this.catalogStatus,
    this.otherBookingId,
    this.otherGuestName,
    this.filedForThisBooking = false,
  });

  static const ReferenceLookup none = ReferenceLookup();

  bool get isDuplicate => otherBookingId != null;

  /// True when the Admin already listed this number as an expected payment —
  /// a reason to look closely, never a reason to verify automatically.
  bool get isPublished => catalogStatus != null;

  bool get catalogAlreadyUsed => catalogStatus == 'used';
}

/// The result of one OCR pass plus the write that followed it.
class ReceiptReadResult {
  final ReceiptOcrOutcome outcome;

  /// Whether the extracted details reached the Booking document.
  final bool wroteToBooking;

  /// Set when the read succeeded but saving it did not.
  final String? writeError;

  const ReceiptReadResult({
    required this.outcome,
    this.wroteToBooking = false,
    this.writeError,
  });

  ReceiptExtraction? get extraction => outcome.extraction;
}

/// Marks a transaction that found the world had changed underneath it.
class _StaleProof implements Exception {
  const _StaleProof();
}

class _NeedsOverwriteConfirmation implements Exception {
  const _NeedsOverwriteConfirmation(this.currentReference);
  final String currentReference;
}

class PaymentReferenceService {
  PaymentReferenceService({
    FirebaseFirestore? firestore,
    ReceiptOcrService? ocr,
  })  : _injected = firestore,
        _ocr = ocr ?? ReceiptOcrService.instance;

  final FirebaseFirestore? _injected;
  final ReceiptOcrService _ocr;

  static final PaymentReferenceService instance = PaymentReferenceService();

  /// Firestore when this build has it, null in demo mode.
  FirebaseFirestore? get _db {
    if (_injected != null) return _injected;
    try {
      if (Firebase.apps.isEmpty) return null;
      return FirebaseFirestore.instance;
    } catch (_) {
      return null;
    }
  }

  /// Read the attached proof, and store what was read on the Booking.
  ///
  /// [force] re-reads even when a stored extraction already matches the attached
  /// proof — the Admin's "basahin muli" after a bad read. The write is guarded by
  /// a transaction that refuses to file the result if the proof was replaced
  /// while the recognizer was running, so extraction can never be attached to
  /// the wrong image.
  Future<ReceiptReadResult> readAndStore(
    BookingModel booking, {
    bool force = false,
  }) async {
    final outcome = await _ocr.readProof(booking, force: force);
    if (!outcome.producedValues || outcome.extraction == null) {
      return ReceiptReadResult(outcome: outcome);
    }
    if (outcome.status == ReceiptOcrStatus.alreadyProcessed) {
      return ReceiptReadResult(outcome: outcome, wroteToBooking: false);
    }
    final error = await _storeExtraction(booking, outcome);
    return ReceiptReadResult(
      outcome: outcome,
      wroteToBooking: error == null,
      writeError: error,
    );
  }

  Future<String?> _storeExtraction(
    BookingModel booking,
    ReceiptOcrOutcome outcome,
  ) async {
    final db = _db;
    if (db == null) {
      return 'Walang koneksyon sa database, kaya hindi na-save ang nabasa.';
    }
    final extraction = outcome.extraction!;
    final expectedPath = booking.paymentProofUrl?.trim() ?? '';
    final doc = db.collection(AppConstants.colBookings).doc(booking.id);

    try {
      await db.runTransaction((tx) async {
        final snap = await tx.get(doc);
        if (!snap.exists) throw const _StaleProof();
        final fresh = snap.data() ?? const <String, dynamic>{};
        final freshPath =
            (fresh['payment_proof_url'] ?? fresh['paymentProofUrl'] ?? '')
                .toString()
                .trim();
        if (freshPath != expectedPath) throw const _StaleProof();

        // Merge-only, and only OCR evidence: no status, no verified amount, no
        // reference the Guest or the Admin already stated. The reference the
        // Admin accepts is written by `saveCorrection`, deliberately.
        tx.set(
          doc,
          <String, dynamic>{
            'ocr_reference': extraction.reference,
            'ocr_amount': extraction.amount,
            'ocr_sender_name': _blankToNull(extraction.senderName),
            'ocr_recipient_name': _blankToNull(extraction.recipientName),
            'ocr_payment_date': _blankToNull(extraction.paymentDateIso),
            'ocr_proof_url': expectedPath,
            'ocr_engine': outcome.engine.isEmpty ? 'mlkit-latin' : outcome.engine,
            'ocr_confidence': extraction.confidence.name,
            'ocr_extracted_at': FieldValue.serverTimestamp(),
          },
          SetOptions(merge: true),
        );
      });
      return null;
    } on _StaleProof {
      return 'Nagpalit ang patunay habang binabasa ito. Buksan muli ang patunay at basahin ulit — hindi na-save ang lumang resulta.';
    } catch (_) {
      return 'Hindi na-save ang nabasang detalye. Subukan muli, o i-type na lang ang reference.';
    }
  }

  /// What the catalogue says about [reference], if anything.
  ///
  /// Read-only and never blocking: a reference that is absent from the catalogue
  /// is the normal case (the Admin only lists the ones they expect), so absence
  /// is not an error and must not be shown as one.
  Future<ReferenceLookup> checkReference(
    String reference, {
    String? excludeBookingId,
  }) async {
    final db = _db;
    final normalized = normalizeReference(reference);
    if (db == null || normalized.isEmpty) return ReferenceLookup.none;

    try {
      final snap = await db
          .collection(AppConstants.colPaymentReferences)
          .where('reference', isEqualTo: normalized)
          .limit(5)
          .get();

      String? catalogStatus;
      String? otherBookingId;
      String? otherGuestName;
      var filedHere = false;

      for (final doc in snap.docs) {
        final data = doc.data();
        final bookingId = (data['booking_id'] ?? '').toString();
        final status = (data['status'] ?? '').toString();
        if (bookingId.isEmpty) {
          catalogStatus ??= status;
          continue;
        }
        if (excludeBookingId != null && bookingId == excludeBookingId) {
          filedHere = true;
          continue;
        }
        otherBookingId ??= bookingId;
      }

      if (otherBookingId != null) {
        otherGuestName = await _guestNameFor(otherBookingId);
      }

      return ReferenceLookup(
        catalogStatus: catalogStatus,
        otherBookingId: otherBookingId,
        otherGuestName: otherGuestName,
        filedForThisBooking: filedHere,
      );
    } catch (_) {
      // A failed lookup must not stop the Admin from recording what the receipt
      // says; it only means the duplicate check could not be made.
      return ReferenceLookup.none;
    }
  }

  Future<String?> _guestNameFor(String bookingId) async {
    final db = _db;
    if (db == null) return null;
    try {
      final snap =
          await db.collection(AppConstants.colBookings).doc(bookingId).get();
      final data = snap.data();
      if (data == null) return null;
      return (data['guest_name'] ?? data['guestName'] ?? '').toString();
    } catch (_) {
      return null;
    }
  }

  /// Store the reference a human accepted, and the details they confirmed.
  ///
  /// [reference] is normalized before validation; [senderName] and
  /// [paymentDateIso] are optional, and an empty string clears the field (the
  /// Admin saying "the receipt does not name one").
  ///
  /// Nothing here changes `status`, `payment_status`, `amount_verified` or the
  /// verification marker. Approving the payment stays a separate, PIN-gated
  /// action.
  Future<PaymentReferenceSaveResult> saveCorrection(
    BookingModel booking, {
    required String reference,
    required String actorUid,
    String? senderName,
    String? paymentDateIso,
    bool confirmOverwrite = false,
    bool confirmDuplicate = false,
  }) async {
    final normalized = normalizeReference(reference);
    if (!isValidReference(normalized)) {
      return const PaymentReferenceSaveResult(
        PaymentReferenceSaveStatus.invalidReference,
        message:
            'Reference must be 6–40 characters: letters, numbers and hyphens only.',
      );
    }

    String? dateIso;
    if (paymentDateIso != null && paymentDateIso.trim().isNotEmpty) {
      dateIso = normalizeIsoDate(paymentDateIso);
      if (dateIso == null) {
        return const PaymentReferenceSaveResult(
          PaymentReferenceSaveStatus.invalidDate,
          message: 'Date must be a real calendar date in YYYY-MM-DD form.',
        );
      }
    } else if (paymentDateIso != null) {
      dateIso = '';
    }

    final db = _db;
    if (db == null) {
      return const PaymentReferenceSaveResult(
        PaymentReferenceSaveStatus.failed,
        message: 'Walang koneksyon sa database, kaya hindi na-save.',
      );
    }

    if (!confirmDuplicate) {
      final lookup = await checkReference(normalized, excludeBookingId: booking.id);
      if (lookup.isDuplicate) {
        final who = lookup.otherGuestName?.isNotEmpty == true
            ? lookup.otherGuestName
            : lookup.otherBookingId;
        return PaymentReferenceSaveResult(
          PaymentReferenceSaveStatus.duplicateReference,
          duplicateBookingId: lookup.otherBookingId,
          message:
              'Nakatala na ang reference $normalized para sa Booking ni $who. '
              'Isang reference, isang bayad — suriin muna bago ituloy.',
        );
      }
    }

    final doc = db.collection(AppConstants.colBookings).doc(booking.id);
    try {
      await db.runTransaction((tx) async {
        final snap = await tx.get(doc);
        if (!snap.exists) {
          throw const _StaleProof();
        }
        final fresh = snap.data() ?? const <String, dynamic>{};
        final current = (fresh['payment_reference'] ?? '').toString().trim();
        final verified = (fresh['payment_status'] ?? '').toString().toLowerCase() ==
                'verified' &&
            (fresh['amount_verified'] is num) &&
            (fresh['amount_verified'] as num) > 0;

        // Once money is verified, the reference on the record is what the
        // verification was based on. Replacing it is allowed — receipts do get
        // mis-typed — but only when the Admin has said so explicitly.
        if (verified && current.isNotEmpty && current != normalized && !confirmOverwrite) {
          throw _NeedsOverwriteConfirmation(current);
        }

        final patch = <String, dynamic>{
          'payment_reference': normalized,
          'payment_reference_source': 'admin_corrected',
          'payment_reference_corrected_at': FieldValue.serverTimestamp(),
          'payment_reference_corrected_by': actorUid,
          if (current.isNotEmpty && current != normalized)
            'payment_reference_previous': current,
          if (senderName != null) 'payment_sender_name': _blankToNull(senderName),
          if (dateIso != null) 'payment_date': _blankToNull(dateIso),
        };
        tx.set(doc, patch, SetOptions(merge: true));
      });
      return const PaymentReferenceSaveResult(PaymentReferenceSaveStatus.saved);
    } on _NeedsOverwriteConfirmation catch (pending) {
      return PaymentReferenceSaveResult(
        PaymentReferenceSaveStatus.overwriteNotConfirmed,
        message:
            'Beripikado na ang bayad na ito laban sa reference ${pending.currentReference}. '
            'Kumpirmahin kung talagang papalitan ito ng $normalized.',
      );
    } on _StaleProof {
      return const PaymentReferenceSaveResult(
        PaymentReferenceSaveStatus.failed,
        message: 'Wala na ang Booking na ito. I-refresh ang listahan.',
      );
    } catch (_) {
      return const PaymentReferenceSaveResult(
        PaymentReferenceSaveStatus.failed,
        message: 'Hindi na-save ang reference. Subukan muli.',
      );
    }
  }

  static String? _blankToNull(String? value) {
    final trimmed = value?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }
}
