// One Accommodation identity, shared: the Admin app's canonical ids, the
// Firestore rules that enforce them, and the published document they govern must
// never drift apart.
//
// The drift this guards against already happened. `lib/services/booking_lifecycle.dart`
// held a hand-copied `['main-house', 'annex', 'house-a-camping']`, and the Rates
// screen held a hand-copied rate card beside it; neither could see the other and
// neither could see `firestore.rules`. So the app went on publishing an A-House
// the rules refused, and the Admin's Rooms screen listed four invented rooms that
// existed nowhere else.
//
// Run: flutter test test/canonical_accommodations_test.dart

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/accommodations.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';

/// The canonical published document, as the Admin app reads it.
Map<String, dynamic> publishedRates() => <String, dynamic>{
      'version': 'canonical-v1',
      'effective_date': '2026-10-01',
      'holiday_dates': <String>[],
      'accommodations': <String, dynamic>{
        'main-house': <String, dynamic>{
          'property_name': 'The Main House',
          'rate_unit': 'standard_stay',
          'active': true,
          'available_units': 1,
          'security_deposit': 500,
          'down_payment_percent': 50,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 10,
              'base_rate': 5000,
              'excess_per_guest': 500,
            },
            'weekend_holiday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 10,
              'base_rate': 6000,
              'excess_per_guest': 500,
            },
          },
        },
        'annex': <String, dynamic>{
          'property_name': 'HDL Annex',
          'rate_unit': 'standard_stay',
          'active': true,
          'available_units': 1,
          'security_deposit': 500,
          'down_payment_percent': 50,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 6,
              'base_rate': 4000,
              'excess_per_guest': 500,
            },
            'weekend_holiday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 6,
              'base_rate': 5000,
              'excess_per_guest': 500,
            },
          },
        },
        'house-a-camping': <String, dynamic>{
          'property_name': 'A-House',
          'rate_unit': 'standard_stay',
          'active': true,
          'available_units': 2,
          'security_deposit': 0,
          'down_payment_percent': 50,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 3,
              'max_guests': 3,
              'base_rate': 1000,
            },
            'weekend_holiday': <String, dynamic>{
              'min_guests': 1,
              'base_max_guests': 3,
              'max_guests': 3,
              'base_rate': 1000,
            },
          },
        },
      },
    };

void main() {
  group('the canonical Accommodation set', () {
    test('is exactly three, read from the published document', () {
      final parsed = Accommodation.fromRatesDocument(publishedRates())!;
      expect(parsed.map((a) => a.id).toList()..sort(),
          <String>['annex', 'house-a-camping', 'main-house']);
      expect(parsed.map((a) => a.name).toSet(), <String>{
        'The Main House',
        'HDL Annex',
        'A-House',
      });
    });

    test('matches the ids the Firestore rules enforce', () {
      // `firestore.rules` `isCanonicalAccommodation()` is the authority. The app's
      // bootstrap list exists only to draw the Rates screen's cards before anything
      // is published, and this is what keeps it honest.
      final rules = File('firestore.rules').readAsStringSync();
      final canonical = RegExp(r"function isCanonicalAccommodation\(id\) \{\s*return id in \[([^\]]+)\]")
          .firstMatch(rules);
      expect(canonical, isNotNull,
          reason: 'firestore.rules should name the canonical Accommodation ids in one place');

      final fromRules = RegExp(r"'([^']+)'")
          .allMatches(canonical!.group(1)!)
          .map((m) => m.group(1)!)
          .toList();
      expect(fromRules.toSet(), kCanonicalAccommodationIds.toSet());
    });

    test('the rules and the app agree the A-House takes three guests and two units', () {
      final rules = File('firestore.rules').readAsStringSync();
      final aHouse = RegExp(
          r'function validAHouseSchedule\(schedule\) \{(.*?)\n\s*\}',
          dotAll: true)
          .firstMatch(rules);
      expect(aHouse, isNotNull);
      final body = aHouse!.group(1)!;
      expect(body, contains("base_max_guests', 0) == 3"));
      expect(body, contains("max_guests', 0) == 3"));
      // A cap equal to the included count leaves no guest an excess rule could
      // price, so the rules refuse one.
      expect(body, contains("excess_per_guest"));

      final parsed = Accommodation.fromRatesDocument(publishedRates())!;
      final a = Accommodation.byId(parsed, 'house-a-camping')!;
      expect(a.includedGuests, 3);
      expect(a.maxGuests, 3);
      expect(a.availableUnits, 2);
      expect(a.unitsPerBooking, 1);
    });

    test('the Main House and the Annex price a guest above their included count', () {
      final parsed = Accommodation.fromRatesDocument(publishedRates())!;
      expect(Accommodation.byId(parsed, 'main-house')!.includedGuests, 10);
      expect(Accommodation.byId(parsed, 'main-house')!.maxGuests, isNull);
      expect(Accommodation.byId(parsed, 'annex')!.includedGuests, 6);
      expect(Accommodation.byId(parsed, 'annex')!.maxGuests, isNull);
    });

    test('the canonical document is one the Admin could publish unchanged', () {
      expect(validatePublishedRates(publishedRates()), isEmpty);
    });

    test('a physical inventory that is not a whole number of units is refused', () {
      for (final bad in <Object>[0, -1, 1.5, '2']) {
        final doc = publishedRates();
        (doc['accommodations'] as Map<String, dynamic>)['house-a-camping'] =
            <String, dynamic>{
          ...(doc['accommodations'] as Map<String, dynamic>)['house-a-camping']
              as Map<String, dynamic>,
          'available_units': bad,
        };
        expect(
          validatePublishedRates(doc)
              .map((p) => p.path)
              .toList(),
          contains('accommodations.house-a-camping.available_units'),
          reason: 'available_units: $bad should be refused',
        );
      }
    });

    test('the A-House cannot publish an excess rule its own cap can never charge', () {
      final doc = publishedRates();
      final house = (doc['accommodations'] as Map<String, dynamic>)['house-a-camping']
          as Map<String, dynamic>;
      final pricing = house['guest_pricing'] as Map<String, dynamic>;
      pricing['weekday'] = <String, dynamic>{
        ...(pricing['weekday'] as Map<String, dynamic>),
        'excess_per_guest': 500,
      };
      expect(
        validatePublishedRates(doc).map((p) => p.path).toList(),
        contains('accommodations.house-a-camping.guest_pricing.weekday.excess_per_guest'),
      );
    });
  });

  group('an unpublished document', () {
    test('yields no Accommodations rather than a fallback list', () {
      // The whole point: a surface with nothing published says so, rather than
      // showing the app's own idea of which properties exist.
      expect(Accommodation.fromRatesDocument(null), isNull);
      expect(Accommodation.fromRatesDocument(<String, dynamic>{}), isNull);
      expect(
          Accommodation.fromRatesDocument(<String, dynamic>{'accommodations': null}), isNull);
      expect(unitsForAccommodation('house-a-camping', const []), 1);
    });
  });

  group('retired Accommodation vocabulary', () {
    test('no invented property, amenity or figure is left in the app', () {
      // `Hacienda de LuisAna` is the estate's name and is allowed. What must not
      // appear is the estate name used as an Accommodation, or the rooms and
      // figures that were once offered in its place.
      final retired = <String, RegExp>{
        'Villa LuisAna as an Accommodation': RegExp('Villa LuisAna'),
        'Casita Del Rio': RegExp('Casita', caseSensitive: false),
        'Poolside Casita': RegExp('Poolside Casita', caseSensitive: false),
        'a private pool amenity': RegExp('Private Pool', caseSensitive: false),
        'a mountain view amenity': RegExp('Mountain View', caseSensitive: false),
        'the invented ₱15,000 room rate': RegExp(r'\b15000\b|\b15,000\b'),
      };

      final sources = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          // The files that replaced these values explain what they were, and have
          // to name them to say why they are gone: this test is about data, and a
          // comment naming a retired value cannot reintroduce one.
          .where((f) {
        const explains = <String>[
          'models/room_model.dart',
          'services/mock_data_service.dart',
          'views/rooms/rooms_screen.dart',
          'views/smartlock/smart_lock_screen.dart',
          'models/guest_crm_model.dart',
          'views/crm/guest_crm_screen.dart',
        ];
        return !explains.any((e) => f.path.replaceAll('\\', '/').endsWith(e));
      })
          .toList();

      for (final entry in retired.entries) {
        final hits = <String>[];
        for (final file in sources) {
          if (entry.value.hasMatch(file.readAsStringSync())) {
            hits.add(file.path.replaceAll('\\', '/'));
          }
        }
        expect(hits, isEmpty, reason: '${entry.key} still appears in $hits');
      }
    });
  });
}