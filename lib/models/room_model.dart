/// The operational status of one Accommodation.
///
/// This is a **status register**, not a catalogue. It answers one question —
/// is this Accommodation available, occupied or under maintenance right now —
/// and it deliberately holds no name, capacity, price, image or amenity.
///
/// Those used to live here, invented from defaults whenever a `rooms` document
/// was missing them: a room called "Villa LuisAna" for six guests at ₱15,000 a
/// night with a private pool. None of it existed anywhere else in the system —
/// not on the website, not in the published rates, not in any booking — and the
/// Admin's Rooms screen displayed it as though it did.
///
/// Accommodation identity now comes from one place, the published rates
/// document (`site_config/rates`): its keys are the canonical ids, its
/// `property_name` is the name, and `guest_pricing` holds the money. [accommodationId]
/// is a reference into that document, never a name of its own.
library;

enum RoomStatus {
  available,
  occupied,
  maintenance,
}

extension RoomStatusX on RoomStatus {
  String get displayName {
    switch (this) {
      case RoomStatus.available:
        return 'Available';
      case RoomStatus.occupied:
        return 'Occupied';
      case RoomStatus.maintenance:
        return 'Under Maintenance';
    }
  }

  static RoomStatus fromString(String val) {
    switch (val.toLowerCase()) {
      case 'occupied':
        return RoomStatus.occupied;
      case 'maintenance':
        return RoomStatus.maintenance;
      case 'available':
        return RoomStatus.available;
      default:
        // An unrecognised status is a maintenance state, not a free one. The
        // status governs whether the Admin may sell the Accommodation, so an
        // unknown value must not read as "available".
        return RoomStatus.maintenance;
    }
  }
}

class RoomModel {
  /// The `rooms/{documentId}` this status is stored on.
  final String id;

  /// The canonical Accommodation this status is about — `main-house`, `annex`
  /// or `house-a-camping`.
  ///
  /// Null on a document written before the canonical ids existed. Such a
  /// document keeps its status and simply does not appear against any
  /// Accommodation, rather than being guessed at.
  final String? accommodationId;

  final RoomStatus status;

  const RoomModel({
    required this.id,
    required this.status,
    this.accommodationId,
  });

  /// Reads a status document.
  ///
  /// Nothing here invents a value. A document missing its status reads as
  /// [RoomStatus.maintenance] — see [RoomStatusX.fromString] — and a document
  /// missing its Accommodation reference yields a null [accommodationId] rather
  /// than a plausible-looking name.
  factory RoomModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    final rawId = json['accommodationId'] ?? json['accommodation_id'];
    return RoomModel(
      id: docId ?? json['id'] ?? '',
      accommodationId: rawId is String && rawId.isNotEmpty ? rawId : null,
      status: RoomStatusX.fromString((json['status'] ?? '').toString()),
    );
  }

  RoomModel copyWith({
    String? id,
    String? accommodationId,
    RoomStatus? status,
  }) {
    return RoomModel(
      id: id ?? this.id,
      accommodationId: accommodationId ?? this.accommodationId,
      status: status ?? this.status,
    );
  }
}