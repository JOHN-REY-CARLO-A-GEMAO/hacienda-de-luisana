/// A guest reservation.
///
/// Statuses (unified with the web admin, lowercase in-app):
/// `pending → confirmed → checked_in → completed`, plus `cancelled`.
/// KYC is a separate axis: `required → submitted → approved | rejected`.
/// The guest app never sets `confirmed` itself — only the host does
/// (production: Firestore from the /admin dashboard).
/// P1 local correctness: no auto-approve, no backend.
/// P2 Firestore sync: web-compatible cloud shape (see toCloudMap/fromCloud).
/// Web /book + /admin use snake_case keys + Capitalized statuses
/// (Pending/Confirmed/Cancelled/Completed). In-app stays lowercase and maps
/// at the boundary so /admin needs zero changes.
import 'dart:math';

class Booking {
  /// Valid booking statuses (in-app, lowercase).
  static const validStatuses = [
    'pending',
    'confirmed',
    'checked_in',
    'completed',
    'cancelled',
    'expired', // lazy local terminal, never written to cloud (see isExpiredLocal)
  ];

  /// Valid KYC statuses.
  static const validKycStatuses = [
    'required',
    'submitted',
    'approved',
    'rejected',
  ];

  /// Digital key window: check-in day 2PM → check-out day 12NN + 1hr grace.
  static const keyCheckInHour = 14;
  static const keyCheckOutHour = 12;
  static const keyGraceHours = 1;

  /// Generates collision-safe ref IDs: HDL-YYMMDD-XXXX (e.g. HDL-260906-K4TQ).
  static String generateReferenceId([DateTime? now]) {
    final dt = now ?? DateTime.now();
    final yy = (dt.year % 100).toString().padLeft(2, '0');
    final mm = dt.month.toString().padLeft(2, '0');
    final dd = dt.day.toString().padLeft(2, '0');
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
    final rand = Random.secure();
    final suffix = List.generate(
      4,
      (_) => alphabet[rand.nextInt(alphabet.length)],
    ).join();
    return 'HDL-$yy$mm$dd-$suffix';
  }
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
  String kycStatus; // required | submitted | approved | rejected
  String? govtIdPath;
  String? paymentReceiptPath;

  /// P3: Storage download URLs for host review in /admin.
  /// Set on KYC submit (upload), mirrored to cloud kyc_id_url/kyc_receipt_url.
  /// Local govtIdPath/paymentReceiptPath remain as offline placeholders.
  String? kycIdUrl;
  String? kycReceiptUrl;

  /// P3: admin-set reject reason (host review). Guests can never write this
  /// (excluded from guestUpdatableKeys + firestore guest allowlist).
  String? kycRejectReason;

  /// Keys a guest may self-write on their own pending doc (rules mirror).
  /// kyc_reject_reason is deliberately absent — admin-only.
  ///
  /// Live location is deliberately absent: since G6 it rides on
  /// tracking_sessions/{bookingId}, not on this doc — firestore.rules refuses
  /// those keys here. The model keeps the pickup fields as LOCAL state for
  /// offline screens only (never written to the cloud anymore).
  static const guestUpdatableKeys = {
    'status',
    'kyc_status',
    'kyc_id_url',
    'kyc_receipt_url',
  };

  /// P2: guest identity (Firebase anonymous uid, or local fallback uuid).
  /// Written to cloud as `uid` so guests read only their own bookings.
  String? uid;

  /// P2: one-time ETA share link (Maps URL the booker sends when near).
  /// Optional, never required. Auto-purge policy applies server-side later.
  String? etaShareUrl;

  /// Rider-style one-tap pickup (guest live) -> dropoff (hotel fixed
  /// 14.1754304,121.519389). One tap only, never continuous tracking.
  double? pickupLat;
  double? pickupLng;
  DateTime? pickupUpdatedAt;
  String? pickupLabel;

  /// P2: Firestore doc id once synced (null while local-only / offline).
  String? firestoreId;

  /// P2: true once the cloud write has been acknowledged.
  /// Local cache opens instantly; this flag drives the "will send" banner.
  bool synced;

  /// Constant source marker so /admin can tell app bookings apart.
  static const cloudSource = 'flutter_app';

  /// Lazy EXPIRED threshold: pending older than this is treated terminal
  /// locally (dates released) until a real TTL cron exists (G4).
  static const expiryHours = 24;

  /// Accommodation title <-> web slug mapping (web uses Accommodation.id).
  static const accommodationSlugs = {
    'Main House Villa': 'main-house',
    'Camping A - Forest Deck': 'camping-a',
    'Camping B - Riverside': 'camping-b',
  };

  static const accommodationTitles = {
    'main-house': 'Main House Villa',
    'camping-a': 'Camping A - Forest Deck',
    'camping-b': 'Camping B - Riverside',
  };

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
    this.kycIdUrl,
    this.kycReceiptUrl,
    this.kycRejectReason,
    this.uid,
    this.etaShareUrl,
    this.pickupLat,
    this.pickupLng,
    this.pickupUpdatedAt,
    this.pickupLabel,
    this.firestoreId,
    this.synced = false,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  bool get isPending => status == 'pending';
  bool get isConfirmed => status == 'confirmed' || status == 'checked_in';

  /// Lazy EXPIRED: pending older than 24h is terminal locally (G4 stand-in).
  /// Never written to cloud as 'expired' — cloud keeps 'Pending' until the
  /// host or a future TTL function finalizes it. Locally we release dates.
  bool get isExpiredLocal =>
      status == 'pending' &&
      DateTime.now().difference(createdAt).inHours >= expiryHours;

  /// Effective status for UI + overlap (expired wins over pending).
  String get effectiveStatus => isExpiredLocal ? 'expired' : status;

  bool get isActive =>
      status != 'completed' && status != 'cancelled' && !isExpiredLocal;

  /// P3: guest submits (or resubmits after rejection) ID + receipt.
  /// Status stays pending; reject reason clears so the review loop restarts.
  /// Key stays disabled until host sets approved (see keyDisabledReason).
  void applyKycSubmitted({String? idUrl, String? receiptUrl}) {
    kycStatus = 'submitted';
    kycRejectReason = null;
    if (idUrl != null) kycIdUrl = idUrl;
    if (receiptUrl != null) kycReceiptUrl = receiptUrl;
  }

  /// P3: host rejects KYC (admin path only — guests never call this to write).
  void applyKycRejected(String reason) {
    kycStatus = 'rejected';
    kycRejectReason = reason;
  }

  /// P3: host approves KYC (admin path only).
  void applyKycApproved() {
    kycStatus = 'approved';
    kycRejectReason = null;
  }

  /// Web slug for this booking (web /book stores Accommodation.id).
  String get accommodationId =>
      accommodationSlugs[accommodationTitle] ?? 'main-house';

  /// In-app status → cloud status (web /admin understands these only).
  /// `checked_in` folds to `Confirmed` so StatusPill never sees an unknown
  /// value (zero admin changes). Local detail is preserved in-app.
  String get cloudStatus {
    switch (status) {
      case 'confirmed':
      case 'checked_in':
        return 'Confirmed';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Pending';
    }
  }

  /// Cloud status (either case) → in-app lowercase. Defaults to pending.
  static String statusFromCloud(Object? raw) {
    final s = (raw ?? 'pending').toString().toLowerCase();
    switch (s) {
      case 'confirmed':
        return 'confirmed';
      case 'checked_in':
      case 'checked-in':
      case 'checkedin':
        return 'checked_in';
      case 'completed':
        return 'completed';
      case 'cancelled':
      case 'canceled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  static String _isoDate(DateTime dt) =>
      '${dt.year.toString().padLeft(4, '0')}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';

  static DateTime _parseDate(Object? raw, DateTime fallback) {
    if (raw == null) return fallback;
    if (raw is DateTime) return raw;
    final s = raw.toString();
    try {
      // Accepts both YYYY-MM-DD (web) and full ISO (local cache).
      return DateTime.parse(s);
    } catch (_) {
      return fallback;
    }
  }

  /// Web-compatible payload for bookings/{id}. Extra keys (ref_id, uid,
  /// kyc_status, kyc urls, reject reason, source, eta_share_url) are additive.
  /// kyc_id_url/kyc_receipt_url carry Storage download URLs for /admin review;
  /// kyc_reject_reason is admin-written (guest allowlist excludes it).
  Map<String, dynamic> toCloudMap() {
    return {
      'ref_id': referenceId,
      'guest_name': guestName,
      'phone': phone,
      'email': email,
      'check_in': _isoDate(checkInDate),
      'check_out': _isoDate(checkOutDate),
      'guests': guestCount,
      'accommodation': accommodationId,
      'special_requests': notes,
      'status': cloudStatus,
      'kyc_status': kycStatus,
      'kyc_id_url': kycIdUrl,
      'kyc_receipt_url': kycReceiptUrl,
      'kyc_reject_reason': kycRejectReason,
      'uid': uid,
      // Live location never crosses this map: it is written to
      // tracking_sessions/{docId} instead (G6). Old cloud docs may still
      // carry pickup_* keys; fromCloud ignores them for the same reason.
      'source': cloudSource,
      // created_at is set with serverTimestamp() by the service;
      // kept here as ISO for offline queue debugging.
      'created_at': createdAt.toIso8601String(),
    };
  }

  /// Parses a cloud doc (or local cache) back into an in-app Booking.
  /// Accepts both web shape (snake_case + Capitalized) and local shape.
  factory Booking.fromCloud(String docId, Map<String, dynamic> data) {
    final now = DateTime.now();
    final refId = (data['ref_id'] ?? data['referenceId'] ?? docId).toString();
    final title = data['accommodationTitle'] as String? ??
        accommodationTitles[(data['accommodation'] ?? '').toString()] ??
        (data['accommodation'] ?? 'Main House Villa').toString();
    return Booking(
      referenceId: refId,
      guestName: (data['guest_name'] ?? data['guestName'] ?? '').toString(),
      phone: (data['phone'] ?? '').toString(),
      email: (data['email'] ?? '').toString(),
      accommodationTitle: title,
      checkInDate: _parseDate(
          data['check_in'] ?? data['checkInDate'], now),
      checkOutDate: _parseDate(
          data['check_out'] ?? data['checkOutDate'],
          now.add(const Duration(days: 1))),
      guestCount: (data['guests'] ?? data['guestCount'] ?? 1) as int? ??
          int.tryParse((data['guests'] ?? '1').toString()) ??
          1,
      notes:
          (data['special_requests'] ?? data['notes'] ?? '').toString(),
      status: statusFromCloud(data['status']),
      kycStatus: (data['kyc_status'] ?? data['kycStatus'] ?? 'required')
          .toString(),
      uid: data['uid']?.toString(),
      // Live location is not read back from the cloud doc (G6): it lives on
      // the tracking session. The local pickup fields stay null for cloud
      // bookings; local-only bookings keep theirs from fromJson.
      firestoreId: docId,
      synced: true,
      govtIdPath: data['kyc_id_url']?.toString() ??
          (data['govtIdPath'] as String?),
      paymentReceiptPath: data['kyc_receipt_url']?.toString() ??
          (data['paymentReceiptPath'] as String?),
      kycIdUrl: (data['kyc_id_url'] as String?),
      kycReceiptUrl: (data['kyc_receipt_url'] as String?),
      kycRejectReason: (data['kyc_reject_reason'] as String?),
      createdAt: _parseDate(data['created_at'] ?? data['createdAt'], now),
    );
  }

  /// Half-open overlap: [aIn, aOut) vs [bIn, bOut), date granularity.
  /// Checkout day is free for the next guest.
  static bool datesOverlap(
      DateTime aIn, DateTime aOut, DateTime bIn, DateTime bOut) {
    final a1 = DateTime(aIn.year, aIn.month, aIn.day);
    final a2 = DateTime(aOut.year, aOut.month, aOut.day);
    final b1 = DateTime(bIn.year, bIn.month, bIn.day);
    final b2 = DateTime(bOut.year, bOut.month, bOut.day);
    return a1.isBefore(b2) && b1.isBefore(a2);
  }

  /// True if this booking blocks the given range (same stay + active status).
  bool blocksRange(DateTime inDate, DateTime outDate, {String? sameStay}) {
    if (sameStay != null && accommodationId != sameStay) return false;
    if (status == 'cancelled' ||
        status == 'completed' ||
        isExpiredLocal) {
      return false;
    }
    if (status != 'pending' &&
        status != 'confirmed' &&
        status != 'checked_in') {
      return false;
    }
    return datesOverlap(checkInDate, checkOutDate, inDate, outDate);
  }

  /// Key activates check-in day at 2PM.
  DateTime get keyActivatesAt => DateTime(
        checkInDate.year,
        checkInDate.month,
        checkInDate.day,
        keyCheckInHour,
      );

  /// Key expires check-out day at 12NN + 1hr grace.
  DateTime get keyExpiresAt => DateTime(
        checkOutDate.year,
        checkOutDate.month,
        checkOutDate.day,
        keyCheckOutHour,
      ).add(const Duration(hours: keyGraceHours));

  /// Digital key gate — all must be true:
  /// status confirmed|checked_in + kyc approved + inside date window.
  bool keyEnabled([DateTime? now]) => keyDisabledReason(now) == null;

  /// Null when enabled, otherwise a human-readable disabled reason.
  /// Always shows *why* so the UI never silently fails.
  String? keyDisabledReason([DateTime? now]) {
    final current = now ?? DateTime.now();
    if (status == 'cancelled') return 'Booking was cancelled.';
    if (status == 'completed') return 'Stay completed — key expired.';
    if (status != 'confirmed' && status != 'checked_in') {
      return 'Locked while your booking awaits host confirmation.';
    }
    if (kycStatus == 'rejected') {
      return 'ID verification failed — please re-upload a valid ID.';
    }
    if (kycStatus != 'approved') {
      return kycStatus == 'submitted'
          ? 'ID verification pending — key unlocks after host approval.'
          : 'Complete KYC verification to activate your key.';
    }
    if (current.isBefore(keyActivatesAt)) {
      return 'Key activates ${_shortDate(keyActivatesAt)} 2:00 PM.';
    }
    if (!current.isBefore(keyExpiresAt)) {
      return 'Key expired after checkout (12NN + 1hr grace).';
    }
    return null;
  }

  static String _shortDate(DateTime dt) {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return '${weekdays[dt.weekday - 1]} ${months[dt.month - 1]} ${dt.day}';
  }

  String get statusLabel {
    if (isExpiredLocal) return 'Expired';
    switch (status) {
      case 'pending':
        if (kycStatus == 'rejected') return 'ID Rejected';
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
        'kycIdUrl': kycIdUrl,
        'kycReceiptUrl': kycReceiptUrl,
        'kycRejectReason': kycRejectReason,
        'uid': uid,
        'etaShareUrl': etaShareUrl,
        'pickupLat': pickupLat,
        'pickupLng': pickupLng,
        'pickupUpdatedAt': pickupUpdatedAt?.toIso8601String(),
        'pickupLabel': pickupLabel,
        'firestoreId': firestoreId,
        'synced': synced,
        'createdAt': createdAt.toIso8601String(),
      };

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
        referenceId: json['referenceId'] as String? ??
            (json['ref_id'] as String?) ??
            'HDL-000000-XXXX',
        guestName: (json['guestName'] ?? json['guest_name'] ?? '') as String,
        phone: json['phone'] as String? ?? '',
        email: (json['email'] ?? '') as String,
        accommodationTitle: json['accommodationTitle'] as String? ??
            accommodationTitles[(json['accommodation'] ?? '').toString()] ??
            (json['accommodation'] as String? ?? 'Main House Villa'),
        checkInDate: _parseDate(
            json['checkInDate'] ?? json['check_in'], DateTime.now()),
        checkOutDate: _parseDate(
            json['checkOutDate'] ?? json['check_out'],
            DateTime.now().add(const Duration(days: 1))),
        guestCount: (json['guestCount'] ?? json['guests'] ?? 1) is int
            ? ((json['guestCount'] ?? json['guests'] ?? 1) as int)
            : int.tryParse(
                    (json['guestCount'] ?? json['guests'] ?? '1').toString()) ??
                1,
        notes: ((json['notes'] ?? json['special_requests'] ?? '') as String),
        status: statusFromCloud(json['status']),
        kycStatus:
            ((json['kycStatus'] ?? json['kyc_status'] ?? 'required')) as String,
        govtIdPath: (json['govtIdPath'] ?? json['kyc_id_url']) as String?,
        paymentReceiptPath:
            (json['paymentReceiptPath'] ?? json['kyc_receipt_url']) as String?,
        kycIdUrl:
            (json['kycIdUrl'] ?? json['kyc_id_url']) as String?,
        kycReceiptUrl:
            (json['kycReceiptUrl'] ?? json['kyc_receipt_url']) as String?,
        kycRejectReason: (json['kycRejectReason'] ??
            json['kyc_reject_reason']) as String?,
        uid: json['uid'] as String?,
        etaShareUrl:
            (json['etaShareUrl'] ?? json['eta_share_url']) as String?,
        pickupLat:
            (json['pickupLat'] ?? json['pickup_lat'] as num?)?.toDouble(),
        pickupLng:
            (json['pickupLng'] ?? json['pickup_lng'] as num?)?.toDouble(),
        pickupUpdatedAt: (json['pickupUpdatedAt'] ?? json['pickup_updated_at']) != null
            ? _parseDate(json['pickupUpdatedAt'] ?? json['pickup_updated_at'], DateTime.now())
            : null,
        pickupLabel:
            (json['pickupLabel'] ?? json['pickup_label'])?.toString(),
        firestoreId: json['firestoreId'] as String?,
        synced: (json['synced'] as bool?) ?? false,
        createdAt: json['createdAt'] != null
            ? DateTime.parse(json['createdAt'] as String)
            : (json['created_at'] != null
                ? _parseDate(json['created_at'], DateTime.now())
                : null),
      );
}
