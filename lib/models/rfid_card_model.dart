/// One physical RFID card as the help-desk reader sees it: the register entry
/// (`rfid_cards/{cardUid}`) that says what the card currently opens.
///
/// At check-in the desk controller writes a room key onto the card
/// ([CardPayloadKind.roomKey]); at check-out the desk tap revokes that key and
/// rewrites the payload to the website link ([CardPayloadKind.landingLink]),
/// so the Guest keeps the card as a souvenir calling card that opens the site.
/// The touches themselves are recorded in `access_logs`; this document is the
/// current state, which the log alone cannot answer.
///
/// The shape mirrors the `match /rfid_cards/{cardUid}` block in
/// `firestore.rules` — the Admin-only collection whose keys are closed there.
library;

enum RfidCardStatus { active, revoked }

extension RfidCardStatusX on RfidCardStatus {
  String get name {
    switch (this) {
      case RfidCardStatus.active:
        return 'active';
      case RfidCardStatus.revoked:
        return 'revoked';
    }
  }

  String get displayName {
    switch (this) {
      case RfidCardStatus.active:
        return 'ACTIVE (opens a room)';
      case RfidCardStatus.revoked:
        return 'REVOKED (calling card)';
    }
  }

  static RfidCardStatus fromString(String val) {
    switch (val.toLowerCase()) {
      case 'revoked':
        return RfidCardStatus.revoked;
      case 'active':
      default:
        return RfidCardStatus.active;
    }
  }
}

enum CardPayloadKind { roomKey, landingLink }

extension CardPayloadKindX on CardPayloadKind {
  String get name {
    switch (this) {
      case CardPayloadKind.roomKey:
        return 'room_key';
      case CardPayloadKind.landingLink:
        return 'landing_link';
    }
  }

  String get displayName {
    switch (this) {
      case CardPayloadKind.roomKey:
        return 'Room key';
      case CardPayloadKind.landingLink:
        return 'Website link (souvenir calling card)';
    }
  }

  static CardPayloadKind fromString(String val) {
    switch (val.toLowerCase()) {
      case 'landing_link':
      case 'landinglink':
        return CardPayloadKind.landingLink;
      case 'room_key':
      case 'roomkey':
      default:
        return CardPayloadKind.roomKey;
    }
  }
}

class RfidCardModel {
  /// The card's uid — also the document id in `rfid_cards`.
  final String cardUid;

  /// What the card currently carries: a room key or the website link.
  final CardPayloadKind payloadKind;

  /// The encoded payload itself (`KEY:<accommodation>:<bookingRef>` or the URL).
  final String payload;

  final RfidCardStatus status;

  /// The Booking the current room key belongs to, when it does.
  final String? bookingRefId;

  /// The canonical Accommodation the key opens — `main-house`, `annex` or
  /// `house-a-camping`.
  final String? accommodationId;

  final DateTime issuedAt;
  final String issuedBy;
  final DateTime? revokedAt;
  final DateTime? rewrittenAt;

  const RfidCardModel({
    required this.cardUid,
    required this.payloadKind,
    required this.payload,
    required this.status,
    required this.issuedAt,
    required this.issuedBy,
    this.bookingRefId,
    this.accommodationId,
    this.revokedAt,
    this.rewrittenAt,
  });

  factory RfidCardModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    return RfidCardModel(
      cardUid: docId ?? json['cardUid'] ?? '',
      payloadKind: CardPayloadKindX.fromString((json['payloadKind'] ?? 'room_key').toString()),
      payload: (json['payload'] ?? '').toString(),
      status: RfidCardStatusX.fromString((json['status'] ?? 'active').toString()),
      issuedAt: _date(json['issuedAt']) ?? DateTime.now(),
      issuedBy: (json['issuedBy'] ?? '').toString(),
      bookingRefId: json['bookingRefId']?.toString(),
      accommodationId: json['accommodationId']?.toString(),
      revokedAt: _date(json['revokedAt']),
      rewrittenAt: _date(json['rewrittenAt']),
    );
  }

  RfidCardModel copyWith({
    CardPayloadKind? payloadKind,
    String? payload,
    RfidCardStatus? status,
    String? bookingRefId,
    String? accommodationId,
    DateTime? revokedAt,
    DateTime? rewrittenAt,
  }) {
    return RfidCardModel(
      cardUid: cardUid,
      payloadKind: payloadKind ?? this.payloadKind,
      payload: payload ?? this.payload,
      status: status ?? this.status,
      issuedAt: issuedAt,
      issuedBy: issuedBy,
      bookingRefId: bookingRefId ?? this.bookingRefId,
      accommodationId: accommodationId ?? this.accommodationId,
      revokedAt: revokedAt ?? this.revokedAt,
      rewrittenAt: rewrittenAt ?? this.rewrittenAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'cardUid': cardUid,
      'payloadKind': payloadKind.name,
      'payload': payload,
      'status': status.name,
      'issuedAt': issuedAt.toIso8601String(),
      'issuedBy': issuedBy,
      if (bookingRefId != null) 'bookingRefId': bookingRefId,
      if (accommodationId != null) 'accommodationId': accommodationId,
      if (revokedAt != null) 'revokedAt': revokedAt!.toIso8601String(),
      if (rewrittenAt != null) 'rewrittenAt': rewrittenAt!.toIso8601String(),
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
