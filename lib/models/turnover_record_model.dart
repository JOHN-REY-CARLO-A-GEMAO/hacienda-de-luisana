/// One check-out hold record (`room_turnover/{recordId}`): a damage
/// inspection or a cleaning pass, filed by the Admin between check-out and
/// completion of the Booking.
///
/// The desk tap at check-out revokes the key and the room goes on a cleaning
/// hold — the Admin inspects for missing or damaged items (and messages the
/// departed Guest through the chat when any are found), cleaning is recorded,
/// and only then may the Booking be Completed and the Accommodation sold
/// again. Each pass is one append-only document here; the rules close the key
/// set and refuse deletes.
///
/// The shape mirrors the `match /room_turnover/{recordId}` block in
/// `firestore.rules`.
library;

enum TurnoverKind { damage, cleaning }

extension TurnoverKindX on TurnoverKind {
  String get name {
    switch (this) {
      case TurnoverKind.damage:
        return 'damage';
      case TurnoverKind.cleaning:
        return 'cleaning';
    }
  }

  String get displayName {
    switch (this) {
      case TurnoverKind.damage:
        return 'Damage / missing items';
      case TurnoverKind.cleaning:
        return 'Cleaning & inspection';
    }
  }

  static TurnoverKind fromString(String val) {
    switch (val.toLowerCase()) {
      case 'damage':
        return TurnoverKind.damage;
      case 'cleaning':
      default:
        return TurnoverKind.cleaning;
    }
  }
}

class TurnoverRecordModel {
  final String id;
  final String bookingId;

  /// The canonical Accommodation — `main-house`, `annex` or `house-a-camping`.
  final String accommodationId;
  final TurnoverKind kind;

  /// Missing or damaged items found at inspection (damage records).
  final List<String> items;

  /// Who cleaned the room, when recorded by the Admin (cleaners are not
  /// system users; the Admin records the outcome).
  final String? cleanerName;

  /// Who performed the inspection / filed the record (display name).
  final String? inspectedBy;

  /// True when the departed Guest was messaged about missing/damaged items.
  final bool guestContacted;
  final String? notes;

  final DateTime at;
  final String createdBy;
  final DateTime? updatedAt;

  const TurnoverRecordModel({
    required this.id,
    required this.bookingId,
    required this.accommodationId,
    required this.kind,
    this.items = const [],
    this.cleanerName,
    this.inspectedBy,
    this.guestContacted = false,
    this.notes,
    required this.at,
    required this.createdBy,
    this.updatedAt,
  });

  factory TurnoverRecordModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    return TurnoverRecordModel(
      id: docId ?? json['id'] ?? '',
      bookingId: (json['bookingId'] ?? '').toString(),
      accommodationId: (json['accommodationId'] ?? '').toString(),
      kind: TurnoverKindX.fromString((json['kind'] ?? 'cleaning').toString()),
      items: (json['items'] is List) ? (json['items'] as List).map((e) => e.toString()).toList() : const [],
      cleanerName: json['cleanerName']?.toString(),
      inspectedBy: json['inspectedBy']?.toString(),
      guestContacted: json['guestContacted'] == true,
      notes: json['notes']?.toString(),
      at: _date(json['at']) ?? DateTime.now(),
      createdBy: (json['createdBy'] ?? '').toString(),
      updatedAt: _date(json['updatedAt']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'bookingId': bookingId,
      'kind': kind.name,
      'accommodationId': accommodationId,
      'items': items,
      if (cleanerName != null) 'cleanerName': cleanerName,
      if (inspectedBy != null) 'inspectedBy': inspectedBy,
      'guestContacted': guestContacted,
      if (notes != null) 'notes': notes,
      'at': at.toIso8601String(),
      'createdBy': createdBy,
      if (updatedAt != null) 'updatedAt': updatedAt!.toIso8601String(),
    };
  }

  static DateTime? _date(dynamic v) {
    if (v == null) return null;
    if (v is String) return DateTime.tryParse(v);
    if (v is DateTime) return v;
    if (v is dynamic && v.toDate is Function) return (v as dynamic).toDate() as DateTime;
    return null;
  }
}
