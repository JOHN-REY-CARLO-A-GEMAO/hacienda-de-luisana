import 'dart:math' as math;
import '../constants/app_constants.dart';

class GeoUtils {
  /// Calculate distance in kilometers between two GPS coordinates using Haversine formula
  static double calculateDistanceKm(
    double lat1,
    double lon1, [
    double lat2 = AppConstants.resortLatitude,
    double lon2 = AppConstants.resortLongitude,
  ]) {
    const double earthRadiusKm = 6371.0;

    final dLat = _degToRad(lat2 - lat1);
    final dLon = _degToRad(lon2 - lon1);

    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_degToRad(lat1)) *
            math.cos(_degToRad(lat2)) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);

    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    final distance = earthRadiusKm * c;
    return (distance * 10).roundToDouble() / 10.0;
  }

  static double _degToRad(double deg) => deg * (math.pi / 180.0);

  /// Estimate remaining driving minutes based on distance and average country speed
  static int estimateEtaMinutes(double distanceKm, {double avgSpeedKmh = 32.0}) {
    if (distanceKm <= AppConstants.arrivedThresholdKm) return 0;
    final hours = distanceKm / avgSpeedKmh;
    final minutes = (hours * 60).round();
    return minutes < 1 ? 1 : minutes;
  }

  /// Guess corridor area along the Laguna highway
  static String guessLagunaArea(double lat, double lng) {
    final dist = calculateDistanceKm(lat, lng);
    if (dist <= 0.2) return 'Hacienda de LuisAna Entrance';
    if (dist <= 1.5) return 'Brgy. San Luis / Farm Road, Luisiana';
    if (dist <= 4.0) return 'Luisiana Town Proper, Laguna';
    if (dist <= 10.0) return 'Cavinti - Luisiana Boundary, Laguna';
    if (dist <= 22.0) return 'Pagsanjan - Cavinti Junction, Laguna';
    if (dist <= 35.0) return 'Sta. Cruz / Victoria, Laguna';
    if (dist <= 55.0) return 'Los Baños / Calamba Corridor';
    if (dist <= 85.0) return 'SLEX / South Luzon Expressway';
    return '${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}';
  }

  /// Checkpoint presets for live simulation during client demo presentations
  static final List<SimulationCheckpoint> demoCheckpoints = [
    SimulationCheckpoint(
      id: 'manila',
      label: 'Metro Manila (SLEX)',
      area: 'Alabang, SLEX Tollway',
      latitude: 14.4170,
      longitude: 121.0450,
    ),
    SimulationCheckpoint(
      id: 'calamba',
      label: 'Calamba Exit (~45 km)',
      area: 'Calamba City, Laguna Highway',
      latitude: 14.1950,
      longitude: 121.1480,
    ),
    SimulationCheckpoint(
      id: 'pagsanjan',
      label: 'Pagsanjan Crossing (~14 km)',
      area: 'Pagsanjan Town Center, Laguna',
      latitude: 14.2740,
      longitude: 121.4550,
    ),
    SimulationCheckpoint(
      id: 'cavinti',
      label: 'Cavinti Junction (~8 km)',
      area: 'Cavinti - Luisiana Road',
      latitude: 14.2150,
      longitude: 121.5050,
    ),
    SimulationCheckpoint(
      id: 'nearby',
      label: 'Luisiana Proper (~2.4 km — MALAPIT NA!)',
      area: 'Luisiana Poblacion (Approaching)',
      latitude: 14.1850,
      longitude: 121.5150,
    ),
    SimulationCheckpoint(
      id: 'arrived',
      label: 'Arrived at Resort Gate',
      area: 'Hacienda de LuisAna Entrance',
      latitude: AppConstants.resortLatitude,
      longitude: AppConstants.resortLongitude,
    ),
  ];
}

class SimulationCheckpoint {
  final String id;
  final String label;
  final String area;
  final double latitude;
  final double longitude;

  const SimulationCheckpoint({
    required this.id,
    required this.label,
    required this.area,
    required this.latitude,
    required this.longitude,
  });
}
