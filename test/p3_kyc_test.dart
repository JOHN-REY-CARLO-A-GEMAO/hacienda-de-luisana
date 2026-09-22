import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking.dart';
import 'package:hacienda_de_luisana/services/kyc_storage.dart';

Booking kycBooking({
  String status = 'confirmed',
  String kyc = 'approved',
  String? reason,
  DateTime? checkIn,
  DateTime? checkOut,
  DateTime? now,
}) {
  final n = now ?? DateTime.now();
  return Booking(
    referenceId: 'HDL-260916-T3ST',
    guestName: 'KYC Guest',
    phone: '+639171234567',
    email: 'kyc@test.com',
    accommodationTitle: 'Main House Villa',
    checkInDate: checkIn ?? DateTime(n.year, n.month, n.day),
    checkOutDate:
        checkOut ?? DateTime(n.year, n.month, n.day).add(const Duration(days: 2)),
    guestCount: 2,
    status: status,
    kycStatus: kyc,
    kycRejectReason: reason,
    createdAt: n,
  );
}

void main() {
  group('reject keeps confirmed blocked', () {
    test('confirmed + rejected => key disabled with re-upload reason', () {
      final b = kycBooking(status: 'confirmed', kyc: 'rejected');
      expect(b.keyEnabled(), isFalse);
      expect(b.keyDisabledReason(), contains('re-upload'));
    });

    test('checked_in + rejected stays blocked too', () {
      final b = kycBooking(status: 'checked_in', kyc: 'rejected');
      expect(b.keyEnabled(), isFalse);
    });
  });

  group('resubmit loop', () {
    test('rejected -> submitted clears reason, stays pending-locked', () {
      final b = kycBooking(
          status: 'pending', kyc: 'rejected', reason: 'Blurry ID');
      expect(b.statusLabel, 'ID Rejected');
      b.applyKycSubmitted(
          idUrl: 'https://example.com/id.jpg',
          receiptUrl: 'https://example.com/rc.jpg');
      expect(b.kycStatus, 'submitted');
      expect(b.kycRejectReason, isNull);
      expect(b.status, 'pending'); // status stays pending
      expect(b.keyEnabled(), isFalse); // still locked (not confirmed)
      expect(b.keyDisabledReason(), contains('host confirmation'));
    });

    test('approved + confirmed + in-window => enabled', () {
      final n = DateTime.now();
      final b = kycBooking(
        status: 'confirmed',
        kyc: 'approved',
        checkIn: DateTime(n.year, n.month, n.day),
        checkOut:
            DateTime(n.year, n.month, n.day).add(const Duration(days: 2)),
        now: n,
      );
      // Mid-window: after 2PM check-in day.
      final probe = DateTime(n.year, n.month, n.day, 15);
      expect(b.keyEnabled(probe), isTrue);
    });

    test('applyKycApproved clears reason', () {
      final b = kycBooking(status: 'pending', kyc: 'submitted');
      b.applyKycRejected('Name mismatch');
      expect(b.kycStatus, 'rejected');
      b.applyKycApproved();
      expect(b.kycStatus, 'approved');
      expect(b.kycRejectReason, isNull);
    });
  });

  group('cloud kyc urls roundtrip', () {
    test('toCloudMap carries urls + reason; fromCloud restores', () {
      final b = kycBooking(status: 'pending', kyc: 'submitted')
        ..kycIdUrl = 'https://cdn.test/id.jpg'
        ..kycReceiptUrl = 'https://cdn.test/rc.jpg'
        ..kycRejectReason = null
        ..uid = 'anon-1';
      final m = b.toCloudMap();
      expect(m['kyc_id_url'], 'https://cdn.test/id.jpg');
      expect(m['kyc_receipt_url'], 'https://cdn.test/rc.jpg');
      final back = Booking.fromCloud('doc9', {
        ...m,
        'created_at': '2026-09-16T10:00:00.000',
      });
      expect(back.kycIdUrl, 'https://cdn.test/id.jpg');
      expect(back.kycReceiptUrl, 'https://cdn.test/rc.jpg');
      expect(back.kycStatus, 'submitted');
    });
  });

  group('guest allowlist never includes reject reason', () {
    test('kyc_reject_reason is admin-only', () {
      expect(Booking.guestUpdatableKeys, contains('kyc_id_url'));
      expect(Booking.guestUpdatableKeys, contains('kyc_receipt_url'));
      expect(Booking.guestUpdatableKeys, contains('kyc_status'));
      expect(Booking.guestUpdatableKeys, isNot(contains('kyc_reject_reason')));
    });

    test('live location no longer rides on the booking doc (G6)', () {
      // The ETA link and the pickup family moved to tracking_sessions;
      // firestore.rules refuses them on the guest's self-serve update.
      expect(Booking.guestUpdatableKeys, isNot(contains('eta_share_url')));
      expect(Booking.guestUpdatableKeys, isNot(contains('pickup_lat')));
      expect(Booking.guestUpdatableKeys, isNot(contains('pickup_lng')));
      expect(Booking.guestUpdatableKeys, isNot(contains('pickup_updated_at')));
      expect(Booking.guestUpdatableKeys, isNot(contains('pickup_label')));
    });
  });

  group('KycStorage.objectPath', () {
    test('nests uid/ref/kind with safe names', () {
      final p = KycStorage.objectPath(
        uid: 'anon-123',
        bookingRefId: 'HDL-260916-ABCD',
        kind: 'id',
        filename: 'my id.PNG',
      );
      expect(p, 'kyc/anon-123/HDL-260916-ABCD/id.png');
    });
  });
}
