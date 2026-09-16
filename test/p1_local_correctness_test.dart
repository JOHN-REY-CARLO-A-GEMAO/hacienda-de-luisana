import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking.dart';
import 'package:hacienda_de_luisana/utils/validators.dart';

Booking makeBooking({
  String status = 'pending',
  String kyc = 'required',
  DateTime? checkIn,
  DateTime? checkOut,
}) {
  final now = DateTime.now();
  return Booking(
    referenceId: Booking.generateReferenceId(now),
    guestName: 'Maria Santos',
    phone: '+639171234567',
    email: 'maria@test.com',
    accommodationTitle: 'Main House Villa',
    checkInDate: checkIn ?? now.add(const Duration(days: 1)),
    checkOutDate: checkOut ?? now.add(const Duration(days: 3)),
    guestCount: 2,
    status: status,
    kycStatus: kyc,
  );
}

void main() {
  group('refID HDL-YYMMDD-XXXX', () {
    test('format + uniqueness', () {
      final a = Booking.generateReferenceId(DateTime(2026, 9, 6));
      final b = Booking.generateReferenceId(DateTime(2026, 9, 6));
      expect(a, matches(RegExp(r'^HDL-260906-[A-Z2-9]{4}$')));
      expect(a, isNot(equals(b)));
    });
  });

  group('trip validators', () {
    final now = DateTime(2026, 9, 16);
    test('rejects past check-in', () {
      expect(
        Validators.trip(
          checkIn: DateTime(2026, 9, 10),
          checkOut: DateTime(2026, 9, 18),
          guests: 2,
          capacity: 12,
          now: now,
        ),
        contains('past'),
      );
    });
    test('rejects checkout <= checkin', () {
      expect(
        Validators.trip(
          checkIn: DateTime(2026, 9, 18),
          checkOut: DateTime(2026, 9, 18),
          guests: 2,
          capacity: 12,
          now: now,
        ),
        contains('after check-in'),
      );
    });
    test('rejects over capacity + over 12', () {
      expect(
        Validators.trip(
          checkIn: DateTime(2026, 9, 17),
          checkOut: DateTime(2026, 9, 19),
          guests: 5,
          capacity: 4,
          now: now,
        ),
        contains('up to 4'),
      );
      expect(
        Validators.trip(
          checkIn: DateTime(2026, 9, 17),
          checkOut: DateTime(2026, 9, 19),
          guests: 13,
          capacity: 12,
          now: now,
        ),
        contains('Max 12'),
      );
    });
    test('accepts valid trip', () {
      expect(
        Validators.trip(
          checkIn: DateTime(2026, 9, 17),
          checkOut: DateTime(2026, 9, 19),
          guests: 4,
          capacity: 12,
          now: now,
        ),
        isNull,
      );
    });
  });

  group('digital key gate', () {
    test('pending stays locked', () {
      final b = makeBooking(status: 'pending', kyc: 'submitted');
      expect(b.keyEnabled(), isFalse);
      expect(b.keyDisabledReason(), contains('host confirmation'));
    });
    test('confirmed + kyc pending stays locked', () {
      final b = makeBooking(status: 'confirmed', kyc: 'submitted');
      expect(b.keyEnabled(), isFalse);
      expect(b.keyDisabledReason(), contains('verification pending'));
    });
    test('confirmed + approved outside window locked with reason', () {
      final b = makeBooking(
        status: 'confirmed',
        kyc: 'approved',
        checkIn: DateTime(2026, 9, 20),
        checkOut: DateTime(2026, 9, 22),
      );
      // Day before check-in.
      expect(
        b.keyDisabledReason(DateTime(2026, 9, 19, 12)),
        contains('activates'),
      );
      // After grace (checkout 12NN + 1hr = 13:00).
      expect(
        b.keyDisabledReason(DateTime(2026, 9, 22, 14)),
        contains('expired'),
      );
    });
    test('confirmed + approved inside window enabled', () {
      final b = makeBooking(
        status: 'confirmed',
        kyc: 'approved',
        checkIn: DateTime(2026, 9, 20),
        checkOut: DateTime(2026, 9, 22),
      );
      expect(b.keyEnabled(DateTime(2026, 9, 20, 15)), isTrue);
      expect(b.keyEnabled(DateTime(2026, 9, 22, 12, 30)), isTrue); // grace
    });
    test('rejected KYC shows re-upload reason', () {
      final b = makeBooking(status: 'confirmed', kyc: 'rejected');
      expect(b.keyDisabledReason(), contains('re-upload'));
    });
  });
}
