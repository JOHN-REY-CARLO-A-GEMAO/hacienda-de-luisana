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

  /// The exact status string the website stores (src/lib/booking/statuses.ts).
  /// The app writes these so /admin and /account read them back correctly.
  String get webName {
    switch (this) {
      case BookingStatus.pending:
        return 'Pending';
      case BookingStatus.confirmed:
        return 'Approved';
      case BookingStatus.checkedIn:
        return 'Checked-In';
      case BookingStatus.completed:
        return 'Completed';
      case BookingStatus.cancelled:
        return 'Cancelled';
    }
  }

  static BookingStatus fromString(String val) {
    switch (val.toLowerCase().replaceAll('-', '').replaceAll(' ', '')) {
      case 'confirmed':
      case 'approved':
      case 'paymentverified':
      case 'reserved':
        return BookingStatus.confirmed;
      case 'checkedin':
      case 'checked_in':
      case 'staying':
        return BookingStatus.checkedIn;
      case 'checkedout':
      case 'completed':
        return BookingStatus.completed;
      case 'cancelled':
      case 'canceled':
      case 'rejected':
      case 'expired':
        return BookingStatus.cancelled;
      case 'pending':
      case 'kycsubmitted':
      case 'paymentpending':
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
  });

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

    return BookingModel(
      id: docId ?? json['id'] ?? '',
      guestName: json['guestName'] ?? json['guest_name'] ?? 'Guest',
      guestPhone: json['guestPhone'] ?? json['phone'] ?? '',
      guestEmail: json['guestEmail'] ?? json['email'] ?? '',
      accommodation: json['accommodation'] ?? 'Villa LuisAna',
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guestCount: (json['guestCount'] ?? json['guests'] ?? 2) as int,
      specialRequests: json['specialRequests'] ?? json['special_requests'],
      status: BookingStatusX.fromString((json['status'] ?? 'pending').toString()),
      totalNights: json['totalNights'] ?? nights,
      totalAmount: (json['totalAmount'] ?? json['total_amount'] ?? (nights * 12000.0)).toDouble(),
      createdAt: json['createdAt'] != null
          ? _parseDate(json['createdAt'], now)
          : _parseDate(json['created_at'], now),
      trackingSessionId: json['trackingSessionId'] ?? json['tracking_session_id'],
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
      'status': status.name,
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
    );
  }
}
