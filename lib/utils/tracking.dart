// Rider-style pickup -> drop-off helpers (owner app).
// Pickup = guest one-tap GPS, now written to tracking_sessions (G6).
// Drop-off = hotel fixed pin verified from
// https://maps.app.goo.gl/GajLm6NHCqsMBnj57 -> 14.1754304, 121.519389
import '../models/tracking_session.dart';

class Tracking {
  static const double hotelLat = 14.1754304;
  static const double hotelLng = 121.519389;
  static const String hotelName = 'Hacienda de LuisAna';

  static String hotelMapsUrl() =>
      'https://www.google.com/maps/search/?api=1&query=$hotelLat,$hotelLng';

  static String hotelDirectionsUrl() =>
      'https://www.google.com/maps/dir/?api=1&destination=$hotelLat,$hotelLng';

  /// Rider route: guest pickup -> hotel.
  static String directionsUrl(double pickupLat, double pickupLng) =>
      'https://www.google.com/maps/dir/?api=1'
      '&origin=$pickupLat,$pickupLng'
      '&destination=$hotelLat,$hotelLng';

  static String pickupMapsUrl(double lat, double lng) =>
      'https://www.google.com/maps/search/?api=1&query=$lat,$lng';

  /// How long ago a session was last pinged, in words the owner can read.
  static String sessionAge(TrackingSession s) {
    final t = s.lastUpdated;
    final mins = DateTime.now().difference(t).inMinutes;
    if (mins < 1) return 'just now';
    if (mins < 60) return '${mins}m ago';
    final hrs = mins ~/ 60;
    if (hrs < 24) return '${hrs}h ${mins % 60}m ago';
    return '${t.month}/${t.day} ${t.hour}:${t.minute.toString().padLeft(2, '0')}';
  }
}
