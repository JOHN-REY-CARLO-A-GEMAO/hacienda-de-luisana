// BookingModel reads the website's Booking documents (snake_case, Firestore
// Timestamps or ISO strings) and keeps the exact lifecycle status.
//
// Run: flutter test test/booking_model_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/services/accommodations.dart';

void main() {
  final webDoc = <String, dynamic>{
    'ref_id': 'HDL-2026-0001',
    'uid': 'guest-uid',
    'source': 'web',
    'guest_name': 'Ana Santos',
    'phone': '0917 000 0000',
    'email': 'ana@example.com',
    'accommodation': 'main-house',
    'check_in': '2026-10-10',
    'check_out': '2026-10-12',
    'guests': 4,
    'status': 'Pending',
    'hold_expires_at': '2026-10-02T00:00:00.000Z',
    'created_at': '2026-10-01T00:00:00.000Z',
    'stay_total': 12000,
  };

  test('parses a website Booking', () {
    final b = BookingModel.fromJson(webDoc, 'doc-1');
    expect(b.id, 'doc-1');
    expect(b.guestName, 'Ana Santos');
    // The stored id, not a name. A display name here would match no published
    // rate: `firestore.rules` checks this field against the rates document's keys.
    expect(b.accommodation, 'main-house');
    expect(b.rawStatus, 'Pending');
    expect(b.status, BookingStatus.pending);
    expect(b.refId, 'HDL-2026-0001');
    expect(b.uid, 'guest-uid');
    expect(b.stayTotal, 12000);
    expect(b.totalAmount, 12000);
    expect(b.totalNights, 2);
    expect(b.holdExpiresAt, DateTime.parse('2026-10-02T00:00:00.000Z'));
  });

  group('the Accommodation label', () {
    // The canonical published document, as the Admin app reads it.
    final published = Accommodation.fromRatesDocument(<String, dynamic>{
      'accommodations': <String, dynamic>{
        'main-house': <String, dynamic>{
          'property_name': 'The Main House',
          'rate_unit': 'standard_stay',
          'available_units': 1,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{'min_guests': 1, 'base_max_guests': 10, 'base_rate': 5000},
          },
        },
        'annex': <String, dynamic>{
          'property_name': 'HDL Annex',
          'rate_unit': 'standard_stay',
          'available_units': 1,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{'min_guests': 1, 'base_max_guests': 6, 'base_rate': 4000},
          },
        },
        'house-a-camping': <String, dynamic>{
          'property_name': 'A-House',
          'rate_unit': 'standard_stay',
          'available_units': 2,
          'guest_pricing': <String, dynamic>{
            'units_per_booking': 1,
            'weekday': <String, dynamic>{'min_guests': 1, 'base_max_guests': 3, 'max_guests': 3, 'base_rate': 1000},
          },
        },
      },
    })!;

    test('names an Accommodation from the published document', () {
      expect(BookingModel.accommodationLabel('main-house', published), 'The Main House');
      expect(BookingModel.accommodationLabel('annex', published), 'HDL Annex');
      expect(BookingModel.accommodationLabel('house-a-camping', published), 'A-House');
    });

    test('shows the id rather than inventing a name when nothing is published', () {
      // This used to be a `switch` in this file mapping the three ids to three
      // names, next to the published `property_name` and the website's own list —
      // and the three had already drifted apart.
      expect(BookingModel.accommodationLabel('main-house'), 'main-house');
      expect(BookingModel.accommodationLabel('house-a-camping'), 'house-a-camping');
    });

    test('treats a missing Accommodation as missing, not as the Main House', () {
      // The old default wrote 'The Main House' into an unnamed Booking, which
      // then reached availability as a name that matched no other Booking's dates.
      final b = BookingModel.fromJson(
          <String, dynamic>{...webDoc}..remove('accommodation'), 'doc-1');
      expect(b.accommodation, isEmpty);
      expect(BookingModel.accommodationLabel(b.accommodation, published), 'Not recorded');
      expect(b.toLifecycleDoc()['accommodation'], isEmpty);
    });

    test('reads the A-House as two units of three guests, one per booking', () {
      final aHouse = Accommodation.byId(published, 'house-a-camping')!;
      expect(aHouse.availableUnits, 2);
      expect(aHouse.unitsPerBooking, 1);
      expect(aHouse.includedGuests, 3);
      expect(aHouse.maxGuests, 3);
      expect(unitsForAccommodation('house-a-camping', published), 2);
      expect(unitsForAccommodation('main-house', published), 1);
      // The Main House has no ceiling: a guest above the included count is priced.
      expect(Accommodation.byId(published, 'main-house')!.maxGuests, isNull);
    });

    test('an unknown Accommodation is one unit, never unlimited inventory', () {
      expect(unitsForAccommodation('nobody-published-this', published), 1);
      expect(unitsForAccommodation('main-house', const []), 1);
    });
  });

  test('uses the stored total or saved legacy rate snapshot rather than inventing a per-night price', () {
    expect(
      BookingModel.fromJson({
        ...webDoc,
        'stay_total': 5000,
        'total_amount': 32000,
      }).totalAmount,
      5000,
    );
    final legacy = Map<String, dynamic>.from(webDoc)
      ..remove('stay_total')
      ..addAll({'rate_amount': 4250, 'rate_unit': 'night', 'nights': 2});
    expect(BookingModel.fromJson(legacy).totalAmount, 8500);
    final noSnapshot = Map<String, dynamic>.from(webDoc)..remove('stay_total');
    expect(BookingModel.fromJson(noSnapshot).totalAmount, 0);
  });

  test('stages bucket the eleven statuses, and retired values read as successors', () {
    expect(BookingStatusX.fromString('Reserved'), BookingStatus.confirmed);
    expect(BookingStatusX.fromString('Payment Pending'), BookingStatus.confirmed);
    expect(BookingStatusX.fromString('Staying'), BookingStatus.checkedIn);
    expect(BookingStatusX.fromString('Checked-Out'), BookingStatus.completed);
    expect(BookingStatusX.fromString('Expired'), BookingStatus.cancelled);
    // Retired vocabulary still reads as the status that means the same today.
    expect(BookingStatusX.fromString('Confirmed'), BookingStatus.confirmed);
    expect(BookingStatusX.fromString('KYC Submitted'), BookingStatus.pending);
    expect(BookingStatusX.fromString('Approved'), BookingStatus.confirmed);
  });

  test('toLifecycleDoc keeps the stored fields the rules read', () {
    final doc = BookingModel.fromJson(webDoc, 'doc-1').toLifecycleDoc();
    expect(doc['id'], 'doc-1');
    expect(doc['status'], 'Pending');
    expect(doc['accommodation'], 'main-house');
    expect(doc['check_in'], '2026-10-10');
    expect(doc['hold_expires_at'], '2026-10-02T00:00:00.000Z');
  });

  test('applyPatch reflects an accepted action locally', () {
    final b = BookingModel.fromJson(webDoc, 'doc-1');
    final after = b.applyPatch({'status': 'Payment Pending', 'hold_expires_at': null});
    expect(after.rawStatus, 'Payment Pending');
    expect(after.status, BookingStatus.confirmed);
    expect(after.holdExpiresAt, isNull);
    expect(after.guestName, 'Ana Santos');
    expect(after.id, 'doc-1');
  });

  test('nextStep tells the Admin what is waiting', () {
    expect(BookingModel.fromJson(webDoc).nextStep, contains('downpayment screenshot'));
    expect(
      BookingModel.fromJson({...webDoc, 'status': 'Payment Pending'}).nextStep,
      contains('choose a payment plan'),
    );
    expect(
      BookingModel.fromJson({
        ...webDoc,
        'status': 'Payment Pending',
        'payment_plan': 'full',
        'payment_proof_url': 'https://x/p.jpg',
      }).nextStep,
      contains('Verify'),
    );
  });
}
