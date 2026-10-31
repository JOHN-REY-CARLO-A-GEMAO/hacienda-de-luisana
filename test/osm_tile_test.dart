import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/views/inbox/osm_tile.dart';

void main() {
  group('OpenStreetMap tile projection', () {
    test('projects the equator and prime meridian to the world centre', () {
      final point = projectOsmCoordinate(latitude: 0, longitude: 0, zoom: 1);
      expect(point.x, 256);
      expect(point.y, closeTo(256, 0.000001));
    });

    test('produces the standard integer z/x/y tile URL', () {
      expect(
        osmTileUrl(zoom: 1, x: 1, y: 1),
        'https://tile.openstreetmap.org/1/1/1.png',
      );
    });

    test('clamps latitude at the Web Mercator limit', () {
      final northPole = projectOsmCoordinate(latitude: 90, longitude: 0, zoom: 2);
      final limit = projectOsmCoordinate(latitude: 85.05112878, longitude: 0, zoom: 2);
      expect(northPole.x, limit.x);
      expect(northPole.y, closeTo(limit.y, 0.000001));
    });

    test('rejects invalid tile coordinates', () {
      expect(() => osmTileUrl(zoom: 1, x: 2, y: 0), throwsRangeError);
      expect(() => osmTileUrl(zoom: 1, x: 0, y: -1), throwsRangeError);
      expect(
        () => projectOsmCoordinate(latitude: 0, longitude: 0, zoom: 23),
        throwsRangeError,
      );
    });
  });
}
