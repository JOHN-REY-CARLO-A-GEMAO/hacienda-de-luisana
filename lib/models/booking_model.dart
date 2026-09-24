import '../services/booking_lifecycle.dart';

/// The coarse stage a Booking is in, used for filters, tabs and KPIs.
///
/// The exact lifecycle status (`Pending`, `KYC Submitted`, `Approved`, …,
/// see [BookingStatuses]) is kept on [BookingModel.rawStatus]; this enum only
/// buckets those thirteen statuses into five stages the dashboard can chart.
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
      case BookingStatuses.kycSubmitted:
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
  final String accommodation;
  final DateTime checkInDate;
  final DateTime checkOutDate;
  final int guestCount;
  final String? specialRequests;
  final BookingStatus status;
  final int totalNights;
  final double totalAmount;
  final DateTime createdAt;
  final String? trackingSessionId;

  /// The exact lifecycle status as stored (canonical spelling).
  final String rawStatus;
  /// Human reference the Guest sees (`HDL-…`).
  final String? refId;
  /// The Guest's Firebase uid — how the website scopes "my bookings".
  final String? uid;
  final String? source;
  final String? kycStatus;
  final String? kycIdUrl;
  final String? kycReceiptUrl;
  final String? kycRejectReason;
  final String? paymentPlan;
  final String? paymentStatus;
  final String? paymentProofUrl;
  final String? paymentRejectReason;
  final double? amountClaimed;
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
    this.trackingSessionId,
    String? rawStatus,
    this.refId,
    this.uid,
    this.source,
    this.kycStatus,
    this.kycIdUrl,
    this.kycReceiptUrl,
    this.kycRejectReason,
    this.paymentPlan,
    this.paymentStatus,
    this.paymentProofUrl,
    this.paymentRejectReason,
    this.amountClaimed,
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

  /// The document the lifecycle rules act on: the stored fields, with the
  /// parsed dates and id filled in so a mock Booking behaves like a stored one.
  Map<String, dynamic> toLifecycleDoc() => {
        ...raw,
        'id': id,
        'status': rawStatus,
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
        'tracking_session_id':
            raw['tracking_session_id'] ?? trackingSessionId,
        if (!raw.containsKey('hold_expires_at') && holdExpiresAt != null)
          'hold_expires_at': holdExpiresAt!.toUtc().toIso8601String(),
      };

  static String _dateOnly(DateTime d) =>
      d.toIso8601String().substring(0, 10);

  static String? _str(Object? v) => v == null ? null : v.toString();
  static double? _dbl(Object? v) => v is num ? v.toDouble() : null;

  /// The Admin-facing summary of what is waiting on this Booking.
  String get nextStep {
    switch (rawStatus) {
      case BookingStatuses.pending:
        return 'Waiting for the Guest to upload a government ID.';
      case BookingStatuses.kycSubmitted:
        return 'Review the ID and approve or reject.';
      case BookingStatuses.approved:
        return 'Waiting for the Guest to choose a payment plan.';
      case BookingStatuses.paymentPending:
        return paymentProofUrl == null || paymentProofUrl!.isEmpty
            ? 'Waiting for the Guest to send payment proof.'
            : 'Verify the payment proof.';
      case BookingStatuses.paymentVerified:
      case BookingStatuses.reserved:
        return 'Reserved — check the Guest in on arrival.';
      case BookingStatuses.checkedIn:
        return 'Checked in — begin the stay.';
      case BookingStatuses.staying:
        return 'Staying — check out at the end of the stay.';
      case BookingStatuses.checkedOut:
        return 'Checked out — complete the Booking.';
      case BookingStatuses.cancelled:
        return refundStatus == 'initiated'
            ? 'Refund of ₱${(refundTotal ?? 0).toStringAsFixed(2)} to return.'
            : 'Cancelled.';
      default:
        return rawStatus;
    }
  }

  /// Website docs store Firestore Timestamps (created_at, check_in,
  /// check_out) while local mocks use ISO strings — accept both.
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

  /// The website stores the Accommodation *id* (`src/config/site.ts`); the
  /// Admin reads the name. Unknown values (mock data, 'other') pass through.
  static String accommodationLabel(String idOrName) {
    switch (idOrName) {
      case 'main-house':
        return 'The Main House';
      case 'house-a-camping':
        return 'House A Camping Units';
      case 'other':
        return 'Other / Ask Us';
      default:
        return idOrName;
    }
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

    final storedStatus = (json['status'] ?? 'Pending').toString();

    return BookingModel(
      id: docId ?? json['id'] ?? '',
      guestName: json['guestName'] ?? json['guest_name'] ?? 'Guest',
      guestPhone: json['guestPhone'] ?? json['phone'] ?? '',
      guestEmail: json['guestEmail'] ?? json['email'] ?? '',
      accommodation: accommodationLabel(
          (json['accommodation'] ?? 'The Main House').toString()),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guestCount: (json['guestCount'] ?? json['guests'] ?? 2) as int,
      specialRequests: json['specialRequests'] ?? json['special_requests'],
      status: BookingStatusX.fromString(storedStatus),
      rawStatus: normalizeStatus(storedStatus),
      totalNights: json['totalNights'] ?? nights,
      totalAmount: (json['totalAmount'] ?? json['total_amount'] ?? (nights * 12000.0)).toDouble(),
      createdAt: json['createdAt'] != null
          ? _parseDate(json['createdAt'], now)
          : _parseDate(json['created_at'], now),
      trackingSessionId: json['trackingSessionId'] ?? json['tracking_session_id'],
      refId: _str(json['ref_id']),
      uid: _str(json['uid']),
      source: _str(json['source']),
      kycStatus: _str(json['kyc_status']),
      kycIdUrl: _str(json['kyc_id_url']),
      kycReceiptUrl: _str(json['kyc_receipt_url']),
      kycRejectReason: _str(json['kyc_reject_reason']),
      paymentPlan: _str(json['payment_plan']),
      paymentStatus: _str(json['payment_status']),
      paymentProofUrl: _str(json['payment_proof_url']),
      paymentRejectReason: _str(json['payment_reject_reason']),
      amountClaimed: _dbl(json['amount_claimed']),
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
      'totalNights': totalNights,
      'totalAmount': totalAmount,
      'createdAt': createdAt.toIso8601String(),
      'trackingSessionId': trackingSessionId,
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
    String? trackingSessionId,
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
      trackingSessionId: trackingSessionId ?? this.trackingSessionId,
      rawStatus: rawStatus ??
          (status != null && status != this.status ? null : this.rawStatus),
      refId: refId,
      uid: uid,
      source: source,
      kycStatus: kycStatus,
      kycIdUrl: kycIdUrl,
      kycReceiptUrl: kycReceiptUrl,
      kycRejectReason: kycRejectReason,
      paymentPlan: paymentPlan,
      paymentStatus: paymentStatus,
      paymentProofUrl: paymentProofUrl,
      paymentRejectReason: paymentRejectReason,
      amountClaimed: amountClaimed,
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
