import 'dart:math' as math;

import '../../core/config/carto_config.dart';

/// Web Mercator projection helpers for the live-location map's raster tile
/// layer.
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

// ----------------------------------------------------------------------------
// Where the map's pictures come from
// ----------------------------------------------------------------------------
// These are CARTO's basemaps, not `tile.openstreetmap.org`.
//
// That distinction is the whole point of this file's configuration. OSM's own
// tile server is run by volunteers on donations, and its usage policy says in as
// many words that *"heavy use (e.g. distributing an app that uses tiles from
// openstreetmap.org) is forbidden without prior permission"*. This app is
// distributed, so it was the case the policy is written against — the failure
// would not have been a warning, it would have been a 403 and a grey panel for
// every Admin at once.
//
// CARTO's basemaps are the *same OpenStreetMap data* under a licence that is
// meant to be served to applications, with a free key for up to five million
// tile requests a month. So the map keeps looking like a map of Luisiana, and
// the attribution says OSM and CARTO, because both are true.
//
// The key itself is set in `lib/core/config/carto_config.dart` — one file, one
// paste slot, and a build flag that overrides it. Read that file for why it is
// set there rather than kept out of the repository.
//
// Request one at https://carto.com/basemaps/apikey/ — free, no account, emailed
// back in a minute. Without it CARTO serves a watermarked tile; the app
// deliberately stays usable in that state rather than refusing to draw a map at
// all, and `osmTileAttribution` below still names both sources.
//
// Use is free to 5M tile requests a month for non-commercial projects, and to 1M
// for commercial ones. This is a private hacienda's admin app, so it is the
// latter: ~4 tiles per panel view means roughly 250,000 panel views a month
// before the ceiling. Not a number this feature will reach, but it is the number,
// not "unlimited".
//
// One place defines this. `lib/views/inbox/live_location_panel.dart` is the only
// caller, so a later move to another provider — or to self-hosted tiles — is a
// single edit here.

/// The tile URL template's origin, with no scheme-free subdomain games: CARTO
/// serves from one host and browsers are not involved.
const String _cartoTileOrigin = 'https://basemaps.cartocdn.com/rastertiles/voyager';

/// Build a slippy-map tile URL.
///
/// Voyager is CARTO's general-purpose style: labelled roads, a hierarchy of
/// highways, and readable at the zooms this panel uses (12–16). It is closest to
/// the look the panel had before, which is the least surprising change for an
/// owner who is used to the current map.
String osmTileUrl({required int zoom, required int x, required int y}) {
  if (zoom < 0 || zoom > 22) {
    throw RangeError.range(zoom, 0, 22, 'zoom');
  }
  final tileCount = 1 << zoom;
  if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) {
    throw RangeError('Invalid tile coordinates: $zoom/$x/$y');
  }
  final base = '$_cartoTileOrigin/$zoom/$x/$y.png';
  return hasCartoKey ? '$base?key=$cartoKey' : base;
}

/// The attribution both licences require, as one string.
///
/// OpenStreetMap's data licence requires the OSM credit wherever its data is
/// drawn, and CARTO's terms require theirs. The panel renders this under the
/// map; it is not optional and not a tooltip.
const String osmTileAttribution = '© OpenStreetMap contributors · © CARTO';
