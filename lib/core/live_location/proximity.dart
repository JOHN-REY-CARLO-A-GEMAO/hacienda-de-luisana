// ----------------------------------------------------------------------------
// Point B: where the Guest is, relative to the hacienda.
//
// This is a Dart mirror of the point-B half of `src/lib/liveLocationPolicy.ts`,
// and it exists for exactly one reason: the Admin reads this panel inside the
// app and that page in the browser, and the two must not be able to disagree
// about how far away a Guest is. Every constant, threshold and wording below
// is copied deliberately — the web module keeps the canonical unit tests
// (`test/web/live-location-point-b.test.ts`) and this file is checked against
// it by `test/web/live-location-point-b-parity.test.ts`, which reads both
// sources and fails if a constant drifts.
//
// The one thing this file must never do is imply a road distance. It measures a
// straight line between two coordinates and says so; the drive is a link the
// Admin presses, not a number this file computes.
//
// Point B is the *hacienda*, not the Admin. The Admin's own position is never
// read, never asked for, and never enters any of this: an owner looking at their
// phone while sitting in Manila must see the same answer as the one at the gate.
// ----------------------------------------------------------------------------

import 'dart:math' as math;

/// Radius of the earth, metres. Same value as the web module's
/// `EARTH_RADIUS_M`, which the parity test pins.
const double kEarthRadiusM = 6371008.8;

/// Within this, the Guest is "at the property" rather than "near it".
const double kAtPropertyM = 50;

/// Above this distance the status strip falls back to a neutral colour, so an
/// Admin who glances at the panel knows the Guest is still on the road rather
/// than at the gate.
///
/// Purely a display threshold. It changes nothing about what is published,
/// stored, or measured — it decides the colour of a chip and the words beside
/// it, and nothing else. The "at the property" test stays at
/// `max(kAtPropertyM, accuracy)` on both surfaces.
const double kNearbyM = 1500;

/// The eight compass points. As fine as a GPS fix justifies.
enum BearingPoint { n, ne, e, se, s, sw, w, nw }

extension BearingPointWords on BearingPoint {
  /// The word used in a sentence: "…1.8 km from the Hacienda, north-east."
  String get full => switch (this) {
        BearingPoint.n => 'north',
        BearingPoint.ne => 'north-east',
        BearingPoint.e => 'east',
        BearingPoint.se => 'south-east',
        BearingPoint.s => 'south',
        BearingPoint.sw => 'south-west',
        BearingPoint.w => 'west',
        BearingPoint.nw => 'north-west',
      };

  /// The short form for a chip: "NE".
  String get short => switch (this) {
        BearingPoint.n => 'N',
        BearingPoint.ne => 'NE',
        BearingPoint.e => 'E',
        BearingPoint.se => 'SE',
        BearingPoint.s => 'S',
        BearingPoint.sw => 'SW',
        BearingPoint.w => 'W',
        BearingPoint.nw => 'NW',
      };
}

/// What the panel knows about the Guest's relationship to the hacienda.
sealed class Proximity {
  const Proximity();
}

/// Within the threshold, or inside the device's own error: "here".
class AtProperty extends Proximity {
  const AtProperty(this.distanceM);
  final double distanceM;
}

/// A direction and a straight-line distance.
class Away extends Proximity {
  const Away(this.distanceM, this.bearingDeg, this.bearing);
  final double distanceM;
  final double bearingDeg;
  final BearingPoint bearing;
}

/// The point is not a position, so nothing is claimed.
class UnknownProximity extends Proximity {
  const UnknownProximity();
}

/// Great-circle distance between two points, in metres.
///
/// Mirror of `distanceM` in the web module — same haversine, same radius.
double distanceM({
  required double fromLat,
  required double fromLng,
  required double toLat,
  required double toLng,
}) {
  double toRad(double deg) => deg * math.pi / 180;
  final dLat = toRad(toLat - fromLat);
  final dLng = toRad(toLng - fromLng);
  final lat1 = toRad(fromLat);
  final lat2 = toRad(toLat);
  final h = math.pow(math.sin(dLat / 2), 2) +
      math.pow(math.sin(dLng / 2), 2) * math.cos(lat1) * math.cos(lat2);
  return 2 * kEarthRadiusM * math.asin(math.min(1, math.sqrt(h)));
}

/// Initial bearing from the Guest to the hacienda, degrees clockwise from
/// north, 0–360. Mirror of `bearingDegrees` in the web module.
double bearingDegrees({
  required double fromLat,
  required double fromLng,
  required double toLat,
  required double toLng,
}) {
  double toRad(double deg) => deg * math.pi / 180;
  double toDeg(double rad) => rad * 180 / math.pi;
  final lat1 = toRad(fromLat);
  final lat2 = toRad(toLat);
  final dLng = toRad(toLng - fromLng);
  final y = math.sin(dLng) * math.cos(lat2);
  final x = math.cos(lat1) * math.sin(lat2) -
      math.sin(lat1) * math.cos(lat2) * math.cos(dLng);
  return (toDeg(math.atan2(y, x)) + 360) % 360;
}

/// 22.5° per sector, centred on each point, so 350° reads as north rather than
/// as north-west. Mirror of `bearingLabel`.
BearingPoint bearingLabel(double deg) {
  final wrapped = ((deg % 360) + 360) % 360;
  final index = (wrapped / 45).round() % BearingPoint.values.length;
  return BearingPoint.values[index];
}

/// Where the Guest is, relative to a fixed point B.
///
/// [accuracyM] is the reading's own error, used only to widen the "at the
/// property" test in the safe direction — a device that says ±200 m should not
/// produce a confident "15 m away", and should not flip a stable badge back to
/// "40 m away" on the next tick.
Proximity proximityTo({
  required double lat,
  required double lng,
  required double destinationLat,
  required double destinationLng,
  double accuracyM = 0,
}) {
  if (!lat.isFinite || !lng.isFinite) return const UnknownProximity();
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return const UnknownProximity();
  }
  final metres = distanceM(
    fromLat: lat,
    fromLng: lng,
    toLat: destinationLat,
    toLng: destinationLng,
  );
  if (metres <= math.max(kAtPropertyM, accuracyM)) {
    return AtProperty(metres);
  }
  final deg = bearingDegrees(
    fromLat: lat,
    fromLng: lng,
    toLat: destinationLat,
    toLng: destinationLng,
  );
  return Away(metres, deg, bearingLabel(deg));
}

/// A distance in the unit that suits it: metres below a kilometre, one decimal
/// above. The tilde is part of the string on purpose — a GPS fix is never
/// exact, and a bare "1.8 km" invites a precision the reading does not have.
///
/// Mirror of `labelForDistance`.
String labelForDistance(double metres) {
  if (!metres.isFinite || metres < 0) return 'an unknown distance';
  if (metres < 1000) {
    final rounded =
        metres < 100 ? (metres / 10).round() * 10 : (metres / 50).round() * 50;
    return '~${math.max(10, rounded)} m';
  }
  return '~${(metres / 1000).toStringAsFixed(1)} km';
}

/// The whole sentence an Admin reads, in one place. Mirror of
/// `proximitySentence`, word for word, English like the rest of both apps.
String proximitySentence(Proximity proximity) {
  return switch (proximity) {
    UnknownProximity() =>
      'The distance from the Hacienda cannot be worked out from this position.',
    AtProperty() => 'At the Hacienda — within the accuracy of the reading.',
    Away(:final distanceM, :final bearing) =>
      '${labelForDistance(distanceM)} from the Hacienda, ${bearing.full}.',
  };
}

/// The short label for the status chip above the map.
String proximityChipLabel(Proximity proximity) {
  return switch (proximity) {
    UnknownProximity() => 'Distance unknown',
    AtProperty() => 'At the Hacienda',
    Away(:final distanceM, :final bearing) =>
      '${labelForDistance(distanceM)} · ${bearing.short}',
  };
}

/// The one-line caveat that has to sit beside the distance.
///
/// Straight-line, not a drive. Every time this is dropped, somebody reads
/// "~1.8 km" as "1.8 km of road" and concludes the Guest is five minutes away
/// when they are twenty. Mirror of `STRAIGHT_LINE_CAVEAT`.
const String kStraightLineCaveat =
    'Straight-line distance, not the driving route. Open the directions for the road distance.';
