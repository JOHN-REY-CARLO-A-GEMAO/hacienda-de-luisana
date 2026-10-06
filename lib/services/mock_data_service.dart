import '../models/booking_model.dart';
import '../models/smart_lock_event_model.dart';
import '../models/room_model.dart';
import '../models/guest_crm_model.dart';

class MockDataService {
  static List<BookingModel> get initialBookings {
    final now = DateTime.now();

    return [
      BookingModel(
        id: 'bk-001',
        guestName: 'Juan Dela Cruz',
        guestPhone: '0917 892 3421',
        guestEmail: 'juan.delacruz@gmail.com',
        accommodation: 'main-house',
        checkInDate: DateTime(now.year, now.month, now.day, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 2, 12, 0),
        guestCount: 6,
        specialRequests: 'Celebrating 10th wedding anniversary. Requested early villa key check-in.',
        status: BookingStatus.confirmed,
        rawStatus: 'Reserved',
        paymentPlan: 'full',
        paymentStatus: 'verified',
        stayTotal: 32000.0,
        amountDue: 32000.0,
        securityDeposit: 2000.0,
        balanceDue: 0,
        amountVerified: 34000.0,
        totalNights: 2,
        totalAmount: 32000.0,
        createdAt: now.subtract(const Duration(hours: 18)),
        raw: const {'accommodation': 'main-house'},
      ),
      BookingModel(
        id: 'bk-002',
        guestName: 'Maria Clarissa Reyes',
        guestPhone: '0928 554 9912',
        guestEmail: 'maria.reyes@yahoo.com',
        accommodation: 'annex',
        checkInDate: DateTime(now.year, now.month, now.day + 1, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 4, 12, 0),
        guestCount: 4,
        specialRequests: 'Bringing 1 friendly corgi dog. Inquiring about evening bonfire setup.',
        status: BookingStatus.pending,
        rawStatus: 'Pending',
        holdExpiresAt: now.add(const Duration(hours: 23, minutes: 15)),
        totalNights: 3,
        totalAmount: 24000.0,
        createdAt: now.subtract(const Duration(minutes: 45)),
        raw: const {'accommodation': 'main-house'},
      ),
      BookingModel(
        id: 'bk-003',
        guestName: 'Engr. Roberto Mendoza',
        guestPhone: '0919 444 8821',
        guestEmail: 'roberto.mendoza@techcorp.ph',
        accommodation: 'main-house',
        checkInDate: DateTime(now.year, now.month, now.day - 1, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 2, 12, 0),
        guestCount: 8,
        specialRequests: 'Corporate leadership retreat. Team building activity on grounds.',
        status: BookingStatus.checkedIn,
        rawStatus: 'Staying',
        paymentPlan: 'down-payment',
        paymentStatus: 'verified',
        stayTotal: 48000.0,
        amountDue: 24000.0,
        securityDeposit: 2000.0,
        balanceDue: 24000.0,
        amountVerified: 26000.0,
        totalNights: 3,
        totalAmount: 48000.0,
        createdAt: now.subtract(const Duration(days: 3)),
        raw: const {'accommodation': 'main-house'},
      ),
      BookingModel(
        id: 'bk-004',
        guestName: 'JP & Bea Santos',
        guestPhone: '0905 123 7788',
        guestEmail: 'jp.santos@outlook.com',
        accommodation: 'house-a-camping',
        checkInDate: DateTime(now.year, now.month, now.day + 5, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 6, 12, 0),
        guestCount: 2,
        specialRequests: 'Couple weekend quiet escape.',
        status: BookingStatus.pending,
        rawStatus: 'Payment Pending',
        paymentPlan: 'full',
        paymentStatus: 'pending',
        paymentProofUrl: 'https://example.com/demo/gcash-receipt.jpg',
        amountClaimed: 9500.0,
        stayTotal: 8500.0,
        amountDue: 8500.0,
        securityDeposit: 1000.0,
        balanceDue: 0,
        totalNights: 1,
        totalAmount: 8500.0,
        createdAt: now.subtract(const Duration(hours: 3)),
        raw: const {'accommodation': 'house-a-camping'},
      ),
      BookingModel(
        id: 'bk-005',
        guestName: 'Atty. Cristina Gomez',
        guestPhone: '0918 333 9901',
        guestEmail: 'cristina.gomez@lawfirm.ph',
        accommodation: 'annex',
        checkInDate: DateTime(now.year, now.month, now.day - 5, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day - 3, 12, 0),
        guestCount: 3,
        specialRequests: 'Extended weekend getaway. Highly rated stay.',
        status: BookingStatus.completed,
        rawStatus: 'Completed',
        paymentStatus: 'verified',
        totalNights: 2,
        totalAmount: 18000.0,
        createdAt: now.subtract(const Duration(days: 7)),
        raw: const {'accommodation': 'house-a-camping'},
      ),
    ];
  }

  static List<SmartLockEventModel> get initialSmartLockLogs {
    final now = DateTime.now();

    return [
      SmartLockEventModel(
        id: 'lock-001',
        doorName: 'Main House entrance',
        action: LockAction.autoRelock,
        method: LockMethod.autoTimer,
        triggeredBy: 'Juan Dela Cruz',
        cardUid: 'RFID-E2049A1F',
        timestamp: now.subtract(const Duration(minutes: 4)),
        isSuccess: true,
        notes: 'Door auto-relocked securely after 5s safety timeout',
      ),
      SmartLockEventModel(
        id: 'lock-002',
        doorName: 'Main House entrance',
        action: LockAction.unlock,
        method: LockMethod.mobileBle,
        triggeredBy: 'Juan Dela Cruz',
        timestamp: now.subtract(const Duration(minutes: 4, seconds: 6)),
        isSuccess: true,
        notes: 'Mobile Key BLE challenge-response handshake verified',
      ),
      SmartLockEventModel(
        id: 'lock-003',
        doorName: 'Main entrance gate',
        action: LockAction.autoRelock,
        method: LockMethod.autoTimer,
        triggeredBy: 'Maria Reyes',
        cardUid: 'RFID-A8190B22',
        timestamp: now.subtract(const Duration(minutes: 28)),
        isSuccess: true,
        notes: 'Vehicle entry gate secured',
      ),
      SmartLockEventModel(
        id: 'lock-004',
        doorName: 'Main entrance gate',
        action: LockAction.unlock,
        method: LockMethod.rfidKeycard,
        triggeredBy: 'Maria Reyes',
        cardUid: 'RFID-A8190B22',
        timestamp: now.subtract(const Duration(minutes: 28, seconds: 8)),
        isSuccess: true,
        notes: 'RFID Card scanned and authorized',
      ),
      SmartLockEventModel(
        id: 'lock-005',
        doorName: 'Annex entrance',
        action: LockAction.denied,
        method: LockMethod.mobileBle,
        triggeredBy: 'Unknown Device',
        timestamp: now.subtract(const Duration(hours: 1, minutes: 20)),
        isSuccess: false,
        notes: 'Access Denied: Key expired or invalid signature',
      ),
      SmartLockEventModel(
        id: 'lock-006',
        doorName: 'Main House entrance',
        action: LockAction.masterOverride,
        method: LockMethod.physicalKey,
        triggeredBy: 'Admin (master key)',
        timestamp: now.subtract(const Duration(hours: 2, minutes: 15)),
        isSuccess: true,
        notes: 'Master physical bypass / morning grounds inspection',
      ),
    ];
  }

  /// Operational status for the three canonical Accommodations, used only in
  /// demo mode where no `rooms` documents have been written yet.
  ///
  /// A status and nothing else. The names, capacities and rates this list used
  /// to carry — "Villa LuisAna (Main Heritage House)", "Casita Del Rio (Garden
  /// Suite)", "Poolside Casita B" and per-night prices of ₱16,000, ₱8,500,
  /// ₱6,000 and ₱7,500 — were not Accommodations. None of the four appeared on
  /// the website, in the published rates, or in any Booking, and the prices
  /// contradicted the published ₱5,000/₱6,000 and ₱1,000 figures. Names come from
  /// the published rates document; see `Accommodation.fromRatesDocument`.
  static List<RoomModel> get initialRooms {
    return const [
      RoomModel(id: 'status-main-house', accommodationId: 'main-house', status: RoomStatus.occupied),
      RoomModel(id: 'status-annex', accommodationId: 'annex', status: RoomStatus.available),
      RoomModel(id: 'status-house-a', accommodationId: 'house-a-camping', status: RoomStatus.available),
    ];
  }

  static List<GuestCrmModel> get initialGuestProfiles {
    final now = DateTime.now();

    return [
      GuestCrmModel(
        id: 'crm-001',
        name: 'Juan Dela Cruz',
        phone: '0917 892 3421',
        email: 'juan.delacruz@gmail.com',
        totalBookings: 3,
        lifetimeRevenue: 78000.0,
        isVip: true,
        notes: 'Prefers an early check-in. Highly cooperative with RFID lock guidelines.',
        lastStayDate: now.subtract(const Duration(days: 30)),
      ),
      GuestCrmModel(
        id: 'crm-002',
        name: 'Maria Clarissa Reyes',
        phone: '0928 554 9912',
        email: 'maria.reyes@yahoo.com',
        totalBookings: 2,
        lifetimeRevenue: 42000.0,
        isVip: false,
        notes: 'Always travels with family pets. Loves the bonfire area.',
        lastStayDate: now.subtract(const Duration(days: 60)),
      ),
      GuestCrmModel(
        id: 'crm-003',
        name: 'Engr. Roberto Mendoza',
        phone: '0919 444 8821',
        email: 'roberto.mendoza@techcorp.ph',
        totalBookings: 4,
        lifetimeRevenue: 135000.0,
        isVip: true,
        notes: 'Corporate client. Books full property retreats for tech staff every quarter.',
        lastStayDate: now.subtract(const Duration(days: 90)),
      ),
    ];
  }
}
