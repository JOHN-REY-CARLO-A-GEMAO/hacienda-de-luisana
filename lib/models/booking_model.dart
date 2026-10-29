import '../services/booking_lifecycle.dart';

/// The coarse stage a Booking is in, used for filters, tabs and KPIs.
///
/// The exact lifecycle status (`Pending`, `Payment Pending`, …,
/// see [BookingStatuses]) is kept on [BookingModel.rawStatus]; this enum only
/// buckets those eleven statuses into five stages the dashboard can chart.
enum BookingStatus {
  pending,
  confirmed,
  checkedIn,
  completed,
  cancelled,
}

extension BookingStatusX on BookingStatus {
  String get name {
    switch (this) {
      case BookingStatus.pending:
        return 'pending';
      case BookingStatus.confirmed:
        return 'confirmed';
      case BookingStatus.checkedIn:
        return 'checkedIn';
      case BookingStatus.completed:
        return 'completed';
      case BookingStatus.cancelled:
        return 'cancelled';
    }
  }

  String get displayName {
    switch (this) {
      case BookingStatus.pending:
        return 'Pending';
      case BookingStatus.confirmed:
        return 'Confirmed';
      case BookingStatus.checkedIn:
        return 'Active Stay';
      case BookingStatus.completed:
        return 'Completed';
      case BookingStatus.cancelled:
        return 'Cancelled';
    }
  }

  /// Bucket a canonical lifecycle status (or any legacy spelling the
  /// website's `normalizeStatus` accepts) into its stage.
  static BookingStatus fromString(String val) {
    switch (normalizeStatus(val)) {
      case BookingStatuses.approved:
      case BookingStatuses.paymentPending:
      case BookingStatuses.paymentVerified:
      case BookingStatuses.reserved:
        return BookingStatus.confirmed;
      case BookingStatuses.checkedIn:
      case BookingStatuses.staying:
        return BookingStatus.checkedIn;
      case BookingStatuses.checkedOut:
      case BookingStatuses.completed:
        return BookingStatus.completed;
      case BookingStatuses.cancelled:
      case BookingStatuses.rejected:
      case BookingStatuses.expired:
        return BookingStatus.cancelled;
      case BookingStatuses.pending:
      default:
        return BookingStatus.pending;
    }
  }
}

class BookingModel {
  final String id;
  final String guestName;
  final String guestPhone;
  final String guestEmail;
  /// The canonical Accommodation **id**, exactly as the document stores it.
  ///
  /// Never a display name. The website writes an id here and `firestore.rules`
  /// checks it against the published rates document, so a name written into
  /// this field would match no published rate and could never be booked.
  /// Resolve a name for display with [accommodationLabel].
  final String accommodation;
  final DateTime checkInDate;
  final DateTime checkOutDate;
  final int guestCount;
  final String? specialRequests;
  final BookingStatus status;
  final int totalNights;
  final double totalAmount;
  final DateTime createdAt;

  /// The exact lifecycle status as stored (canonical spelling).
  final String rawStatus;
  /// Human reference the Guest sees (`HDL-…`).
  final String? refId;
  /// The Guest's Firebase uid — how the website scopes "my bookings".
  final String? uid;
  final String? source;
  final String? paymentPlan;
  final String? paymentStatus;
  final String? paymentProofUrl;
  /// The reference number the Guest claims on their proof (`payment_reference`).
  final String? paymentReference;
  final String? paymentRejectReason;
  final double? amountClaimed;
  /// The name the receipt names as the sender, as OCR read it (never verified).
  final String? ocrSenderName;
  /// The payment date OCR read off the receipt, normalized to YYYY-MM-DD (never verified).
  final String? ocrPaymentDate;
  /// The reference number OCR read off the receipt (`ocr_reference`).
  ///
  /// Evidence, never a decision: this is what a machine saw, kept beside
  /// [paymentReference] (what a human accepted) so the Admin can always tell
  /// the two apart.
  final String? ocrReference;
  /// The amount OCR read off the receipt (`ocr_amount`), as printed.
  final String? ocrAmount;
  /// The recipient / merchant / payee OCR read (`ocr_recipient_name`).
  final String? ocrRecipientName;
  /// The proof path the stored OCR read describes (`ocr_proof_url`).
  ///
  /// A re-sent proof is a new object under a new path (ADR-0011), so this is
  /// how the app knows the stored read belongs to the image being reviewed
  /// rather than to one that was replaced.
  final String? ocrProofUrl;
  /// Which engine produced the read — `mlkit-latin`, or the website's
  /// `tesseract` (`ocr_engine`).
  final String? ocrEngine;
  /// `high` | `low` | `none`, written with the read (`ocr_confidence`).
  final String? ocrConfidence;
  /// When the read was stored (`ocr_extracted_at`).
  final DateTime? ocrExtractedAt;
  /// Who supplied the stored [paymentReference] (`payment_reference_source`):
  /// `admin_corrected` once an Admin has edited it, absent otherwise.
  final String? paymentReferenceSource;
  /// The reference an Admin's correction replaced (`payment_reference_previous`).
  final String? paymentReferencePrevious;
  final DateTime? paymentReferenceCorrectedAt;
  final String? paymentReferenceCorrectedBy;
  /// The sender name the Guest confirmed from the receipt.
  final String? paymentSenderName;
  /// The payment date the Guest confirmed from the receipt.
  final String? paymentDate;
  /// The rate schedule classification captured on new guest-created Bookings.
  final String? rateClassification;
  final double? stayTotal;
  final double? amountDue;
  final double? securityDeposit;
  final double? balanceDue;
  final double? amountVerified;
  final String? refundStatus;
  final double? refundTotal;
  final String? rejectionReason;
  final String? cancellationReason;
  final DateTime? holdExpiresAt;
  final String? policyVersion;
  /// The document exactly as stored — what the lifecycle rules read.
  final Map<String, dynamic> raw;

  BookingModel({
    required this.id,
    required this.guestName,
    required this.guestPhone,
    required this.guestEmail,
    required this.accommodation,
    required this.checkInDate,
    required this.checkOutDate,
    required this.guestCount,
    this.specialRequests,
    required this.status,
    required this.totalNights,
    required this.totalAmount,
    required this.createdAt,
    String? rawStatus,
    this.refId,
    this.uid,
    this.source,
    this.paymentPlan,
    this.paymentStatus,
    this.paymentProofUrl,
    this.paymentReference,
    this.paymentRejectReason,
    this.amountClaimed,
    this.ocrSenderName,
    this.ocrPaymentDate,
    this.ocrReference,
    this.ocrAmount,
    this.ocrRecipientName,
    this.ocrProofUrl,
    this.ocrEngine,
    this.ocrConfidence,
    this.ocrExtractedAt,
    this.paymentReferenceSource,
    this.paymentReferencePrevious,
    this.paymentReferenceCorrectedAt,
    this.paymentReferenceCorrectedBy,
    this.paymentSenderName,
    this.paymentDate,
    this.rateClassification,
    this.stayTotal,
    this.amountDue,
    this.securityDeposit,
    this.balanceDue,
    this.amountVerified,
    this.refundStatus,
    this.refundTotal,
    this.rejectionReason,
    this.cancellationReason,
    this.holdExpiresAt,
    this.policyVersion,
    Map<String, dynamic>? raw,
  })  : rawStatus = rawStatus ?? _defaultRawStatus(status),
        raw = raw ?? const {};

  /// The canonical status a stage maps to when a mock has no exact one.
  static String _defaultRawStatus(BookingStatus stage) {
    switch (stage) {
      case BookingStatus.pending:
        return BookingStatuses.pending;
      case BookingStatus.confirmed:
        return BookingStatuses.reserved;
      case BookingStatus.checkedIn:
        return BookingStatuses.staying;
      case BookingStatus.completed:
        return BookingStatuses.completed;
      case BookingStatus.cancelled:
        return BookingStatuses.cancelled;
    }
  }

  /// Whether this Booking's money has been verified by an Admin.
  ///
  /// Read the same way `firestore.rules` reads it (`payment_status: verified`
  /// *with* a verified amount), because a document that says the first without
  /// the second is a half-written record, not a paid stay.
  bool get paymentIsVerified =>
      (paymentStatus ?? '').toLowerCase() == 'verified' &&
      (amountVerified ?? 0) > 0;

  /// The reference to show in the Payment Reference field.
  ///
  /// The value a human accepted wins; otherwise the number OCR read, labelled as
  /// unverified wherever it is shown. Null when neither exists — the field is
  /// then empty for the Admin to fill from the image, which is the honest state
  /// rather than a blank that looks like an error.
  String? get effectivePaymentReference {
    final accepted = paymentReference?.trim() ?? '';
    if (accepted.isNotEmpty) return accepted;
    final read = ocrReference?.trim() ?? '';
    return read.isEmpty ? null : read;
  }

  /// True when the reference on record came from OCR and no human has accepted
  /// it yet — the state the Admin must clear before a payment is verified.
  bool get paymentReferenceIsMachineRead =>
      (paymentReference?.trim() ?? '').isEmpty &&
      (ocrReference?.trim() ?? '').isNotEmpty;

  /// True when the reference on record was typed or corrected by an Admin.
  bool get paymentReferenceWasCorrected =>
      (paymentReferenceSource ?? '') == 'admin_corrected';

  /// True when the stored OCR read describes a proof that has since been
  /// replaced, so its values must not be read as describing the current image.
  bool get ocrReadIsStale {
    final readFrom = ocrProofUrl?.trim() ?? '';
    final current = paymentProofUrl?.trim() ?? '';
    if (readFrom.isEmpty || current.isEmpty) return false;
    return readFrom != current;
  }

  /// The document the lifecycle rules act on: the stored fields, with the
  /// parsed dates and id filled in so a mock Booking behaves like a stored one.
  Map<String, dynamic> toLifecycleDoc() => {
        ...raw,
        'id': id,
        'status': rawStatus,
        // The id, never a name. Falling back to the typed field is now safe because
        // that field holds the id too — previously it held a display label, so a
        // mock Booking without this key reached availability as 'The Main House'
        // and matched no other Booking's dates.
        'accommodation': raw['accommodation'] ?? accommodation,
        'check_in': raw['check_in'] ?? _dateOnly(checkInDate),
        'check_out': raw['check_out'] ?? _dateOnly(checkOutDate),
        'guest_name': raw['guest_name'] ?? guestName,
        'phone': raw['phone'] ?? guestPhone,
        'email': raw['email'] ?? guestEmail,
        'guests': raw['guests'] ?? guestCount,
        'special_requests': raw['special_requests'] ?? specialRequests,
        'total_amount': raw['total_amount'] ?? totalAmount,
        'created_at': raw['created_at'] ?? createdAt.toIso8601String(),
        if (!raw.containsKey('hold_expires_at') && holdExpiresAt != null)
          'hold_expires_at': holdExpiresAt!.toUtc().toIso8601String(),
      };

  static String _dateOnly(DateTime d) =>
      d.toIso8601String().substring(0, 10);

  static String? _str(Object? v) => v == null ? null : v.toString();
  static double? _dbl(Object? v) => v is num ? v.toDouble() : null;

  /// Reads a whole number out of a stored field.
  ///
  /// Firestore returns whatever shape was written: a number for the app's own
  /// writes, but a numeric *string* for a record written by hand or by an older
  /// build. A bare `as int` threw on the string, and because the whole snapshot
  /// was parsed inside one `try`, that single record used to take every other
  /// Booking down with it.
  static int _int(Object? v, int fallback) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    if (v is String) return int.tryParse(v.trim()) ?? fallback;
    return fallback;
  }

  /// The Accommodation id, verbatim.
  ///
  /// An absent or blank value becomes an empty string rather than a stand-in
  /// Accommodation: [accommodationLabel] turns that into 'Not recorded', so a
  /// Booking with no Accommodation reads as having none instead of reading as
  /// the Main House.
  static String _accommodationId(Object? raw) {
    if (raw is! String) return '';
    return raw.trim();
  }

  /// The Admin-facing summary of what is waiting on this Booking.
  String get nextStep {
    switch (rawStatus) {
      case BookingStatuses.pending:
        return paymentProofUrl == null || paymentProofUrl!.isEmpty
            ? 'Naghihintay ng downpayment screenshot bago maaprubahan.'
            : 'Suriin ang downpayment screenshot — aprubahan o tanggihan ito.';
      case BookingStatuses.approved:
        return 'Aprubado na — na-verify ang downpayment. I-check in ang Guest sa pagdating.';
      case BookingStatuses.paymentPending:
        if (paymentPlan == null || paymentPlan!.isEmpty) {
          return 'Waiting for the Guest to choose a payment plan (plano sa bayad).';
        }
        return paymentProofUrl == null || paymentProofUrl!.isEmpty
            ? 'Naghihintay ng payment proof mula sa Guest.'
            : 'Verify the payment proof. Beripikahin ang patunay ng bayad.';
      case BookingStatuses.paymentVerified:
      case BookingStatuses.reserved:
        return 'Reserved — i-check in ang Guest sa pagdating.';
      case BookingStatuses.checkedIn:
        return 'Checked-In — simulan ang stay.';
      case BookingStatuses.staying:
        return 'Staying — i-check out sa pag-alis.';
      case BookingStatuses.checkedOut:
        return 'Checked-Out — markahang tapos ang booking.';
      case BookingStatuses.cancelled:
        return refundStatus == 'initiated'
            ? (refundTotal == null
                ? 'May refund na kailangang ayusin; hindi naitala ang halaga.'
                : 'Refund na ₱${refundTotal!.toStringAsFixed(2)} ang kailangang isauli.')
            : 'Kanselado.';
      default:
        return rawStatus;
    }
  }

  /// Website docs store Firestore Timestamps (created_at, check_in,
  /// check_out) while local mocks use ISO strings — accept both.
  /// [raw] as a date, or null — for fields that are legitimately absent.
  static DateTime? _parseDateOrNull(Object? raw) {
    if (raw == null) return null;
    if (raw is String) {
      if (raw.trim().isEmpty) return null;
      return DateTime.tryParse(raw);
    }
    try {
      return (raw as dynamic).toDate() as DateTime;
    } catch (_) {
      return null;
    }
  }

  static DateTime _parseDate(Object? raw, DateTime fallback) {
    if (raw == null) return fallback;
    if (raw is String) {
      try {
        return DateTime.parse(raw);
      } catch (_) {
        return fallback;
      }
    }
    try {
      return (raw as dynamic).toDate() as DateTime;
    } catch (_) {
      return fallback;
    }
  }

  /// The display name for an Accommodation id.
  ///
  /// Resolved from the published rates document, which is the one place an
  /// Accommodation is named. This used to be a `switch` here mapping the three
  /// ids to 'The Main House' / 'HDL Annex' / 'A-House' — a fourth copy of the
  /// name, next to the website's, next to the published `property_name`, and it
  /// had drifted: 'HDL Main House' was published while this said 'The Main
  /// House'.
  ///
  /// With no published document, or an id the document does not carry, this
  /// returns the id itself. Showing `main-house` is honest; showing a
  /// hardcoded name that might not be the published one is not.
  static String accommodationLabel(String accommodationId,
      [Iterable<Accommodation> published = const []]) {
    final trimmed = accommodationId.trim();
    if (trimmed.isEmpty) return 'Not recorded';
    return Accommodation.byId(published, trimmed)?.name ?? trimmed;
  }

  factory BookingModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    final now = DateTime.now();
    final checkIn = json['checkInDate'] != null
        ? _parseDate(json['checkInDate'], now)
        : _parseDate(json['check_in'], now);

    final checkOut = json['checkOutDate'] != null
        ? _parseDate(json['checkOutDate'], now.add(const Duration(days: 2)))
        : _parseDate(
            json['check_out'], now.add(const Duration(days: 2)));

    final nights = checkOut.difference(checkIn).inDays <= 0 ? 1 : checkOut.difference(checkIn).inDays;
    final recordedNights = json['nights'] is num && (json['nights'] as num) > 0
        ? (json['nights'] as num).toInt()
        : nights;
    final savedStayTotal = _dbl(json['stay_total']);
    final legacyStayTotal = _dbl(json['totalAmount']) ?? _dbl(json['total_amount']);
    final savedRateAmount = _dbl(json['rate_amount']);
    final savedRateUnit = json['rate_unit'];
    final rateSnapshotTotal = savedRateAmount == null
        ? null
        : savedRateUnit == 'standard_stay'
            ? savedRateAmount
            : savedRateUnit == 'night'
                ? savedRateAmount * recordedNights
                : null;
    final reportedTotal = savedStayTotal ?? legacyStayTotal ?? rateSnapshotTotal ?? 0.0;

    final storedStatus = (json['status'] ?? 'Pending').toString();
    final interpreted = interpretStoredStatus(
      storedStatus,
      paymentStatus: json['payment_status']?.toString(),
      paymentProofUrl:
          (json['payment_proof_url'] ?? json['paymentProofUrl'])?.toString(),
    );

    return BookingModel(
      id: docId ?? json['id'] ?? '',
      guestName: json['guestName'] ?? json['guest_name'] ?? 'Guest',
      guestPhone: json['guestPhone'] ?? json['phone'] ?? '',
      guestEmail: json['guestEmail'] ?? json['email'] ?? '',
      // The stored document says which Accommodation this is, by id. A missing
      // value is missing, not the Main House: silently attributing an unnamed
      // Booking to the largest property on the estate is the kind of default
      // that reaches a refund.
      accommodation: _accommodationId(json['accommodation']),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guestCount: _int(json['guestCount'] ?? json['guests'], 2),
      specialRequests: json['specialRequests'] ?? json['special_requests'],
      status: BookingStatusX.fromString(interpreted),
      rawStatus: interpreted,
      totalNights: json['totalNights'] ?? nights,
      totalAmount: (reportedTotal * 100).round() / 100,
      createdAt: json['createdAt'] != null
          ? _parseDate(json['createdAt'], now)
          : _parseDate(json['created_at'], now),
      refId: _str(json['ref_id']),
      uid: _str(json['uid']),
      source: _str(json['source']),
      paymentPlan: _str(json['payment_plan']),
      paymentStatus: _str(json['payment_status']),
      paymentProofUrl: _str(json['payment_proof_url']),
      paymentReference: _str(json['payment_reference']),
      paymentRejectReason: _str(json['payment_reject_reason']),
      amountClaimed: _dbl(json['amount_claimed']),
      ocrSenderName: _str(json['ocr_sender_name']),
      ocrPaymentDate: _str(json['ocr_payment_date']),
      ocrReference: _str(json['ocr_reference']),
      ocrAmount: _str(json['ocr_amount']),
      ocrRecipientName: _str(json['ocr_recipient_name']),
      ocrProofUrl: _str(json['ocr_proof_url']),
      ocrEngine: _str(json['ocr_engine']),
      ocrConfidence: _str(json['ocr_confidence']),
      ocrExtractedAt: _parseDateOrNull(json['ocr_extracted_at']),
      paymentReferenceSource: _str(json['payment_reference_source']),
      paymentReferencePrevious: _str(json['payment_reference_previous']),
      paymentReferenceCorrectedAt:
          _parseDateOrNull(json['payment_reference_corrected_at']),
      paymentReferenceCorrectedBy:
          _str(json['payment_reference_corrected_by']),
      paymentSenderName: _str(json['payment_sender_name']),
      paymentDate: _str(json['payment_date']),
      rateClassification: _str(json['rate_classification']),
      stayTotal: _dbl(json['stay_total']),
      amountDue: _dbl(json['amount_due']),
      securityDeposit: _dbl(json['security_deposit']),
      balanceDue: _dbl(json['balance_due']),
      amountVerified: _dbl(json['amount_verified']),
      refundStatus: _str(json['refund_status']),
      refundTotal: _dbl(json['refund_total']),
      rejectionReason: _str(json['rejection_reason']),
      cancellationReason: _str(json['cancellation_reason']),
      holdExpiresAt: json['hold_expires_at'] == null
          ? null
          : _parseDate(json['hold_expires_at'], now),
      policyVersion: _str(json['policy_version']),
      raw: Map<String, dynamic>.from(json),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'guestName': guestName,
      'guestPhone': guestPhone,
      'guestEmail': guestEmail,
      'accommodation': accommodation,
      'checkInDate': checkInDate.toIso8601String(),
      'checkOutDate': checkOutDate.toIso8601String(),
      'guestCount': guestCount,
      'specialRequests': specialRequests,
      'status': rawStatus,
      'stage': status.name,
      if (rateClassification != null) 'rate_classification': rateClassification,
      'totalNights': totalNights,
      'totalAmount': totalAmount,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  BookingModel copyWith({
    String? id,
    String? guestName,
    String? guestPhone,
    String? guestEmail,
    String? accommodation,
    DateTime? checkInDate,
    DateTime? checkOutDate,
    int? guestCount,
    String? specialRequests,
    BookingStatus? status,
    int? totalNights,
    double? totalAmount,
    DateTime? createdAt,
    String? rawStatus,
    Map<String, dynamic>? raw,
  }) {
    return BookingModel(
      id: id ?? this.id,
      guestName: guestName ?? this.guestName,
      guestPhone: guestPhone ?? this.guestPhone,
      guestEmail: guestEmail ?? this.guestEmail,
      accommodation: accommodation ?? this.accommodation,
      checkInDate: checkInDate ?? this.checkInDate,
      checkOutDate: checkOutDate ?? this.checkOutDate,
      guestCount: guestCount ?? this.guestCount,
      specialRequests: specialRequests ?? this.specialRequests,
      status: status ?? this.status,
      totalNights: totalNights ?? this.totalNights,
      totalAmount: totalAmount ?? this.totalAmount,
      createdAt: createdAt ?? this.createdAt,
      rawStatus: rawStatus ??
          (status != null && status != this.status ? null : this.rawStatus),
      refId: refId,
      uid: uid,
      source: source,
      paymentPlan: paymentPlan,
      paymentStatus: paymentStatus,
      paymentProofUrl: paymentProofUrl,
      paymentRejectReason: paymentRejectReason,
      amountClaimed: amountClaimed,
      rateClassification: rateClassification,
      stayTotal: stayTotal,
      amountDue: amountDue,
      securityDeposit: securityDeposit,
      balanceDue: balanceDue,
      amountVerified: amountVerified,
      refundStatus: refundStatus,
      refundTotal: refundTotal,
      rejectionReason: rejectionReason,
      cancellationReason: cancellationReason,
      holdExpiresAt: holdExpiresAt,
      policyVersion: policyVersion,
      raw: raw ?? this.raw,
    );
  }

  /// A copy with a stored patch merged in — what the in-memory fallback does
  /// after an accepted action, so the UI reflects it without a round trip.
  BookingModel applyPatch(Map<String, dynamic> patch) {
    final merged = Map<String, dynamic>.from(toLifecycleDoc())..addAll(patch);
    merged.remove('id');
    return BookingModel.fromJson(merged, id);
  }
}
