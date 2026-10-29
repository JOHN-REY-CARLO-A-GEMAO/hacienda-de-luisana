// ---------------------------------------------------------------------------
// Receipt text -> payment details, in pure Dart, with no Flutter or Firebase
// import.
//
// This is the Admin app's half of the OCR pipeline the Guest website already
// runs (`src/lib/payments/ocr.ts`, tesseract.js in the Guest's browser). The
// website reads the screenshot at upload time and stores what it read on the
// Booking as `ocr_reference`, `ocr_amount`, `ocr_sender_name` and
// `ocr_payment_date`. This file turns *any* receipt text — those stored fields
// included, or a fresh on-device read of the proof image — into one validated,
// normalized value object the Admin screens can display.
//
// Two rules the rest of the feature depends on:
//
//  1. **Extraction is never verification.** Nothing here writes a status, and
//     no caller may treat a value from this file as money that arrived
//     (ADR-0012 leaves that decision to the Admin, with a PIN gate).
//  2. **Never fabricate.** A field OCR could not read stays empty and says so
//     in `notes`. A guessed reference number is worse than a blank one: it is
//     a number nobody can match against a real GCash transaction.
//
// The parsing rules mirror the website's extractor on purpose. The two apps
// read the same GCash / Maya / bank screenshots, so a reference that reads
// correctly on `/account` must read identically here — including the awkward
// parts: a 13-digit GCash reference printed across two rows of a two-column
// receipt, and the 16-digit card number on the same screenshot that must never
// be mistaken for one.
// ---------------------------------------------------------------------------

import 'booking_model.dart';

/// How much of the receipt could be read.
///
/// `high` means a reference *and* an amount were both read. It still verifies
/// nothing — it only says the extraction has enough in it to be worth showing
/// the Admin in full.
enum ReceiptConfidence { high, low, none }

/// One peso figure a receipt prints, with the label it was printed under.
///
/// A GCash Express Send receipt can carry two: `Amount 2,500.00` (what the
/// recipient receives) and `Total Amount Sent 1,020.00` (what actually left the
/// sender). They disagree whenever a fee is charged, so both are kept and the
/// Admin is shown both rather than one silently chosen for them.
class ReceiptAmount {
  /// The label as printed, tidied for reading — `Total Amount Sent`, `Amount`.
  final String label;

  /// Two decimal places, validated by [normalizeReceiptAmount].
  final String value;

  const ReceiptAmount(this.label, this.value);

  @override
  String toString() => '$label $value';

  @override
  bool operator ==(Object other) =>
      other is ReceiptAmount && other.label == label && other.value == value;

  @override
  int get hashCode => Object.hash(label, value);
}

/// Everything the Admin app knows about what a receipt says, and nothing it
/// guessed.
class ReceiptExtraction {
  /// The transaction/reference number, normalized (`^[A-Z0-9-]{6,40}$`) or ''.
  final String reference;

  /// The single best amount, two decimals, or ''. See [amounts] for all of them.
  final String amount;

  /// Every distinct figure the receipt prints, most specific label first.
  final List<ReceiptAmount> amounts;

  /// Sender / account name the receipt names, or ''.
  final String senderName;

  /// Recipient / merchant / payee the receipt names, or ''.
  final String recipientName;

  /// The date exactly as printed, e.g. `Aug 26, 2026`. For display only.
  final String paymentDate;

  /// [paymentDate] normalized to `YYYY-MM-DD`, or '' when it could not be.
  final String paymentDateIso;

  /// The time as printed, e.g. `10:23 AM`, or ''.
  final String paymentTime;

  final ReceiptConfidence confidence;

  /// Operator-facing warnings. Always safe to show; never a value.
  final List<String> notes;

  const ReceiptExtraction({
    this.reference = '',
    this.amount = '',
    this.amounts = const [],
    this.senderName = '',
    this.recipientName = '',
    this.paymentDate = '',
    this.paymentDateIso = '',
    this.paymentTime = '',
    this.confidence = ReceiptConfidence.none,
    this.notes = const [],
  });

  static const ReceiptExtraction empty = ReceiptExtraction();

  bool get hasReference => reference.isNotEmpty;
  bool get hasAmount => amount.isNotEmpty;

  /// Whether there is anything at all worth showing the Admin.
  bool get hasAnything =>
      reference.isNotEmpty ||
      amount.isNotEmpty ||
      senderName.isNotEmpty ||
      recipientName.isNotEmpty ||
      paymentDateIso.isNotEmpty ||
      paymentDate.isNotEmpty;

  /// Two receipts disagree when both printed amounts the admin should compare.
  bool get amountsDisagree => amounts.length > 1;

  /// The amount labelled the way a sender's own total is labelled, if any.
  String? get amountLabel =>
      amounts.isEmpty ? null : amounts.first.label;

  /// What the receipt says, in one line — used where the panel is dense.
  String get summary {
    final parts = <String>[
      if (reference.isNotEmpty) reference,
      if (amount.isNotEmpty) 'PHP $amount',
      if (paymentDateIso.isNotEmpty) paymentDateIso,
    ];
    return parts.isEmpty ? '' : parts.join(' · ');
  }

  /// Build from the `ocr_*` fields the Guest website already stored on a
  /// Booking. No parsing happens here: these values were extracted at upload
  /// time, and re-normalizing them is only a defensive step in case an older
  /// row holds something the current rules would not accept.
  factory ReceiptExtraction.fromBooking(BookingModel booking) {
    final reference = normalizeReference(booking.ocrReference ?? '');
    final amount = normalizeReceiptAmount(booking.ocrAmount ?? '') ?? '';
    final iso = normalizeIsoDate(booking.ocrPaymentDate ?? '') ?? '';
    return ReceiptExtraction(
      reference: isValidReference(reference) ? reference : '',
      amount: amount,
      amounts: amount.isEmpty ? const [] : [ReceiptAmount('Amount', amount)],
      senderName: (booking.ocrSenderName ?? '').trim(),
      paymentDate: iso,
      paymentDateIso: iso,
      confidence: reference.isNotEmpty && amount.isNotEmpty
          ? ReceiptConfidence.high
          : (reference.isNotEmpty || amount.isNotEmpty)
              ? ReceiptConfidence.low
              : ReceiptConfidence.none,
    );
  }

  /// Combine two extractions, preferring the first for every field it has.
  ///
  /// Used to layer a fresh on-device read over what the website stored: the
  /// stored values are what the Guest already saw and confirmed, so they win,
  /// and the fresh read fills the gaps. Notes are unioned so a warning from
  /// either side survives.
  ReceiptExtraction mergedWith(ReceiptExtraction fallback) {
    String pick(String a, String b) => a.isNotEmpty ? a : b;
    final reference = pick(reference, fallback.reference);
    final amount = pick(amount, fallback.amount);
    final dateIso = pick(paymentDateIso, fallback.paymentDateIso);
    // A warning about a value that the *other* extraction supplied is no longer
    // true — "no reference could be read" must not sit above a reference the
    // previous read found. Everything else (a disagreement between two printed
    // amounts, an ambiguous date) still applies and is kept.
    final notes = <String>[
      for (final note in this.notes)
        if (_noteStillApplies(note, reference, amount, dateIso)) note,
    ];
    for (final note in fallback.notes) {
      if (!_noteStillApplies(note, reference, amount, dateIso)) continue;
      if (!notes.contains(note)) notes.add(note);
    }
    final amounts = this.amounts.isNotEmpty ? this.amounts : fallback.amounts;
    final confidence = reference.isNotEmpty && amount.isNotEmpty
        ? ReceiptConfidence.high
        : (reference.isNotEmpty || amount.isNotEmpty)
            ? ReceiptConfidence.low
            : ReceiptConfidence.none;
    return ReceiptExtraction(
      reference: reference,
      amount: amount,
      amounts: amounts,
      senderName: pick(senderName, fallback.senderName),
      recipientName: pick(recipientName, fallback.recipientName),
      paymentDate: pick(paymentDate, fallback.paymentDate),
      paymentDateIso: dateIso,
      paymentTime: pick(paymentTime, fallback.paymentTime),
      confidence: confidence,
      notes: notes,
    );
  }
}

/// Does a "could not read this" warning still describe the merged result?
///
/// Matched by the sentence each warning opens with — the strings are written in
/// this file, so the prefixes are the contract between the two.
bool _noteStillApplies(String note, String reference, String amount, String iso) {
  if (reference.isNotEmpty && note.startsWith('No reference number')) return false;
  if (amount.isNotEmpty && note.startsWith('No amount')) return false;
  if (iso.isNotEmpty && note.startsWith('No transaction date')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Normalization — the one place a value becomes safe to store or compare.
// ---------------------------------------------------------------------------

/// The longest reference the website, the Admin app and `firestore.rules`
/// accept (`REF_MAX` in `src/lib/validation.ts`).
const int referenceMaxLength = 40;

/// A reference as it should be stored: upper case, letters, digits and hyphens.
///
/// Uppercasing is the half that matters — `gcash-123` and `GCASH-123` are the
/// same reference and must compare equal against a receipt and the Admin's
/// catalogue.
String normalizeReference(String raw) {
  final upper = raw.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9-]'), '');
  final trimmed = upper.replaceAll(RegExp(r'^-+|-+$'), '');
  return trimmed.length <= referenceMaxLength
      ? trimmed
      : trimmed.substring(0, referenceMaxLength);
}

/// Whether a normalized reference is one the Admin may store.
bool isValidReference(String reference) =>
    RegExp(r'^[A-Z0-9-]{6,40}$').hasMatch(reference.trim());

/// A peso figure as `12.34`, or null when the text is not one.
///
/// The bounds match the website's `validateAmount`: at least one centavo and no
/// more than five million, which is far above anything this estate charges and
/// therefore a reliable sign of an OCR artifact rather than a payment.
String? normalizeReceiptAmount(String raw) {
  final cleaned = raw.trim().replaceAll(',', '').replaceAll(' ', '');
  if (cleaned.isEmpty) return null;
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(cleaned)) return null;
  final value = double.tryParse(cleaned);
  if (value == null || value.isNaN || value.isInfinite) return null;
  if (value < 0.01 || value > 5000000) return null;
  return value.toStringAsFixed(2);
}

/// A calendar date as `YYYY-MM-DD`, or null when the value is not one.
String? normalizeIsoDate(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text);
  if (m == null) return null;
  final year = int.parse(m.group(1)!);
  final month = int.parse(m.group(2)!);
  final day = int.parse(m.group(3)!);
  return _isoOrNull(year, month, day);
}

/// `2026-08-26`, or null when those three numbers are not a real date.
String? _isoOrNull(int year, int month, int day) {
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // `DateTime` rolls 31 February into March, so the only way to know the date
  // is real is to build it and read the parts back.
  final dt = DateTime(year, month, day);
  if (dt.year != year || dt.month != month || dt.day != day) return null;
  return '${year.toString().padLeft(4, '0')}-'
      '${month.toString().padLeft(2, '0')}-'
      '${day.toString().padLeft(2, '0')}';
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const _monthNames = {
  'jan': 1,
  'feb': 2,
  'mar': 3,
  'apr': 4,
  'may': 5,
  'jun': 6,
  'jul': 7,
  'aug': 8,
  'sep': 9,
  'oct': 10,
  'nov': 11,
  'dec': 12,
};

int? _monthOf(String token) {
  if (token.length < 3) return null;
  return _monthNames[token.toLowerCase().substring(0, 3)];
}

final _monthTokenRe = RegExp(
  r'^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*$',
  caseSensitive: false,
);
final _meridiemRe = RegExp(
  r'^(?:a\.?m\.?|p\.?m\.?|midnight|noon)$',
  caseSensitive: false,
);
/// `10:23`, `26/08/2026`, `2026-08-26` — the date and time column of a receipt.
final _dateTokenRe = RegExp(r'^\d{1,4}[-/.:]\d{1,4}(?:[-/.:]\d{1,4})?$');
final _digitsOnlyRe = RegExp(r'^\d+$');
final _lettersAndDigitsRe = RegExp(r'[^A-Za-z0-9]');

/// Labels that introduce a reference number on the receipts this estate sees.
final _referenceLabelRe = RegExp(
  r'(?:ref(?:erence)?(?:\s*(?:no\.?|number|#))?|txn|transaction|confirmation|trace|gcash\s*ref|maya\s*ref)',
  caseSensitive: false,
);

/// A labelled reference printed as one alphanumeric run (`REF-A1B2C3D4`).
final _labelledAlphanumericRe = RegExp(
  r'(?:ref(?:erence)?(?:\s*(?:no\.?|number|#))?|txn(?:\s*id)?|transaction(?:\s*(?:id|no\.?|number|#))?|confirmation(?:\s*(?:no\.?|number|#))?|trace(?:\s*(?:no\.?|number|#))?|gcash\s*ref|maya\s*ref)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9-]{5,39})',
  caseSensitive: false,
);

/// 10–13 digits collected so far, or '' while the reference is still too short.
///
/// A GCash/Maya/bank reference is 10–13 digits. Sixteen is a card number; nine
/// is a partial read. Both are refused rather than stored.
String _settledReference(String digits) =>
    (digits.length >= 10 && digits.length <= 13) ? digits : '';

/// Add up the digit groups a labelled reference is printed as, carrying onto
/// the next row only while the reference is still being written.
///
/// GCash prints its reference as `7044 357 122304` across two rows of a
/// two-column receipt, and the text recogniser reads the right-hand date column
/// as part of those same rows, so the digits arrive as
/// `Ref No. 7044 357 Aug 26, 2026 10:23` then `122304 AM` — no single run of
/// 10–13 digits anywhere. Step over the month, the day, the year, the time and
/// the meridiem, and the groups add up.
///
/// A row that ends on a real word (`Amount`, `Download`) closes the reference,
/// so digits further down the receipt are never swallowed into it. Never
/// truncates and never guesses: too few digits, or a card/account number, both
/// return '' so the caller can fall back to the contiguous-run patterns.
String _walkGroups(List<String> lines, int line, int start) {
  final digits = StringBuffer();
  var skipNumbers = 0;
  final end = (line + 3) < lines.length ? (line + 3) : lines.length;
  for (var i = line; i < end; i++) {
    final row = i == line
        ? (start < lines[i].length ? lines[i].substring(start) : '')
        : lines[i];
    for (final raw in row.split(RegExp(r'\s+'))) {
      final bare = raw.replaceAll(RegExp(r'[.,;]+$'), '');
      final word = raw.replaceAll(_lettersAndDigitsRe, '');
      if (word.isEmpty) continue;
      if (_monthTokenRe.hasMatch(bare)) {
        // `Aug 26, 2026` — the month drags the day and the year along with it.
        skipNumbers = 2;
        continue;
      }
      if (_meridiemRe.hasMatch(bare) || _dateTokenRe.hasMatch(bare)) {
        skipNumbers = 0;
        continue;
      }
      if (!_digitsOnlyRe.hasMatch(word)) {
        // A real word closes the reference — `Amount`, `Download`, `Share` —
        // while a short connector like `ID` or `No.` is only part of the label.
        if (word.length >= 3) return _settledReference(digits.toString());
        continue;
      }
      if (skipNumbers > 0) {
        skipNumbers -= 1;
        continue;
      }
      // A single run wider than a reference is a card or account number.
      if (word.length > 13) return '';
      digits.write(word);
      if (digits.length > 13) return '';
    }
    if (digits.length >= 10) return digits.toString();
  }
  return _settledReference(digits.toString());
}

String _labelledGroups(String text) {
  final lines = text.split(RegExp(r'\r?\n'));
  for (var i = 0; i < lines.length; i++) {
    final label = _referenceLabelRe.firstMatch(lines[i]);
    if (label == null) continue;
    final digits = _walkGroups(lines, i, label.end);
    if (digits.isNotEmpty) return digits;
  }
  return '';
}

/// Pull the 10–13 digit reference a GCash, Maya or bank transfer receipt
/// carries out of recognized text.
///
/// A labelled reference wins (`Ref No.`, `Txn ID`, `GCash ref`, `confirmation
/// no.` …) — first as digit groups glued back together across the date column a
/// two-column receipt interleaves, then as a run printed with spacing like
/// `1234 567 890123` — then an alphanumeric reference printed after a label, and
/// only then does a bare 10–13 digit run count. Anything absent returns '' for
/// the Admin to type from the image.
String extractReferenceNumber(String text) {
  final grouped = _labelledGroups(text);
  if (grouped.isNotEmpty) return grouped;

  final compact = text.replaceAll(RegExp(r'\s+'), ' ');

  final labelled = RegExp(
    r'(?:ref(?:erence)?|txn|transaction|confirmation|trace|gcash|maya|bank)[^\n]{0,24}?(\d[\d\s-]{8,24}\d)',
    caseSensitive: false,
  ).firstMatch(compact);
  if (labelled != null) {
    final digits = labelled.group(1)!.replaceAll(RegExp(r'[\s-]'), '');
    if (digits.length >= 10 && digits.length <= 13) return digits;
  }

  // An alphanumeric reference (`REF-A1B2C3D4`) must follow a reference label and
  // carry at least four digits; a letter-only run is a word, not a reference.
  final alphanumeric = _labelledAlphanumericRe.firstMatch(text);
  if (alphanumeric != null) {
    final candidate = normalizeReference(alphanumeric.group(1)!);
    final digitCount = RegExp(r'\d').allMatches(candidate).length;
    if (digitCount >= 4 && isValidReference(candidate)) return candidate;
  }

  final bare = RegExp(r'\b(\d{10,13})\b').firstMatch(compact);
  return bare?.group(1) ?? '';
}

/// Is this text only what a reference prints between its label and its digits?
bool _referenceBetweenIsOneRun(String between) {
  for (final token in between.split(RegExp(r'\s+'))) {
    if (token.isEmpty) continue;
    if (RegExp(r'^[.,:;#\-/]+$').hasMatch(token)) continue;
    if (_digitsOnlyRe.hasMatch(token)) continue;
    if (_monthTokenRe.hasMatch(token)) continue;
    if (_meridiemRe.hasMatch(token)) continue;
    if (_dateTokenRe.hasMatch(token)) continue;
    return false;
  }
  return true;
}

const _amountLabels = <(String, String)>[
  ('Total Amount Sent', r'total\s*amount\s*sent'),
  ('Amount Sent', r'amount\s*sent'),
  ('Total Amount', r'total\s*amount'),
  ('Amount Paid', r'amount\s*paid'),
  ('Total Paid', r'total\s*paid'),
  ('Total', r'total'),
  ('Amount', r'amount'),
  ('Paid', r'paid'),
];

/// Every peso figure a receipt prints, each with its label, deduplicated by
/// value and ordered most-specific label first.
///
/// Line structure is what identifies a label: `Total Amount Sent` is a label
/// because of the words next to *its own* figure, not because of the words
/// anywhere on the receipt. Collapsing newlines first throws that away and puts
/// the reference number on the same line as an amount label — which is how an
/// OCR pipeline ends up proposing a transaction ID as a peso amount.
List<ReceiptAmount> extractReceiptAmounts(String text) {
  final lines = text.split(RegExp(r'\r?\n'));
  final found = <(ReceiptAmount, int)>[];
  // The figure alone, without its currency prefix: the prefix belongs to the
  // text *before* the run, which is exactly where a label is looked for. A
  // pattern that swallowed `PHP` used to leave `before` empty for a line reading
  // `PHP 1,020.00`, so a receipt that prints its currency instead of a word had
  // an amount nobody could see.
  final figureRe = RegExp(r'(\d[\d,]*(?:\.\d{1,2})?)');
  final currencyBeforeRe = RegExp(r'(?:₱|\bPHP\b)\s*$', caseSensitive: false);

  /// Is this text only a currency marker, spacing and punctuation?
  ///
  /// GCash prints its amount labels and their figures on separate rows
  /// (`Total Amount Sent` then `₱1,020.00`), so a figure whose own row says
  /// nothing about money may take the label of the row immediately above it —
  /// but only when nothing else is on its row. `Ref No. ` is not "only
  /// currency", which is what stops a reference's digits inheriting an amount
  /// label from the row above.
  bool beforeIsOnlyCurrency(String text) {
    final withoutCurrency = text
        .replaceAll(RegExp(r'₱|PHP', caseSensitive: false), '')
        .replaceAll(RegExp(r'[\s:.,;\-]'), '')
        .trim();
    return withoutCurrency.isEmpty;
  }

  for (var index = 0; index < lines.length; index++) {
    final line = lines[index];
    // The reference's own digits are not money. A two-column receipt interleaves
    // them with the date (`Ref No. 7044 357 Aug 26, 2026 10:23`), so the figures
    // that belong to the reference are the ones with nothing but a reference's
    // own print between them and its label. A figure behind a *different* word —
    // `Amount: 1500` after `Ref No:` — is a peso figure.
    final refMatch = _referenceLabelRe.firstMatch(line);
    final refLabelEnd = refMatch == null ? -1 : refMatch.end;

    for (final run in figureRe.allMatches(line)) {
      final raw = run.group(1);
      if (raw == null) continue;
      final before = line.substring(0, run.start);
      if (refLabelEnd >= 0 &&
          before.length > refLabelEnd &&
          _referenceBetweenIsOneRun(before.substring(refLabelEnd))) {
        continue;
      }

      var label = '';
      var rank = _amountLabels.length;
      void labelFrom(String scope) {
        for (var i = 0; i < _amountLabels.length; i++) {
          if (RegExp(_amountLabels[i].$2, caseSensitive: false).hasMatch(scope)) {
            label = _amountLabels[i].$1;
            rank = i;
            return;
          }
        }
      }

      labelFrom(before);
      if (label.isEmpty &&
          beforeIsOnlyCurrency(before) &&
          index > 0 &&
          lines[index - 1].trim().isNotEmpty) {
        // The label printed on its own row, the figure below it.
        labelFrom(lines[index - 1]);
      }
      // A bare ₱ or PHP with no word at all is still an amount worth offering.
      if (label.isEmpty && currencyBeforeRe.hasMatch(before)) {
        label = 'Amount';
        rank = _amountLabels.length;
      }
      // A figure whose line says nothing about money is a reference, a date, a
      // phone number or a card fragment — not an amount the Admin can use.
      if (label.isEmpty) continue;

      final checked = normalizeReceiptAmount(raw);
      if (checked == null) continue;

      final existingIndex = found.indexWhere((e) => e.$1.value == checked);
      if (existingIndex >= 0) {
        // Same number, more specific label: `Total Amount Sent` beats `Amount`.
        if (found[existingIndex].$2 > rank) {
          found[existingIndex] = (ReceiptAmount(label, checked), rank);
        }
        continue;
      }
      found.add((ReceiptAmount(label, checked), rank));
    }
  }

  found.sort((a, b) => a.$2.compareTo(b.$2));
  return found.map((e) => e.$1).toList(growable: false);
}

/// Labels that introduce the sender on the receipt formats the Hacienda sees.
final _senderLabelRe = RegExp(
  r'(?:sender|from|remitter|payer|source\s*account|account\s*name|sender\s*name|sent\s*by)\s*[:#-]*',
  caseSensitive: false,
);

/// Labels that introduce the recipient / merchant / payee.
///
/// `Sent to` and `Paid to` come before the bare `to` so the longer label wins at
/// the same position. `\bto\b` cannot match inside `auto` or `Total`, because a
/// word boundary requires a non-word character before the `t`.
final _recipientLabelRe = RegExp(
  r'\b(?:recipient(?:\s*name)?|merchant|payee|paid\s*to|sent\s*to|received\s*by|to)\b\s*[:#-]*',
  caseSensitive: false,
);

/// Tokens that end a name candidate — money figures, references, dates, labels.
final _nameStopRe = RegExp(
  r'^(?:ref|reference|txn|transaction|amount|total|paid|date|time|gcash|maya|bank|₱|php|\d{10,})',
  caseSensitive: false,
);

/// What a name may contain: letters, spaces and the punctuation names use.
final _nameRe = RegExp(r"^[A-Za-zÀ-ÖØ-öø-ÿ'.\s-]{2,60}$");

/// A line that carries a number the receipt prints is not a name line.
final _numberLineRe = RegExp(r'\d{4,}');

String _nameAfterLabel(List<String> lines, RegExp labelRe) {
  for (var i = 0; i < lines.length; i++) {
    final label = labelRe.firstMatch(lines[i]);
    if (label == null) continue;
    var candidate = lines[i].substring(label.end).trim();
    if (candidate.isEmpty && i + 1 < lines.length) {
      candidate = lines[i + 1].trim();
    }
    // One label line can carry several fields (`Sender: J. Dela Cruz Ref 123`),
    // so keep words until a label word or a 4+ digit figure shows up, and never
    // more than four words — a receipt name is short.
    final kept = <String>[];
    for (final word in candidate.split(RegExp(r'\s+'))) {
      if (word.isEmpty) continue;
      if (_nameStopRe.hasMatch(word) || RegExp(r'^\d{4,}$').hasMatch(word)) {
        break;
      }
      kept.add(word);
      if (kept.length >= 4) break;
    }
    final cleaned = kept.join(' ').replaceAll(RegExp(r'[.,;:]+$'), '').trim();
    if (_nameRe.hasMatch(cleaned) && !_numberLineRe.hasMatch(cleaned)) {
      return cleaned;
    }
  }
  return '';
}

/// Pull the sender name a receipt prints under a sender label.
///
/// GCash prints the sender as a phone number (`+63 930 485 7798`), so a phone
/// number alone is not enough — a real name label is required. Never guesses:
/// no label and no plausible name returns ''.
String extractSenderName(String text) =>
    _nameAfterLabel(text.split(RegExp(r'\r?\n')), _senderLabelRe);

/// Pull the recipient / merchant / payee a receipt prints under its label.
///
/// A GCash "Sent to" block prints the recipient's registered name on the line
/// after the label. As with the sender, no label and no plausible name returns
/// '' — the panel then says the receipt did not name one.
String extractRecipientName(String text) =>
    _nameAfterLabel(text.split(RegExp(r'\r?\n')), _recipientLabelRe);

/// `Aug 26, 2026`, `26/08/2026`, `2026-08-26`, `08/26/2026`, `26-08-2026`.
final _printedDateRe = RegExp(
  r'(?:(\d{1,2})[/\-](\d{1,2})[/\-](\d{4}))'
  r'|((\d{4})[/\-](\d{1,2})[/\-](\d{1,2}))'
  r'|(([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4}))',
  caseSensitive: false,
);

/// A clock time printed beside the date, e.g. `10:23 AM`.
final _printedTimeRe = RegExp(
  r'\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?',
);

/// One printed date, normalized, with a flag for the ambiguous slash form.
class PrintedDate {
  final String display;
  final String iso;
  final bool ambiguous;
  const PrintedDate(this.display, this.iso, this.ambiguous);
}

/// Normalize the first printed payment date to `YYYY-MM-DD`.
///
/// Slash dates are ambiguous: `08/26/2026` is month-first, `26/08/2026` is
/// day-first, and `08/05/2026` could be either. Philippine receipts are read
/// day-first; when both readings fit and disagree, the caller is told the date
/// is ambiguous and should confirm rather than file a wrong date.
PrintedDate? extractPaymentDate(String text) {
  PrintedDate? best;

  for (final m in _printedDateRe.allMatches(text)) {
    final raw = m.group(0)!;
    int? year;
    int? month;
    int? day;
    var ambiguous = false;

    if (m.group(4) != null) {
      // ISO-ish `2026-08-26` — unambiguous.
      year = int.tryParse(m.group(5)!);
      month = int.tryParse(m.group(6)!);
      day = int.tryParse(m.group(7)!);
    } else if (m.group(8) != null) {
      // `Aug 26, 2026` — unambiguous.
      year = int.tryParse(m.group(11)!);
      month = _monthOf(m.group(9)!);
      day = int.tryParse(m.group(10)!);
      if (month == null) continue;
    } else {
      // `26/08/2026` or `08/26/2026` — both orders fit when each part ≤ 12.
      final a = int.tryParse(m.group(1)!);
      final b = int.tryParse(m.group(2)!);
      year = int.tryParse(m.group(3)!);
      if (a == null || b == null) continue;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      } else if (b > 12 && a <= 12) {
        day = b;
        month = a;
      } else if (a <= 12 && b <= 12) {
        // Ambiguous as printed: read day-first for Philippine receipts, flag it.
        day = a;
        month = b;
        ambiguous = true;
      } else {
        continue;
      }
    }

    if (year == null || month == null || day == null) continue;
    final iso = _isoOrNull(year, month, day);
    if (iso == null) continue;
    final candidate = PrintedDate(raw.trim(), iso, ambiguous);
    // Prefer an unambiguous date over an ambiguous one; otherwise keep the
    // first one printed rather than guessing which matters more.
    if (best == null || (!candidate.ambiguous && best.ambiguous)) {
      best = candidate;
    }
  }

  return best;
}

/// The clock time printed on the receipt, as `10:23 AM`, or ''.
String extractPaymentTime(String text) {
  final m = _printedTimeRe.firstMatch(text);
  if (m == null) return '';
  final hour = int.tryParse(m.group(1)!);
  final minute = int.tryParse(m.group(2)!);
  if (hour == null || minute == null) return '';
  if (hour < 1 || hour > 12 || minute > 59) return '';
  final meridiem = m.group(3)!.toUpperCase() == 'P' ? 'PM' : 'AM';
  return '${hour.toString().padLeft(2, '0')}:'
      '${minute.toString().padLeft(2, '0')} $meridiem';
}

/// Choose the figure most likely to be the one the Guest actually sent.
///
/// A receipt can print more than one amount (a fee makes `Amount` and `Total
/// Amount Sent` disagree). When the caller knows what was claimed or owed, the
/// closest figure is the best hint; a tie, or nothing to compare against,
/// returns null so the panel shows every figure and asks the Admin instead.
///
/// This is a suggestion for a human to accept. It never writes a claim.
ReceiptAmount? suggestedAmount(List<ReceiptAmount> amounts, double? against) {
  if (amounts.isEmpty) return null;
  if (against == null || against <= 0) return null;
  ReceiptAmount? best;
  var bestDistance = double.infinity;
  var tied = false;
  for (final candidate in amounts) {
    final value = double.tryParse(candidate.value);
    if (value == null) continue;
    final distance = (value - against).abs();
    if (distance < bestDistance - 0.005) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if ((distance - bestDistance).abs() <= 0.005) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/// Read every detail a receipt image's text offers.
///
/// [expectedAmount] is what the Booking says was claimed or owed; it only
/// breaks the tie between several printed figures and changes no field's
/// emptiness. Values that do not validate are dropped (with a note) rather
/// than shown in a form the rules would later refuse.
ReceiptExtraction parseReceiptText(String text, {double? expectedAmount}) {
  final compact = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (compact.isEmpty) {
    return const ReceiptExtraction(
      confidence: ReceiptConfidence.none,
      notes: [
        'No text found on the receipt. Enter the reference number yourself, or open the proof and read it.',
      ],
    );
  }

  final notes = <String>[];

  // The original text, not `compact`: a reference split across the rows of a
  // two-column receipt only reads off the text as it was recognized.
  final rawReference = extractReferenceNumber(text);
  var reference = normalizeReference(rawReference);
  if (reference.isNotEmpty && !isValidReference(reference)) {
    reference = '';
    notes.add(
      'A reference-like text was read but it is not a valid reference (6–40 letters, digits or hyphens). It was discarded — type the reference from the receipt.',
    );
  }

  final amounts = extractReceiptAmounts(text);
  String amount = '';
  if (amounts.isNotEmpty) {
    amount = suggestedAmount(amounts, expectedAmount)?.value ?? amounts.first.value;
  }

  final sender = extractSenderName(text);
  final recipient = extractRecipientName(text);
  final printedDate = extractPaymentDate(text);
  final time = extractPaymentTime(text);

  if (reference.isEmpty) {
    notes.add('No reference number could be read. Type it from the receipt before verifying.');
  }
  if (amount.isEmpty) {
    notes.add('No amount could be read. Check the figure against the proof yourself.');
  }
  if (amounts.length > 1) {
    notes.add(
      'This receipt prints ${amounts.length} different amounts '
      '(${amounts.map((a) => '${a.label} ${a.value}').join(', ')}). '
      'The figure shown is the closest to what the Booking expects — confirm it against the image.',
    );
  }
  if (printedDate != null && printedDate.ambiguous) {
    notes.add(
      'The receipt date reads "${printedDate.display}" and could be more than one calendar date. Confirm it before relying on it.',
    );
  }
  if (printedDate == null) {
    notes.add('No transaction date could be read. Check the date against the proof.');
  }

  final confidence = reference.isNotEmpty && amount.isNotEmpty
      ? ReceiptConfidence.high
      : (reference.isNotEmpty || amount.isNotEmpty)
          ? ReceiptConfidence.low
          : ReceiptConfidence.none;

  return ReceiptExtraction(
    reference: reference,
    amount: amount,
    amounts: amounts,
    senderName: sender,
    recipientName: recipient,
    paymentDate: printedDate?.display ?? '',
    paymentDateIso: printedDate?.iso ?? '',
    paymentTime: time,
    confidence: confidence,
    notes: notes,
  );
}
