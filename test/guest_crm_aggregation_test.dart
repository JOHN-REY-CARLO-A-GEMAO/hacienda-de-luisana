import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/models/guest_crm_model.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';
import 'package:hacienda_de_luisana/services/guest_crm_aggregation.dart';

BookingModel booking({
  required String id,
  required String uid,
  required String name,
  required String email,
  required String status,
  required double amount,
  required DateTime createdAt,
}) =>
    BookingModel(
      id: id,
      uid: uid,
      guestName: name,
      guestPhone: '09170000000',
      guestEmail: email,
      accommodation: 'main-house',
      checkInDate: createdAt,
      checkOutDate: createdAt.add(const Duration(days: 1)),
      guestCount: 2,
      status: BookingStatusX.fromString(status),
      rawStatus: status,
      totalNights: 1,
      totalAmount: amount,
      createdAt: createdAt,
    );

void main() {
  group('guest records from booking history', () {
    test('a booking creates a directory entry even without a profile document', () {
      final guests = aggregateGuestRecords(
        profiles: const [],
        bookings: [
          booking(
            id: 'bk-1',
            uid: 'guest-1',
            name: 'Alex Guest',
            email: 'alex@example.com',
            status: BookingStatuses.reserved,
            amount: 2500,
            createdAt: DateTime(2026, 10, 1),
          ),
        ],
      );

      expect(guests, hasLength(1));
      expect(guests.single.id, 'guest-1');
      expect(guests.single.name, 'Alex Guest');
      expect(guests.single.totalBookings, 1);
      expect(guests.single.lifetimeRevenue, 2500);
    });

    test('multiple bookings merge with saved VIP and private-note fields', () {
      final profile = GuestCrmModel(
        id: 'guest-1',
        name: 'Saved Name',
        phone: '09170000000',
        email: 'alex@example.com',
        totalBookings: 99,
        lifetimeRevenue: 1,
        isVip: true,
        notes: 'Prefers the main house',
      );
      final guests = aggregateGuestRecords(
        profiles: [profile],
        bookings: [
          booking(
            id: 'bk-1',
            uid: 'guest-1',
            name: 'Alex Guest',
            email: 'alex@example.com',
            status: BookingStatuses.completed,
            amount: 2500,
            createdAt: DateTime(2026, 10, 1),
          ),
          booking(
            id: 'bk-2',
            uid: 'guest-1',
            name: 'Alex Guest',
            email: 'alex@example.com',
            status: BookingStatuses.pending,
            amount: 5000,
            createdAt: DateTime(2026, 10, 10),
          ),
        ],
      );

      expect(guests, hasLength(1));
      expect(guests.single.name, 'Saved Name');
      expect(guests.single.totalBookings, 2);
      expect(guests.single.lifetimeRevenue, 2500);
      expect(guests.single.isVip, isTrue);
      expect(guests.single.notes, 'Prefers the main house');
      expect(guests.single.lastStayDate, DateTime(2026, 10, 2));
    });

    test('profile-only records remain available', () {
      final profile = GuestCrmModel(
        id: 'guest-2',
        name: 'No booking yet',
        phone: '',
        email: '',
        totalBookings: 0,
        lifetimeRevenue: 0,
        isVip: false,
        notes: '',
      );
      expect(aggregateGuestRecords(profiles: [profile], bookings: []), [profile]);
    });
  });
}
