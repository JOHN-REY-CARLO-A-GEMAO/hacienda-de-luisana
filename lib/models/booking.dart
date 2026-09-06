/// A guest reservation.
///
/// Statuses (unified with the web admin):
/// `pending → confirmed → checked_in → completed`, plus `cancelled`.
/// The guest app never sets `confirmed` itself — only the host (demo: simulated
/// host review; production: Firestore from the /admin dashboard).
class Booking {
  final String referenceId;
  final String guestName;
  final String phone;
  final String email;
  final String accommodationTitle;
  final DateTime checkInDate;
  final DateTime checkOutDate;
  final int guestCount;
  final String notes;

  String status; // pending | confirmed | checked_in | completed | cancelled
  String kycStatus; // required | submitted | approved
  String? govtIdPath;
  String? paymentReceiptPath;
  final DateTime createdAt;

  Booking({
    required this.referenceId,
    required this.guestName,
    required this.phone,
    this.email = '',
    required this.accommodationTitle,
    required this.checkInDate,
    required this.checkOutDate,
    required this.guestCount,
    this.notes = '',
    this.status = 'pending',
    this.kycStatus = 'required',
    this.govtIdPath,
    this.paymentReceiptPath,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  bool get isPending => status == 'pending';
  bool get isConfirmed => status == 'confirmed' || status == 'checked_in';
  bool get isActive => status != 'completed' && status != 'cancelled';

  String get statusLabel {
    switch (status) {
      case 'pending':
        return kycStatus == 'submitted' ? 'For Host Review' : 'Pending KYC';
      case 'confirmed':
        return 'Confirmed';
      case 'checked_in':
        return 'Checked In';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  double get totalPrice {
    final days = checkOutDate.difference(checkInDate).inDays;
    final int validDays = days > 0 ? days : 1;
    if (accommodationTitle.contains('Main House')) {
      return validDays * 8500.0;
    } else if (accommodationTitle.contains('Forest Deck')) {
      return validDays * 1800.0;
    } else {
      return validDays * 1500.0;
    }
  }

  Map<String, dynamic> toJson() => {
        'referenceId': referenceId,
        'guestName': guestName,
        'phone': phone,
        'email': email,
        'accommodationTitle': accommodationTitle,
        'checkInDate': checkInDate.toIso8601String(),
        'checkOutDate': checkOutDate.toIso8601String(),
        'guestCount': guestCount,
        'notes': notes,
        'status': status,
        'kycStatus': kycStatus,
        'govtIdPath': govtIdPath,
        'paymentReceiptPath': paymentReceiptPath,
        'createdAt': createdAt.toIso8601String(),
      };

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
        referenceId: json['referenceId'] as String,
        guestName: json['guestName'] as String,
        phone: json['phone'] as String,
        email: (json['email'] ?? '') as String,
        accommodationTitle: json['accommodationTitle'] as String,
        checkInDate: DateTime.parse(json['checkInDate'] as String),
        checkOutDate: DateTime.parse(json['checkOutDate'] as String),
        guestCount: json['guestCount'] as int,
        notes: (json['notes'] ?? '') as String,
        status: (json['status'] ?? 'pending') as String,
        kycStatus: (json['kycStatus'] ?? 'required') as String,
        govtIdPath: json['govtIdPath'] as String?,
        paymentReceiptPath: json['paymentReceiptPath'] as String?,
        createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt'] as String) : null,
      );
}
