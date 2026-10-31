import 'dart:math' as math;

/// Web Mercator projection helpers for the OpenStreetMap raster tile layer.
///
/// A tile URL is addressed by integer `z/x/y`; latitude and longitude must be
/// projected to world pixels first. Keeping this pure makes the URL math easy
/// to test without a device or a network connection.
class OsmWorldPoint {
  const OsmWorldPoint({required this.x, required this.y});

  final double x;
  final double y;
}

const double _maxMercatorLatitude = 85.05112878;
const double osmTileSize = 256;

/// Project a geographic coordinate to global Web Mercator pixels at [zoom].
OsmWorldPoint projectOsmCoordinate({
  required double latitude,
  required double longitude,
  required int zoom,
}) {
  if (zoom < 0 || zoom > 22) {
    throw RangeError.range(zoom, 0, 22, 'zoom');
  }
  final lat = latitude.clamp(-_maxMercatorLatitude, _maxMercatorLatitude);
  final lng = longitude.clamp(-180.0, 180.0);
  final worldSize = osmTileSize * (1 << zoom);
  final x = (lng + 180.0) / 360.0 * worldSize;
  final latRadians = lat * 3.141592653589793 / 180.0;
  final y = (1.0 -
          (math.log(math.tan(latRadians) + 1.0 / math.cos(latRadians)) / 3.141592653589793)) /
      2.0 *
      worldSize;
  return OsmWorldPoint(x: x, y: y);
}

/// Build a standard OSM raster tile URL from integer slippy-map coordinates.
String osmTileUrl({required int zoom, required int x, required int y}) {
  if (zoom < 0 || zoom > 22) {
    throw RangeError.range(zoom, 0, 22, 'zoom');
  }
  final tileCount = 1 << zoom;
  if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) {
    throw RangeError('Invalid OSM tile coordinates: $zoom/$x/$y');
  }
  return 'https://tile.openstreetmap.org/$zoom/$x/$y.png';
}
