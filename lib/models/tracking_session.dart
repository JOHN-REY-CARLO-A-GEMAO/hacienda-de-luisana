import 'package:cloud_firestore/cloud_firestore.dart';

/// One live tracking session — the document where live location lives (G6).
///
/// Mirrors the web's `tracking_sessions` collection
/// (src/lib/trackingSessions.ts) and the rules in firestore.rules:
///
/// - The doc id IS the booking's Firestore id: one active session per booking.
/// - CREATE is the Share click: the consent timestamp goes in the same write
///   as the first position, and the uid must be the traveller's own.
/// - UPDATE is a coordinate ping; the consent and the identity are immutable
///   after the create (even for the traveller).
/// - DELETE is stopping the share (the traveller, or the Host).
class TrackingSession {
  final String bookingId;
  final String uid;

  /// When the traveller clicked Share. Written once, at create, then frozen.
  final DateTime trackingConsentAt;

  final double latitude;
  final double longitude;

  /// The last time the traveller's position was written.
  final DateTime lastUpdated;

  // Derived fields the traveller refreshes with each ping.
  final String? area;
  final String? label;
  final double? distanceKm;
  final int? etaMinutes;
  final String? etaShareUrl;

  TrackingSession({
    required this.bookingId,
    required this.uid,
    required this.trackingConsentAt,
    required this.latitude,
    required this.longitude,
    required this.lastUpdated,
    this.area,
    this.label,
    this.distanceKm,
    this.etaMinutes,
    this.etaShareUrl,
  });

  factory TrackingSession.fromCloud(String docId, Map<String, dynamic> data) {
    final lat = (data['latitude'] as num?)?.toDouble();
    final lng = (data['longitude'] as num?)?.toDouble();
    return TrackingSession(
      bookingId: (data['bookingId'] ?? docId).toString(),
      uid: (data['uid'] ?? '').toString(),
      trackingConsentAt: _parseDate(data['tracking_consent_at']),
      latitude: lat ?? 0,
      longitude: lng ?? 0,
      lastUpdated: _parseDate(data['lastUpdated']),
      area: data['area']?.toString(),
      label: data['label']?.toString(),
      distanceKm: (data['distance_km'] as num?)?.toDouble(),
      etaMinutes: (data['eta_minutes'] as num?)?.toInt(),
      etaShareUrl: data['eta_share_url']?.toString(),
    );
  }

  static DateTime _parseDate(Object? value) {
    if (value == null) return DateTime.fromMillisecondsSinceEpoch(0);
    if (value is DateTime) return value;
    if (value is Timestamp) return value.toDate();
    return DateTime.tryParse(value.toString()) ??
        DateTime.fromMillisecondsSinceEpoch(0);
  }
}
