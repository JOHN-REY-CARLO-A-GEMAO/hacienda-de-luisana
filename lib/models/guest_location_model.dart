import '../constants/app_constants.dart';
import '../core/utils/geo_utils.dart';

class GuestLocationModel {
  final String sessionId;
  final String bookingId;
  final String guestName;
  final double latitude;
  final double longitude;
  final String currentArea;
  final double distanceRemainingKm;
  final int estimatedMinutesRemaining;
  final bool isNearResort;
  final bool hasArrived;
  final DateTime lastUpdated;

  GuestLocationModel({
    required this.sessionId,
    required this.bookingId,
    required this.guestName,
    required this.latitude,
    required this.longitude,
    required this.currentArea,
    required this.distanceRemainingKm,
    required this.estimatedMinutesRemaining,
    required this.isNearResort,
    required this.hasArrived,
    required this.lastUpdated,
  });

  factory GuestLocationModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    final lat = (json['latitude'] ?? json['pickup_lat'] ?? AppConstants.resortLatitude + 0.05).toDouble();
    final lng = (json['longitude'] ?? json['pickup_lng'] ?? AppConstants.resortLongitude + 0.05).toDouble();
    final dist = json['distanceRemainingKm'] != null
        ? (json['distanceRemainingKm'] as num).toDouble()
        : GeoUtils.calculateDistanceKm(lat, lng);
    final eta = json['estimatedMinutesRemaining'] != null
        ? (json['estimatedMinutesRemaining'] as num).toInt()
        : GeoUtils.estimateEtaMinutes(dist);

    return GuestLocationModel(
      sessionId: docId ?? json['sessionId'] ?? json['session_id'] ?? 'sess-${DateTime.now().millisecondsSinceEpoch}',
      bookingId: json['bookingId'] ?? json['booking_id'] ?? json['id'] ?? '',
      guestName: json['guestName'] ?? json['guest_name'] ?? 'Guest',
      latitude: lat,
      longitude: lng,
      currentArea: json['currentArea'] ?? json['pickup_area'] ?? GeoUtils.guessLagunaArea(lat, lng),
      distanceRemainingKm: dist,
      estimatedMinutesRemaining: eta,
      isNearResort: dist <= AppConstants.nearbyThresholdKm,
      hasArrived: dist <= AppConstants.arrivedThresholdKm,
      lastUpdated: json['lastUpdated'] != null
          ? (json['lastUpdated'] is String
              ? DateTime.parse(json['lastUpdated'])
              : (json['lastUpdated'] as dynamic).toDate())
          : (json['pickup_updated_at'] != null ? DateTime.parse(json['pickup_updated_at']) : DateTime.now()),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'sessionId': sessionId,
      'bookingId': bookingId,
      'guestName': guestName,
      'latitude': latitude,
      'longitude': longitude,
      'currentArea': currentArea,
      'distanceRemainingKm': distanceRemainingKm,
      'estimatedMinutesRemaining': estimatedMinutesRemaining,
      'isNearResort': isNearResort,
      'hasArrived': hasArrived,
      'lastUpdated': lastUpdated.toIso8601String(),
    };
  }

  GuestLocationModel copyWith({
    String? sessionId,
    String? bookingId,
    String? guestName,
    double? latitude,
    double? longitude,
    String? currentArea,
    double? distanceRemainingKm,
    int? estimatedMinutesRemaining,
    bool? isNearResort,
    bool? hasArrived,
    DateTime? lastUpdated,
  }) {
    return GuestLocationModel(
      sessionId: sessionId ?? this.sessionId,
      bookingId: bookingId ?? this.bookingId,
      guestName: guestName ?? this.guestName,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      currentArea: currentArea ?? this.currentArea,
      distanceRemainingKm: distanceRemainingKm ?? this.distanceRemainingKm,
      estimatedMinutesRemaining: estimatedMinutesRemaining ?? this.estimatedMinutesRemaining,
      isNearResort: isNearResort ?? this.isNearResort,
      hasArrived: hasArrived ?? this.hasArrived,
      lastUpdated: lastUpdated ?? this.lastUpdated,
    );
  }
}
