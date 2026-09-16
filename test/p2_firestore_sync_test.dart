import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking.dart';

Booking localBooking({
  String status = 'pending',
  String title = 'Main House Villa',
  DateTime? checkIn,
  DateTime? checkOut,
  DateTime? createdAt,
  String? uid,
}) {
  final now = DateTime.now();
  return Booking(
    referenceId: 'HDL-260916-ABCD',
    guestName: 'Juan Dela Cruz',
    phone: '+639171234567',
    email: 'juan@test.com',
    accommodationTitle: title,
    checkInDate: checkIn ?? DateTime(2026, 9, 20),
    checkOutDate: checkOut ?? DateTime(2026, 9, 22),
    guestCount: 2,
    notes: 'Near pool please',
    status: status,
    kycStatus: 'required',
    uid: uid ?? 'anon-123',
    createdAt: createdAt ?? now,
  );
}

void main() {
  group('toCloudMap web shape (zero admin changes)', () {
    test('has web keys + capitalized status + slug + source', () {
      final b = localBooking();
      final m = b.toCloudMap();
      for (final k in [
        'ref_id',
        'guest_name',
        'phone',
        'email',
        'check_in',
        'check_out',
        'guests',
        'accommodation',
        'special_requests',
        'status',
        'created_at'
      ]) {
        expect(m.containsKey(k), isTrue, reason: 'missing $k');
      }
      expect(m['status'], 'Pending');
      expect(m['accommodation'], 'main-house');
      expect(m['check_in'], '2026-09-20');
      expect(m['source'], 'flutter_app');
      expect(m['uid'], 'anon-123');
      expect(m['kyc_status'], 'required');
    });

    test('checked_in folds to Confirmed for admin pill', () {
      final b = localBooking(status: 'checked_in');
      expect(b.toCloudMap()['status'], 'Confirmed');
      expect(localBooking(status: 'cancelled').toCloudMap()['status'],
          'Cancelled');
    });

    test('slug mapping for camping units', () {
      expect(
          localBooking(title: 'Camping A - Forest Deck').accommodationId,
          'camping-a');
      expect(localBooking(title: 'Camping B - Riverside').accommodationId,
          'camping-b');
    });
  });

  group('fromCloud parses web docs', () {
    test('capitalized web doc -> lowercase in-app', () {
      final b = Booking.fromCloud('doc1', {
        'ref_id': 'HDL-260906-K4TQ',
        'guest_name': 'Maria',
        'phone': '0917',
        'email': 'm@test.com',
        'check_in': '2026-09-12',
        'check_out': '2026-09-14',
        'guests': 4,
        'accommodation': 'main-house',
        'special_requests': 'x',
        'status': 'Pending',
        'kyc_status': 'required',
        'uid': 'anon-xyz',
        'source': 'flutter_app',
        'created_at': '2026-09-10T10:00:00.000',
      });
      expect(b.status, 'pending');
      expect(b.referenceId, 'HDL-260906-K4TQ');
      expect(b.accommodationTitle, 'Main House Villa');
      expect(b.checkInDate, DateTime(2026, 9, 12));
      expect(b.uid, 'anon-xyz');
      expect(b.firestoreId, 'doc1');
      expect(b.synced, isTrue);
    });
  });

  group('overlap half-open (checkout day free)', () {
    test('adjacent stays do not overlap', () {
      expect(
          Booking.datesOverlap(DateTime(2026, 9, 20), DateTime(2026, 9, 22),
              DateTime(2026, 9, 22), DateTime(2026, 9, 24)),
          isFalse);
    });
    test('one-night overlap detected', () {
      expect(
          Booking.datesOverlap(DateTime(2026, 9, 20), DateTime(2026, 9, 22),
              DateTime(2026, 9, 21), DateTime(2026, 9, 23)),
          isTrue);
    });
    test('blocksRange ignores cancelled/completed/other stay', () {
      final cancelled =
          localBooking(status: 'cancelled', checkIn: DateTime(2026, 9, 20), checkOut: DateTime(2026, 9, 25));
      expect(cancelled.blocksRange(DateTime(2026, 9, 21), DateTime(2026, 9, 22),
          sameStay: 'main-house'), isFalse);
      final otherStay =
          localBooking(checkIn: DateTime(2026, 9, 20), checkOut: DateTime(2026, 9, 25));
      expect(otherStay.blocksRange(DateTime(2026, 9, 21), DateTime(2026, 9, 22),
          sameStay: 'camping-a'), isFalse);
      final active =
          localBooking(checkIn: DateTime(2026, 9, 20), checkOut: DateTime(2026, 9, 25));
      expect(active.blocksRange(DateTime(2026, 9, 21), DateTime(2026, 9, 22),
          sameStay: 'main-house'), isTrue);
    });
  });

  group('lazy EXPIRED (24h, local-only)', () {
    test('old pending reads expired + inactive + releases dates', () {
      final old = localBooking(
        createdAt: DateTime.now().subtract(const Duration(hours: 25)),
      );
      expect(old.isExpiredLocal, isTrue);
      expect(old.effectiveStatus, 'expired');
      expect(old.statusLabel, 'Expired');
      expect(old.isActive, isFalse);
      expect(
          old.blocksRange(DateTime.now().add(const Duration(days: 1)),
              DateTime.now().add(const Duration(days: 2)),
              sameStay: 'main-house'),
          isFalse);
    });
    test('fresh pending stays active', () {
      final fresh = localBooking(createdAt: DateTime.now());
      expect(fresh.isExpiredLocal, isFalse);
      expect(fresh.isActive, isTrue);
    });
  });
}
