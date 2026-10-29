// ---------------------------------------------------------------------------
// Reading a payment proof on the Admin's own device.
//
// The Guest website already runs OCR at upload time (`src/lib/payments/ocr.ts`,
// tesseract.js in the browser) and stores what it read on the Booking. That is
// the primary path and this service does not replace it: when the stored values
// belong to the proof that is currently attached, there is nothing to do.
//
// What it adds is the case the website cannot cover:
//
//  - a proof uploaded before the website had OCR, or by a browser that could not
//    load the recognizer (tesseract is fetched lazily and can fail offline);
//  - a receipt where the browser's read was empty or wrong, and the Admin is the
//    one holding the image and the question;
//  - a re-send: a new proof object under a new path, which makes the old read
//    stale rather than merely old.
//
// The engine is Google ML Kit's on-device text recognizer, via
// `google_mlkit_text_recognition`. It was chosen over a cloud OCR API for four
// reasons that all matter here:
//
//  1. **No key.** There is no API key to put in the APK, no secret to rotate and
//     nothing for `docs/VERIFICATION.md` § 6 to object to: ML Kit needs no
//     credentials at all.
//  2. **Free.** The bundled Latin model ships inside the app; there is no
//     per-page bill, so a month of proofs costs nothing.
//  3. **Private.** The receipt never leaves the phone. A Guest's GCash receipt
//     carries their name, number and reference; sending it to a third-party OCR
//     API would publish exactly what ADR-0011's private bucket exists to keep
//     private.
//  4. **Works offline.** An Admin reviewing payments in a place with no signal
//     can still read the proof they already opened.
//
// Nothing here writes to Firestore. The bytes are read and parsed; persisting
// the result is `PaymentReferenceService`, which is where the "never overwrite a
// verified reference" rules live.
// ---------------------------------------------------------------------------

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:http/http.dart' as http;

import '../models/booking_model.dart';
import '../models/receipt_extraction.dart';
import 'payment_proof_service.dart';

/// The largest proof this app will try to read.
///
/// `storage.rules` already refuses an object over 5 MB, so this is a belt to
/// that brace: it stops a mis-stored object from being pulled into memory on a
/// phone before the recognizer ever sees it.
const int maxReceiptBytes = 8 * 1024 * 1024;

/// How many seconds the signed proof URL is given to produce its bytes. The
/// signature itself lasts 60 seconds, so a longer wait cannot succeed anyway.
const Duration receiptDownloadTimeout = Duration(seconds: 30);

/// What one OCR pass produced, and why it produced nothing when it did not.
enum ReceiptOcrStatus {
  /// A fresh read produced text worth showing.
  extracted,

  /// The stored extraction already belongs to the attached proof; nothing was
  /// re-read. Not an error.
  alreadyProcessed,

  /// The Booking has no attached proof.
  noProof,

  /// This platform has no on-device recognizer (web, desktop, tests).
  unsupported,

  /// The proof could not be downloaded from the private bucket.
  downloadFailed,

  /// The object at the path is not an image.
  notAnImage,

  /// The image was read but held no recognizable text.
  noText,

  /// The recognizer threw.
  failed,
}

class ReceiptOcrOutcome {
  final ReceiptOcrStatus status;

  /// Present for [ReceiptOcrStatus.extracted] and
  /// [ReceiptOcrStatus.alreadyProcessed] (in the latter case, the stored read).
  final ReceiptExtraction? extraction;

  /// Operator-facing explanation, in the Admin's language. Null on success.
  final String? message;

  /// Which engine read the text, for the panel's provenance line.
  final String engine;

  const ReceiptOcrOutcome({
    required this.status,
    this.extraction,
    this.message,
    this.engine = '',
  });

  bool get producedValues =>
      status == ReceiptOcrStatus.extracted ||
      status == ReceiptOcrStatus.alreadyProcessed;

  bool get isError =>
      status == ReceiptOcrStatus.downloadFailed ||
      status == ReceiptOcrStatus.notAnImage ||
      status == ReceiptOcrStatus.failed;
}

/// Raised when the current platform has no on-device recognizer.
class ReceiptTextUnavailable implements Exception {
  final String message;
  const ReceiptTextUnavailable(this.message);
  @override
  String toString() => message;
}

/// The text of one image. Split from the parsing so a test (or a future engine)
/// can supply text without an image or a platform channel.
class ReceiptTextResult {
  final String text;
  final String engine;
  const ReceiptTextResult(this.text, this.engine);
}

/// Something that turns image bytes into text.
abstract class ReceiptTextReader {
  Future<ReceiptTextResult> read(Uint8List bytes, {required String filename});
}

/// Google ML Kit's on-device recognizer, Latin script.
class MlKitReceiptTextReader implements ReceiptTextReader {
  const MlKitReceiptTextReader();

  @override
  Future<ReceiptTextResult> read(
    Uint8List bytes, {
    required String filename,
  }) async {
    if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) {
      throw const ReceiptTextUnavailable(
        'On-device OCR is not available on this platform.',
      );
    }
    if (bytes.isEmpty) {
      throw const ReceiptTextUnavailable('The proof image is empty.');
    }

    final extension = _imageExtension(filename);
    final file = File(
      '${Directory.systemTemp.path}/hdl-proof-'
      '${DateTime.now().microsecondsSinceEpoch}.$extension',
    );

    // One recognizer per read, closed in `finally`: ML Kit keeps a native model
    // per instance, and leaking one per receipt would grow with the queue.
    final recognizer = TextRecognizer(script: TextRecognitionScript.latin);
    try {
      await file.writeAsBytes(bytes, flush: true);
      final inputImage = InputImage.fromFilePath(file.path);
      final recognized = await recognizer.processImage(inputImage);
      return ReceiptTextResult(recognized.text, 'mlkit-latin');
    } finally {
      try {
        await recognizer.close();
      } catch (_) {
        // A recognizer that failed to start has nothing to close.
      }
      try {
        if (file.existsSync()) await file.delete();
      } catch (_) {
        // A leftover temp file is the operating system's problem to reclaim;
        // it must never turn a successful read into a failure.
      }
    }
  }

  static String _imageExtension(String filename) {
    final dot = filename.lastIndexOf('.');
    if (dot < 0) return 'jpg';
    switch (filename.substring(dot + 1).toLowerCase()) {
      case 'png':
        return 'png';
      case 'webp':
        return 'webp';
      case 'heic':
        return 'heic';
      case 'jpeg':
      case 'jpg':
        return 'jpg';
      default:
        return 'jpg';
    }
  }
}

/// Reads the proof attached to a Booking, and nothing else.
class ReceiptOcrService {
  ReceiptOcrService({
    ReceiptTextReader reader = const MlKitReceiptTextReader(),
    http.Client? client,
  })  : _reader = reader,
        _client = client;

  final ReceiptTextReader _reader;
  final http.Client? _client;

  static final ReceiptOcrService instance = ReceiptOcrService();

  /// The stored read, when it still describes the proof currently attached.
  ///
  /// A new proof is a new object under a new path (ADR-0011 never overwrites
  /// one), so an `ocr_proof_url` that no longer matches means the stored
  /// extraction describes a screenshot the Admin is not looking at.
  static bool storedReadIsCurrent(BookingModel booking) {
    final path = booking.paymentProofUrl?.trim() ?? '';
    if (path.isEmpty) return false;
    final readFrom = booking.ocrProofUrl?.trim() ?? '';
    if (readFrom.isEmpty) {
      // A legacy row: the website stored `ocr_*` before this field existed.
      // Trust it only while it has something in it — it cannot describe a
      // *different* proof, because nothing was recorded to compare.
      return ReceiptExtraction.fromBooking(booking).hasAnything;
    }
    return readFrom == path;
  }

  /// Read [booking]'s proof.
  ///
  /// With [force] false, a stored read that still matches the attached proof is
  /// returned as [ReceiptOcrStatus.alreadyProcessed] instead of being re-run —
  /// the same receipt is not scanned twice for the same answer, which is what
  /// keeps a queue of proofs from turning into a queue of re-scans.
  Future<ReceiptOcrOutcome> readProof(
    BookingModel booking, {
    bool force = false,
  }) async {
    final path = booking.paymentProofUrl?.trim() ?? '';
    if (path.isEmpty) {
      return const ReceiptOcrOutcome(
        status: ReceiptOcrStatus.noProof,
        message: 'Walang nakalakip na patunay sa Booking na ito.',
      );
    }

    final stored = ReceiptExtraction.fromBooking(booking);
    if (!force && storedReadIsCurrent(booking) && stored.hasAnything) {
      return ReceiptOcrOutcome(
        status: ReceiptOcrStatus.alreadyProcessed,
        extraction: stored,
        engine: booking.ocrEngine ?? '',
      );
    }

    // The bucket is private and the app holds no key for it; the function signs
    // a URL that lasts 60 seconds (ADR-0011).
    final signed = await PaymentProofService.signedUrl(path);
    if (signed.url == null || signed.url!.isEmpty) {
      return ReceiptOcrOutcome(
        status: ReceiptOcrStatus.downloadFailed,
        message: signed.error ??
            'Hindi makuha ang patunay mula sa storage. Subukan muli.',
      );
    }

    // Initialized so the definite-assignment analysis does not have to reason
    // across the try/catch below; every path that leaves the block with these
    // still unset returns first.
    var bytes = Uint8List(0);
    var contentType = '';
    final client = _client ?? http.Client();
    try {
      final response = await client
          .get(Uri.parse(signed.url!))
          .timeout(receiptDownloadTimeout);
      if (response.statusCode != 200) {
        return ReceiptOcrOutcome(
          status: ReceiptOcrStatus.downloadFailed,
          message:
              'Hindi makuha ang patunay mula sa storage (${response.statusCode}). Subukan muli.',
        );
      }
      bytes = response.bodyBytes;
      contentType = (response.headers['content-type'] ?? '').toLowerCase();
    } catch (_) {
      return const ReceiptOcrOutcome(
        status: ReceiptOcrStatus.downloadFailed,
        message:
            'Hindi makuha ang patunay. Suriin ang koneksyon at subukan muli.',
      );
    } finally {
      if (_client == null) client.close();
    }

    if (bytes.isEmpty) {
      return const ReceiptOcrOutcome(
        status: ReceiptOcrStatus.downloadFailed,
        message: 'Walang laman ang file ng patunay.',
      );
    }
    if (bytes.length > maxReceiptBytes) {
      return const ReceiptOcrOutcome(
        status: ReceiptOcrStatus.notAnImage,
        message:
            'Masyadong malaki ang file para basahin sa telepono. Buksan ang patunay at i-type ang mga detalye.',
      );
    }
    // The storage bucket already refuses anything that is not an image; this
    // catches a page or an error body served with a 200, which would otherwise
    // reach the recognizer and be reported as an unreadable receipt.
    if (contentType.isNotEmpty && !contentType.startsWith('image/')) {
      return const ReceiptOcrOutcome(
        status: ReceiptOcrStatus.notAnImage,
        message:
            'Hindi larawan ang naka-upload na patunay. Buksan ito at i-type ang mga detalye.',
      );
    }

    ReceiptTextResult read;
    try {
      read = await _reader.read(bytes, filename: path);
    } on ReceiptTextUnavailable catch (error) {
      return ReceiptOcrOutcome(
        status: ReceiptOcrStatus.unsupported,
        message: 'Hindi available ang OCR sa device na ito. ${error.message}',
      );
    } catch (_) {
      return const ReceiptOcrOutcome(
        status: ReceiptOcrStatus.failed,
        message:
            'Hindi mabasa ng OCR ang larawan. Buksan ang patunay at suriin ito mismo.',
      );
    }

    final parsed = parseReceiptText(
      read.text,
      expectedAmount: _expectedAmount(booking),
    );
    // A re-read never throws away what an earlier read of *this same object*
    // already got right. A blurry second pass that finds no reference must not
    // wipe the reference the first pass read; the fresh values win everywhere
    // they exist, and the stored ones fill the gaps. Reads recorded against a
    // different (older) proof are never merged — those describe another image.
    final sameProofRecorded =
        (booking.ocrProofUrl?.trim() ?? '') == path && path.isNotEmpty;
    final extraction = sameProofRecorded && stored.hasAnything
        ? parsed.mergedWith(stored)
        : parsed;

    if (extraction.confidence == ReceiptConfidence.none) {
      return ReceiptOcrOutcome(
        status: ReceiptOcrStatus.noText,
        extraction: extraction,
        engine: read.engine,
        message:
            'Walang nabasang detalye sa larawan. Buksan ang patunay at i-type ang reference.',
      );
    }
    return ReceiptOcrOutcome(
      status: ReceiptOcrStatus.extracted,
      extraction: extraction,
      engine: read.engine,
    );
  }

  /// The figure a tie between several printed amounts is broken against: what
  /// the Guest claimed, falling back to what the Booking asks for.
  static double? _expectedAmount(BookingModel booking) {
    final claimed = booking.amountClaimed;
    if (claimed != null && claimed > 0) return claimed;
    final due = booking.amountDue;
    if (due != null && due > 0) return due;
    return null;
  }
}
