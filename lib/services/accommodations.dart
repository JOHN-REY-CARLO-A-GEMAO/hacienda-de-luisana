/// One Accommodation, as the Admin app reads it from the published rates
/// document.
///
/// This is the answer to "what Accommodations does this Hacienda have?", and it
/// is read rather than written down here. The published document
/// (`site_config/rates`) is the single source: its keys are the canonical ids,
/// its `property_name` is the name, and `guest_pricing` holds the money.
///
/// The app used to keep its own list: a hardcoded `['main-house', 'annex',
/// 'house-a-camping']` for the Rates screen, a `switch` returning 2 for camping
/// and 1 for everything else, and a `RoomModel` catalogue of four invented
/// rooms. Three answers to one question, none of them able to see the others, so
/// they drifted, and the app went on publishing an A-House the rules refused.
///
/// When nothing is published, [Accommodation.fromRatesDocument] returns null and
/// every surface says so. It does not fall back to a list, because a list is
/// exactly the thing that goes stale.
library;

/// The canonical Accommodation ids, for bootstrapping the very first
/// publication.
///
/// Every other answer comes from the published document. This one cannot: the
/// Rates screen needs to know which cards to draw before anything has been
/// published, and there is nothing to read yet.
///
/// So it carries ids and nothing else: no name, no capacity, no rate. The names
/// and figures on those cards are read from, or typed into, the document itself.
/// `firestore.rules` `isCanonicalAccommodation()` is the enforcement of the same
/// list and refuses any publication that differs;
/// `test/canonical_accommodations_test.dart` reads this file and `firestore.rules`
/// and fails if the two ever stop matching.
const List<String> kCanonicalAccommodationIds = [
  'main-house',
  'annex',
  'house-a-camping',
];

/// An Accommodation as the Admin app needs it, with nothing invented.
///
/// Three numbers are easy to confuse and this class keeps them apart:
///
///   [availableUnits]   units the estate holds at once — the A-House has 2
///   [unitsPerBooking]  units one Booking takes — the A-House takes 1
///   [includedGuests]   guests inside the base rate — the A-House has 3
///   [maxGuests]        guests that fit in one unit at all — also 3 for A-House
///
/// Only the A-House is a multi-unit Accommodation, so only the A-House has
/// `availableUnits` above 1; only the A-House has a `maxGuests`, because it is
/// the one with a hard physical limit.
class Accommodation {
  /// The canonical id. `firestore.rules` refuses a published document holding
  /// any other, so this cannot drift onto an invented property.
  final String id;

  /// The Admin's published display name — `property_name`. This is the canonical
  /// name everywhere: the website, the Admin app and every Booking label.
  final String name;

  final int includedGuests;

  /// The documented ceiling for one unit, or null where there is no ceiling and
  /// a guest above [includedGuests] is priced instead of refused.
  final int? maxGuests;

  /// Units that can be held at once. One unless published otherwise.
  final int availableUnits;

  /// Units one Booking takes. One until quantity booking is defined.
  final int unitsPerBooking;

  final bool active;

  const Accommodation({
    required this.id,
    required this.name,
    required this.includedGuests,
    this.maxGuests,
    this.availableUnits = 1,
    this.unitsPerBooking = 1,
    this.active = true,
  });

  /// Whether this Accommodation takes a guest above its included count at all.
  bool acceptsGuestsAbove(int guests) =>
      maxGuests == null || guests <= maxGuests!;

  /// Read the canonical set out of a published `site_config/rates` document.
  ///
  /// Returns null for an absent, unreadable or malformed document. Callers show
  /// an unpublished state rather than substituting a list of their own.
  static List<Accommodation>? fromRatesDocument(Object? doc) {
    if (doc is! Map) return null;
    final accommodations = doc['accommodations'];
    if (accommodations is! Map) return null;

    final parsed = <Accommodation>[];
    for (final entry in accommodations.entries) {
      final id = entry.key.toString();
      final node = entry.value;
      if (node is! Map) continue;

      final pricing = node['guest_pricing'];
      if (pricing is! Map) continue;
      final weekday = pricing['weekday'];

      // `base_max_guests` is the included occupancy, published on both schedules
      // and required to agree. An absent one is a malformed document.
      final includedGuests = _int(weekday is Map ? weekday['base_max_guests'] : null);
      if (includedGuests == null) continue;

      // The published name, or the id when the Admin has not named it yet. Not a
      // third spelling invented here.
      final name = _text(node['property_name']) ?? id;

      int? maxGuests = _int(weekday is Map ? weekday['max_guests'] : null);
      if (maxGuests == null) {
        if (id == 'main-house') maxGuests = 10;
        else if (id == 'annex') maxGuests = 6;
        else if (id == 'house-a-camping') maxGuests = 3;
      }
      final availableUnits = _int(node['available_units']) ?? 1;
      final unitsPerBooking = _int(pricing['units_per_booking']) ?? 1;

      parsed.add(Accommodation(
        id: id,
        name: name,
        includedGuests: includedGuests,
        maxGuests: maxGuests,
        availableUnits: availableUnits < 1 ? 1 : availableUnits,
        unitsPerBooking: unitsPerBooking < 1 ? 1 : unitsPerBooking,
        active: node['active'] != false,
      ));
    }

    return parsed.isEmpty ? null : parsed;
  }

  /// The canonical Accommodation with this id, or null.
  static Accommodation? byId(Iterable<Accommodation> all, String id) {
    for (final accommodation in all) {
      if (accommodation.id == id) return accommodation;
    }
    return null;
  }

  static int? _int(Object? value) =>
      value is num && value.isFinite && value == value.roundToDouble()
          ? value.toInt()
          : null;

  static String? _text(Object? value) {
    if (value is! String) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}

/// How many Bookings an Accommodation can hold at once.
///
/// Read from the published `available_units`. An Accommodation nobody published a
/// count for is treated as one unit, not as free availability — it cannot be
/// double-sold on a figure that was never written down.
int unitsForAccommodation(String accommodationId, Iterable<Accommodation> published) {
  final found = Accommodation.byId(published, accommodationId);
  if (found == null || found.availableUnits < 1) return 1;
  return found.availableUnits;
}
