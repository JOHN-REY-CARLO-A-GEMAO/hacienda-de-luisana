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
//  4. **A verified payment always leaves a row.** `recordVerifiedBookingReference`
//     files the `payment_references` row from whichever screen approved the
//     Booking, deterministically and idempotently, so the Payment references
//     screen is never empty about money that was verified.
//
// Firestore, not a Cloud Function: `firestore.rules` gives the OCR patch and
// the human correction patch separate Admin-only doors
// (`adminOcrEvidenceUpdate()` / `adminReferenceCorrectionUpdate()`). Both are
// closed key sets, so evidence can be filed even on a historical Booking whose
// stored status the general update rule refuses, without changing money.
//
// The correction metadata
// (`ocr_extracted_at`, `ocr_recipient_name`, `payment_reference_source`,
// `payment_reference_corrected_at/by`, `payment_reference_previous`) is outside
// the Guest's `hasOnly` vocabulary, so a Guest can neither write nor clear it;
// the provenance triple (`ocr_proof_url`, `ocr_engine`, `ocr_confidence`) is
// deliberately inside it, because the Guest website stamps its own read with
// them at submit and re-send so this app can tell which proof object that read
// describes. The verified-money fields stay the Admin's either way (ADR-0012).
// ---------------------------------------------------------------------------

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

import '../core/constants/app_constants.dart';
import '../models/booking_model.dart';
import '../models/receipt_extraction.dart';
import 'receipt_ocr_service.dart';

/// How long the queued second attempt waits for Firestore to acknowledge the
/// write before treating it as filed.
///
/// A write made without a connection goes into Firestore's local queue and is
/// sent when the signal returns; the SDK's acknowledgement can take as long as
/// the network takes to come back. Waiting for it is not waiting for anything
/// the Admin can decide about now, and it must never leave the panel spinning.
const Duration receiptWriteAckTimeout = Duration(seconds: 12);

/// How long the second attempt waits for its proof pre-check.
///
/// Shorter than the write: a read that has not answered in five seconds on a
/// connection that just dropped is not going to settle the question, and the
/// write carries the proof path anyway.
const Duration receiptWritePrecheckTimeout = Duration(seconds: 5);

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

  /// The classified cause when Firestore, rather than a validation or a
  /// confirmation guard, refused the write. Shared with the OCR save path.
  final ReceiptWriteFailure? failure;

  const PaymentReferenceSaveResult(
    this.status, {
    this.message,
    this.duplicateBookingId,
    this.failure,
  });

  /// The same actionable advice as an OCR refusal, without exposing the raw
  /// exception (which may contain Guest details) in the Admin's notice.
  factory PaymentReferenceSaveResult.writeError(Object error) {
    final failure = receiptWriteFailureFor(error);
    final advice = receiptWriteAdvice(failure);
    return PaymentReferenceSaveResult(
      PaymentReferenceSaveStatus.failed,
      failure: failure,
      message: failure == ReceiptWriteFailure.missingBooking
          ? 'Wala na ang Booking na ito. I-refresh ang listahan.'
          : 'Hindi na-save ang reference. '
              '${advice.isEmpty ? 'Subukan muli.' : advice}',
    );
  }

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

/// Why filing receipt evidence or a human reference correction did not land.
///
/// The Admin is standing in front of a receipt and a decision; "hindi na-save"
/// on its own tells them nothing they can act on. The cause is classified so
/// the panel can say what to do — deploy the rules, wait for signal, refresh —
/// instead of one sentence that reads the same for all of them.
enum ReceiptWriteFailure {
  /// Firestore refused the write: the rules, or an account that is not the
  /// Admin's. Nothing the app can retry its way out of.
  permissionDenied,

  /// Firestore could not be reached. A plain write is queued and lands later;
  /// a transaction is not, which is why the second attempt exists.
  offline,

  /// The Booking is gone. Refresh the list.
  missingBooking,

  /// The attached proof changed while it was being read.
  staleProof,

  /// No Firestore in this build (demo mode).
  noDatabase,

  /// Anything else. The device log holds the cause.
  unknown,
}

/// The cause behind [ReceiptReadResult.writeError], read from the exception
/// Firestore threw.
///
/// Kept as a free function, outside the service, so the mapping is testable
/// without a database or a device — the same reason the parsers are.
ReceiptWriteFailure receiptWriteFailureFor(Object error) {
  final code = error is FirebaseException ? error.code : '';
  switch (code) {
    case 'permission-denied':
    case 'unauthenticated':
      return ReceiptWriteFailure.permissionDenied;
    case 'unavailable':
    case 'deadline-exceeded':
    case 'network-request-failed':
      return ReceiptWriteFailure.offline;
    case 'not-found':
      return ReceiptWriteFailure.missingBooking;
    default:
      return ReceiptWriteFailure.unknown;
  }
}

/// What the Admin should do about [failure], in one sentence.
///
/// Empty when the failure message already carries the next step (a stale proof
/// says to read the new image; demo mode has no database to save into), so the
/// notice never repeats itself.
String receiptWriteAdvice(ReceiptWriteFailure failure) {
  switch (failure) {
    case ReceiptWriteFailure.permissionDenied:
      // Name the three things that actually decide this, in this project's
      // vocabulary. A generic "check users/{uid}.role" sends the Admin to a
      // collection that does not exist here — the role is at profiles/{uid},
      // and the bootstrap address needs a verified email on the ID token.
      return 'Tinanggihan ng Firestore ang pagsulat (permission-denied): '
          'i-deploy ang firestore.rules sa tamang project; tiyaking Admin ang '
          'session (profiles/<uid>.role = "admin" o verified na allowlisted '
          'email); at mag-sign out / sign in muli para ma-refresh ang token.';
    case ReceiptWriteFailure.offline:
      return 'Hindi naabot ang Firestore — subukan muli kapag may signal.';
    case ReceiptWriteFailure.missingBooking:
      return 'Wala na ang Booking na ito — i-refresh ang listahan.';
    case ReceiptWriteFailure.staleProof:
    case ReceiptWriteFailure.noDatabase:
    case ReceiptWriteFailure.unknown:
      return '';
  }
}

/// What the Admin should be told when the `payment_references` collection
/// cannot be read.
///
/// The collection is Admin-only (`allow read: if isAdmin()`), so a refusal is a
/// statement about the session — the deployed ruleset or the role — and never
/// about whether there are payments to show. The screen used to swallow this in
/// a `print` and fall through to "No payment records yet", which reads as "the
/// revenue screen is empty" rather than "you are signed in as a Guest".
String receiptReadRefusalMessage(Object error) {
  switch (receiptWriteFailureFor(error)) {
    case ReceiptWriteFailure.permissionDenied:
      return 'Tinanggihan ng Firestore ang pagbasa (permission-denied). '
          'Ang Payment references ay Admin-only: i-deploy ang firestore.rules '
          'ng commit na ito, at tiyaking Admin ang session '
          '(profiles/<uid>.role = "admin" o verified na allowlisted email), '
          'tapos mag-sign out at sign in muli para ma-refresh ang token.';
    case ReceiptWriteFailure.offline:
      return 'Hindi naabot ang Firestore. Subukan muli kapag may signal.';
    case ReceiptWriteFailure.noDatabase:
      return 'Walang Firestore sa build na ito (demo mode).';
    case ReceiptWriteFailure.missingBooking:
    case ReceiptWriteFailure.staleProof:
    case ReceiptWriteFailure.unknown:
      return 'Hindi ma-read ang payment references ngayon. Subukan muli — '
          'ang detalyeng teknikal ay nasa device log.';
  }
}

/// Put the identity Firestore actually judged into the device log.
///
/// A refused write arrives as a bare `permission-denied`, with no hint of
/// *which* of the three facts was missing: the token's verified allowlist
/// address, `profiles/{uid}.role == 'admin'`, or the deployed ruleset. This is
/// the log line that turns step 3 of the diagnosis into something the person
/// holding the phone can check, and it deliberately names the role sources
/// this project uses rather than `users/{uid}` or an `admin` custom claim.
Future<void> logReceiptWriterIdentity(String reason) async {
  try {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      debugPrint('[PaymentReference] $reason: no signed-in Firebase user');
      return;
    }
    final result = await user.getIdTokenResult();
    debugPrint('[PaymentReference] $reason: uid=${user.uid} '
        'email=${user.email} user.emailVerified=${user.emailVerified} '
        'token.email=${result.claims?['email']} '
        'token.email_verified=${result.claims?['email_verified']}');
    debugPrint('[PaymentReference] firestore.rules resolves this writer from '
        'profiles/${user.uid}.role == "admin" or a verified adminEmails() '
        'address; custom claims and users/{uid} grant nothing here.');
  } catch (error) {
    debugPrint('[PaymentReference] writer identity unavailable: $error');
  }
}

/// The result of one OCR pass plus the write that followed it.
class ReceiptReadResult {
  final ReceiptOcrOutcome outcome;

  /// Whether the extracted details reached the Booking document.
  final bool wroteToBooking;

  /// Set when the read succeeded but saving it did not.
  final String? writeError;

  /// The classified cause behind [writeError], for the panel's next step.
  final ReceiptWriteFailure? writeFailure;

  const ReceiptReadResult({
    required this.outcome,
    this.wroteToBooking = false,
    this.writeError,
    this.writeFailure,
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

/// What happened to one extraction write: nothing on success, and otherwise the
/// sentence the Admin reads plus the cause behind it.
class _ExtractionWrite {
  final String? error;
  final ReceiptWriteFailure? failure;

  const _ExtractionWrite({this.error, this.failure});
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
  /// proof — the Admin's "basahin muli" after a bad read. The write is guarded so
  /// extraction can never be attached to a proof that was replaced while the
  /// recognizer was running.
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
    final write = await _storeExtraction(booking, outcome);
    return ReceiptReadResult(
      outcome: outcome,
      wroteToBooking: write.error == null,
      writeError: write.error,
      writeFailure: write.failure,
    );
  }

  /// File one read on the Booking, twice if it must.
  ///
  /// **First attempt: a transaction.** It re-reads the Booking and refuses the
  /// write if the attached proof is no longer the one the recognizer saw, so a
  /// read can never be filed against an image that was replaced mid-read.
  ///
  /// **Second attempt: a plain update.** A Firestore transaction needs a live
  /// connection and is *not* queued offline, while a normal write is; the Admin
  /// reviews proofs in places where the signal comes and goes (ADR-0023 chose an
  /// on-device recognizer partly for that reason), and the first version of this
  /// method turned every dropped connection into "Hindi na-save ang nabasang
  /// detalye" beside four fields the Admin had just watched the app read. The
  /// staleness guard is kept by reading the proof path first, and it is also
  /// carried *inside* the write: `ocr_proof_url` names the object this read
  /// describes, so a read that lands after a re-send is shown as stale
  /// (`BookingModel.ocrReadIsStale`) rather than believed.
  ///
  /// `update`, not `set(merge:)`, on the second path: a merge-set on a deleted
  /// Booking would conjure a document holding nothing but OCR fields, while an
  /// update fails honestly with `not-found`.
  ///
  /// Neither path touches `status`, `payment_status`, `amount_verified` or the
  /// verification marker. A receipt still cannot approve itself.
  Future<_ExtractionWrite> _storeExtraction(
    BookingModel booking,
    ReceiptOcrOutcome outcome,
  ) async {
    final db = _db;
    if (db == null) {
      return const _ExtractionWrite(
        error: 'Walang koneksyon sa database, kaya hindi na-save ang nabasa.',
        failure: ReceiptWriteFailure.noDatabase,
      );
    }
    final extraction = outcome.extraction!;
    final expectedPath = booking.paymentProofUrl?.trim() ?? '';
    final doc = db.collection(AppConstants.colBookings).doc(booking.id);

    // Merge-only, and only OCR evidence: no status, no verified amount, no
    // reference the Guest or the Admin already stated. The reference the Admin
    // accepts is written by `saveCorrection`, deliberately.
    final patch = <String, dynamic>{
      'ocr_reference': extraction.reference,
      'ocr_amount': extraction.amount,
      'ocr_sender_name': _blankToNull(extraction.senderName),
      'ocr_recipient_name': _blankToNull(extraction.recipientName),
      'ocr_payment_date': _blankToNull(extraction.paymentDateIso),
      'ocr_proof_url': expectedPath,
      'ocr_engine': outcome.engine.isEmpty ? 'mlkit-latin' : outcome.engine,
      'ocr_confidence': extraction.confidence.name,
      'ocr_extracted_at': FieldValue.serverTimestamp(),
    };

    Object? transactionError;
    try {
      await db.runTransaction((tx) async {
        final snap = await tx.get(doc);
        if (!snap.exists) throw const _StaleProof();
        if (_proofPathIn(snap.data()) != expectedPath) throw const _StaleProof();
        tx.set(doc, patch, SetOptions(merge: true));
      });
      return const _ExtractionWrite();
    } on _StaleProof {
      return const _ExtractionWrite(
        error: 'Nagpalit ang patunay habang binabasa ito. Buksan muli ang patunay '
            'at basahin ulit — hindi na-save ang lumang resulta.',
        failure: ReceiptWriteFailure.staleProof,
      );
    } catch (error, stack) {
      // The Admin gets the next step; the log gets the cause. A swallowed
      // exception here is the difference between "the save button is broken"
      // and a `permission-denied` somebody can act on.
      transactionError = error;
      debugPrint('[PaymentReference] OCR read could not be filed in a '
          'transaction: $error');
      debugPrint('$stack');
      if (receiptWriteFailureFor(error) ==
          ReceiptWriteFailure.permissionDenied) {
        await logReceiptWriterIdentity('transaction refused by Firestore');
      }
    }

    try {
      await _assertProofUnchanged(doc, expectedPath);
      await doc.update(patch).timeout(receiptWriteAckTimeout);
      debugPrint('[PaymentReference] OCR read filed without a transaction '
          '(first attempt failed: $transactionError)');
      return const _ExtractionWrite();
    } on TimeoutException {
      // Firestore took the write into its local queue; it lands when the signal
      // returns. That is not a failure the Admin should have to read about —
      // the read is on the device and on its way, not lost.
      debugPrint('[PaymentReference] OCR read queued offline; it will be filed '
          'when the connection returns (first attempt failed: $transactionError)');
      return const _ExtractionWrite();
    } on _StaleProof {
      return const _ExtractionWrite(
        error: 'Nagpalit ang patunay habang binabasa ito. Buksan muli ang patunay '
            'at basahin ulit — hindi na-save ang lumang resulta.',
        failure: ReceiptWriteFailure.staleProof,
      );
    } catch (error, stack) {
      debugPrint('[PaymentReference] OCR read could not be filed: $error');
      debugPrint('$stack');
      final failure = receiptWriteFailureFor(error);
      if (failure == ReceiptWriteFailure.permissionDenied) {
        await logReceiptWriterIdentity('update refused by Firestore');
      }
      return _ExtractionWrite(
        error: failure == ReceiptWriteFailure.missingBooking
            ? 'Wala na ang Booking na ito, kaya hindi na-save ang nabasa.'
            : 'Hindi na-save ang nabasang detalye. Subukan muli, o i-type na '
                'lang ang reference.',
        failure: failure,
      );
    }
  }

  /// The second attempt's staleness check: the same question the transaction
  /// asked, asked once more before a queued write.
  ///
  /// Deliberately best effort. The guard is also carried *inside* the patch —
  /// `ocr_proof_url` names the object the read describes, and
  /// `BookingModel.ocrReadIsStale` is what the panel compares before believing
  /// it — so a pre-check that cannot be made (nothing cached, no connection) is
  /// not a reason to throw away a read the Admin is looking at.
  Future<void> _assertProofUnchanged(
    DocumentReference<Map<String, dynamic>> doc,
    String expectedPath,
  ) async {
    DocumentSnapshot<Map<String, dynamic>> snap;
    try {
      snap = await doc.get().timeout(receiptWritePrecheckTimeout);
    } catch (error) {
      debugPrint('[PaymentReference] proof pre-check skipped: $error');
      return;
    }
    if (!snap.exists) throw const _StaleProof();
    if (_proofPathIn(snap.data()) != expectedPath) throw const _StaleProof();
  }

  /// The proof path a stored Booking carries, under either spelling the app and
  /// the website have used for it.
  static String _proofPathIn(Map<String, dynamic>? data) {
    if (data == null) return '';
    return (data['payment_proof_url'] ?? data['paymentProofUrl'] ?? '')
        .toString()
        .trim();
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
        failure: ReceiptWriteFailure.noDatabase,
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
        failure: ReceiptWriteFailure.missingBooking,
      );
    } catch (error, stack) {
      // The dialog has already closed by this point. Keep the actual cause,
      // stack and refused path in the device log, rather than swallowing it
      // behind the panel's generic retry sentence. Do not log the reference,
      // sender name or the patch: the identity and the cause are enough.
      debugPrint('[PaymentReference Save Error] ${doc.path}: $error');
      debugPrint('$stack');
      final result = PaymentReferenceSaveResult.writeError(error);
      if (result.failure == ReceiptWriteFailure.permissionDenied) {
        await logReceiptWriterIdentity('reference correction refused by Firestore');
      }
      // Unlike an OCR-only write, this transaction must not be replaced by a
      // queued plain update: its fresh read enforces the verified-reference
      // confirmation. An offline failure stays a failure until acknowledged.
      return result;
    }
  }

  static String? _blankToNull(String? value) {
    final trimmed = value?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }

  /// File the `payment_references` row a payment an Admin just verified owes.
  ///
  /// This is the write the Payment references screen reads. It used to live as a
  /// private method on the verification queue, which is why a payment verified
  /// from the Booking detail screen or from a card in the Bookings list left
  /// that screen saying "No payment records yet" about money that had just been
  /// approved: only one of the three approval paths filed a row at all. It lives
  /// here now, and [FirestoreService.applyBookingAction] calls it for every
  /// approval, so no call site can forget it.
  ///
  /// Idempotent, in two ways. The document id is deterministic
  /// (`reference` + Booking id), and the insert runs in a transaction that
  /// reads the document first and writes only when it is absent — so two
  /// concurrent verifications of the same reference can never insert a second
  /// row, and a re-run (or the Payment references screen's backfill) is a no-op.
  ///
  /// [verifiedAmount] is the money the decision recorded. [confirmedReference]
  /// is the number a human accepted *in this flow*; when it is absent the
  /// Booking's own [BookingModel.effectivePaymentReference] is used, so a
  /// payment verified after OCR pre-filled the field still files its row.
  ///
  /// Status: `verified` when a human supplied or accepted the number, and
  /// `pending_review` when the only number that ever existed is the machine's
  /// read. A reference nobody has agreed to is still worth filing — the Payment
  /// references screen can correct it from there — but it must not be recorded
  /// as agreed. This matches the values `firestore.rules` accepts on
  /// `match /payment_references/{refId}`.
  ///
  /// Never throws. A failure to file the row must not hide a successful
  /// verification: the money decision stands, and the row can be backfilled.
  Future<void> recordVerifiedBookingReference(
    BookingModel booking, {
    required double verifiedAmount,
    String? confirmedReference,
  }) async {
    final raw = (confirmedReference ?? booking.effectivePaymentReference)?.trim();
    if (raw == null || raw.isEmpty) return;
    final normalized = normalizeReference(raw);
    if (!isValidReference(normalized)) return;

    final db = _db;
    if (db == null) return; // demo mode: no collection to file into
    final row = paymentReferenceRow(
      booking,
      normalizedReference: normalized,
      verifiedAmount: verifiedAmount,
      confirmedReference: confirmedReference,
    );
    try {
      final docRef = db
          .collection(AppConstants.colPaymentReferences)
          .doc(paymentReferenceDocId(normalized, booking.id));

      await db.runTransaction((transaction) async {
        final existing = await transaction.get(docRef);
        if (existing.exists) return; // already filed — idempotent no-op
        transaction.set(docRef, row);
      });
    } catch (error, stack) {
      debugPrint('[PaymentReference] could not record the reference row for '
          '${booking.id}: $error');
      debugPrint('$stack');
    }
  }
}

/// Who supplied the reference a payment row records.
///
/// A reference confirmed in this very flow is the Admin accepting it now; a
/// reference already on the Booking came from the Guest (or from an Admin's
/// earlier correction); anything left is the machine's read, and only the first
/// two are a statement a human has actually made.
///
/// A free function, outside the service, so the rule is a test rather than a
/// guess — the same reason the failure mapping above is one.
String paymentReferenceSourceFor(
  BookingModel booking, {
  String? confirmedReference,
}) {
  if (confirmedReference != null) return 'admin_confirmed';
  final guestClaimed = (booking.paymentReference ?? '').trim();
  if (guestClaimed.isEmpty) return 'ocr';
  return booking.paymentReferenceWasCorrected ? 'admin_confirmed' : 'guest_claimed';
}

/// The `status` a `payment_references` row may carry for [source].
///
/// `verified` only where a human supplied or accepted the number. A reference
/// that exists purely as OCR output is filed `pending_review`: the machine read
/// it, nobody has agreed to it yet, and the Payment references screen can
/// correct it from there. Both values are accepted by `firestore.rules`
/// `match /payment_references/{refId}`.
String paymentReferenceRowStatus(String source) =>
    source == 'ocr' ? 'pending_review' : 'verified';

/// The document id a verified payment row is filed under.
///
/// Deterministic — the reference plus the Booking id — and that is exactly what
/// makes the insert idempotent and what lets the Payment references screen
/// backfill a row that was never filed without creating a second one.
///
/// Firestore document ids may not contain '/'; a normalized reference is
/// already [A-Z0-9-]{6,40}, but the substitution stays as a belt to that brace
/// so a legacy row can never produce an invalid path. The Booking id is folded
/// too, because the website's `paymentReferenceDocId` folds the whole composed
/// string — the two apps have to land on the same document for the same payment
/// or the catalogue holds the row twice.
String paymentReferenceDocId(String normalizedReference, String bookingId) =>
    '${normalizedReference}_$bookingId'.replaceAll(RegExp(r'[/\s]+'), '_');

/// The `payment_references` row one verified payment files.
///
/// Pure: the whole document is built here with no database in sight, so a test
/// can assert exactly what a verified payment leaves behind — including the
/// extraction evidence (sender, date, proof path) that lets the Payment
/// references screen show the row without asking the Admin to re-type anything,
/// and the machine's own read kept beside the accepted number.
Map<String, dynamic> paymentReferenceRow(
  BookingModel booking, {
  required String normalizedReference,
  required double verifiedAmount,
  String? confirmedReference,
}) {
  final source = paymentReferenceSourceFor(
    booking,
    confirmedReference: confirmedReference,
  );
  return {
    'reference': normalizedReference,
    'amount': verifiedAmount,
    'status': paymentReferenceRowStatus(source),
    'booking_id': booking.id,
    'sender_name': booking.paymentSenderName ?? booking.ocrSenderName,
    'payment_date': booking.paymentDate ?? booking.ocrPaymentDate,
    'proof_url': booking.paymentProofUrl,
    'ocr_reference': booking.ocrReference,
    'reference_source': source,
    'created_at': FieldValue.serverTimestamp(),
  };
}
