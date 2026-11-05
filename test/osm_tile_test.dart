import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/core/config/carto_config.dart';
import 'package:hacienda_de_luisana/views/inbox/osm_tile.dart';

void main() {
  group('basemap tile projection', () {
    test('projects the equator and prime meridian to the world centre', () {
      final point = projectOsmCoordinate(latitude: 0, longitude: 0, zoom: 1);
      expect(point.x, 256);
      expect(point.y, closeTo(256, 0.000001));
    });

    test('produces the standard integer z/x/y tile URL', () {
      final url = osmTileUrl(zoom: 1, x: 1, y: 1);
      expect(url, startsWith('https://basemaps.cartocdn.com/rastertiles/voyager/1/1/1.png'));
    });

    test('never asks the OpenStreetMap project\'s own tile server', () {
      // OSM's tile usage policy names distributing an app that uses
      // tile.openstreetmap.org as the case it forbids. This app is distributed,
      // so it must not put that host in a tile URL — the failure would be a 403
      // and a grey panel for every Admin at once, not a warning.
      for (var z = 0; z <= 3; z++) {
        final n = 1 << z;
        for (var x = 0; x < n; x++) {
          for (var y = 0; y < n; y++) {
            final url = osmTileUrl(zoom: z, x: x, y: y);
            expect(url.contains('tile.openstreetmap.org'), isFalse);
            expect(url.contains('cartocdn.com'), isTrue);
          }
        }
      }
    });

    test('carries the key only when one was supplied at build time', () {
      // The key arrives by --dart-define, so a plain test run has none: the URL
      // must still be a valid CARTO URL (watermarked, but drawable) rather than
      // a broken one with an empty key parameter.
      expect(hasCartoKey, cartoKey.isNotEmpty);
      if (hasCartoKey) {
        expect(osmTileUrl(zoom: 1, x: 1, y: 1), contains('?key='));
      } else {
        expect(osmTileUrl(zoom: 1, x: 1, y: 1), isNot(contains('key=')));
      }
    });

    test('credits both sources, because both are required', () {
      expect(osmTileAttribution, contains('OpenStreetMap'));
      expect(osmTileAttribution, contains('CARTO'));
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
