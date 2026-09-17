import '../models/booking_model.dart';
import '../models/guest_location_model.dart';
import '../models/smart_lock_event_model.dart';
import '../models/room_model.dart';
import '../models/guest_crm_model.dart';
import '../constants/app_constants.dart';

class MockDataService {
  static List<BookingModel> get initialBookings {
    final now = DateTime.now();

    return [
      BookingModel(
        id: 'bk-001',
        guestName: 'Juan Dela Cruz',
        guestPhone: '0917 892 3421',
        guestEmail: 'juan.delacruz@gmail.com',
        accommodation: 'Villa LuisAna (Main House)',
        checkInDate: DateTime(now.year, now.month, now.day, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 2, 12, 0),
        guestCount: 6,
        specialRequests: 'Celebrating 10th wedding anniversary. Requested early villa key check-in.',
        status: BookingStatus.confirmed,
        totalNights: 2,
        totalAmount: 32000.0,
        createdAt: now.subtract(const Duration(hours: 18)),
        trackingSessionId: 'sess-001',
      ),
      BookingModel(
        id: 'bk-002',
        guestName: 'Maria Clarissa Reyes',
        guestPhone: '0928 554 9912',
        guestEmail: 'maria.reyes@yahoo.com',
        accommodation: 'Casita Del Rio (Garden Suite)',
        checkInDate: DateTime(now.year, now.month, now.day + 1, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 4, 12, 0),
        guestCount: 4,
        specialRequests: 'Bringing 1 friendly corgi dog. Inquiring about evening bonfire setup.',
        status: BookingStatus.pending,
        totalNights: 3,
        totalAmount: 24000.0,
        createdAt: now.subtract(const Duration(minutes: 45)),
        trackingSessionId: 'sess-002',
      ),
      BookingModel(
        id: 'bk-003',
        guestName: 'Engr. Roberto Mendoza',
        guestPhone: '0919 444 8821',
        guestEmail: 'roberto.mendoza@techcorp.ph',
        accommodation: 'Villa LuisAna (Main House)',
        checkInDate: DateTime(now.year, now.month, now.day - 1, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 2, 12, 0),
        guestCount: 8,
        specialRequests: 'Corporate leadership retreat. Team building activity on grounds.',
        status: BookingStatus.checkedIn,
        totalNights: 3,
        totalAmount: 48000.0,
        createdAt: now.subtract(const Duration(days: 3)),
        trackingSessionId: 'sess-003',
      ),
      BookingModel(
        id: 'bk-004',
        guestName: 'JP & Bea Santos',
        guestPhone: '0905 123 7788',
        guestEmail: 'jp.santos@outlook.com',
        accommodation: 'House A Glamping & Camping',
        checkInDate: DateTime(now.year, now.month, now.day + 5, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day + 6, 12, 0),
        guestCount: 2,
        specialRequests: 'Couple weekend quiet escape.',
        status: BookingStatus.pending,
        totalNights: 1,
        totalAmount: 8500.0,
        createdAt: now.subtract(const Duration(hours: 3)),
      ),
      BookingModel(
        id: 'bk-005',
        guestName: 'Atty. Cristina Gomez',
        guestPhone: '0918 333 9901',
        guestEmail: 'cristina.gomez@lawfirm.ph',
        accommodation: 'Casita A (Garden Suite)',
        checkInDate: DateTime(now.year, now.month, now.day - 5, 14, 0),
        checkOutDate: DateTime(now.year, now.month, now.day - 3, 12, 0),
        guestCount: 3,
        specialRequests: 'Extended weekend getaway. Highly rated stay.',
        status: BookingStatus.completed,
        totalNights: 2,
        totalAmount: 18000.0,
        createdAt: now.subtract(const Duration(days: 7)),
      ),
    ];
  }

  static List<GuestLocationModel> get initialLocations {
    final now = DateTime.now();

    return [
      GuestLocationModel(
        sessionId: 'sess-001',
        bookingId: 'bk-001',
        guestName: 'Juan Dela Cruz',
        latitude: 14.1850,
        longitude: 121.5150,
        currentArea: 'Luisiana Town Proper (Approaching)',
        distanceRemainingKm: 2.4,
        estimatedMinutesRemaining: 6,
        isNearResort: true,
        hasArrived: false,
        lastUpdated: now.subtract(const Duration(minutes: 2)),
      ),
      GuestLocationModel(
        sessionId: 'sess-002',
        bookingId: 'bk-002',
        guestName: 'Maria Clarissa Reyes',
        latitude: 14.2150,
        longitude: 121.5050,
        currentArea: 'Cavinti - Luisiana Road',
        distanceRemainingKm: 8.2,
        estimatedMinutesRemaining: 16,
        isNearResort: false,
        hasArrived: false,
        lastUpdated: now.subtract(const Duration(minutes: 12)),
      ),
    ];
  }

  static List<SmartLockEventModel> get initialSmartLockLogs {
    final now = DateTime.now();

    return [
      SmartLockEventModel(
        id: 'lock-001',
        doorName: 'Villa LuisAna Front Door',
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
        doorName: 'Villa LuisAna Front Door',
        action: LockAction.unlock,
        method: LockMethod.mobileBle,
        triggeredBy: 'Juan Dela Cruz',
        timestamp: now.subtract(const Duration(minutes: 4, seconds: 6)),
        isSuccess: true,
        notes: 'Mobile Key BLE challenge-response handshake verified',
      ),
      SmartLockEventModel(
        id: 'lock-003',
        doorName: 'Resort Main Entrance Gate',
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
        doorName: 'Resort Main Entrance Gate',
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
        doorName: 'Casita Suite Entrance',
        action: LockAction.denied,
        method: LockMethod.mobileBle,
        triggeredBy: 'Unknown Device',
        timestamp: now.subtract(const Duration(hours: 1, minutes: 20)),
        isSuccess: false,
        notes: 'Access Denied: Key expired or invalid signature',
      ),
      SmartLockEventModel(
        id: 'lock-006',
        doorName: 'Villa LuisAna Front Door',
        action: LockAction.masterOverride,
        method: LockMethod.physicalKey,
        triggeredBy: 'Property Caretaker (Host)',
        timestamp: now.subtract(const Duration(hours: 2, minutes: 15)),
        isSuccess: true,
        notes: 'Master physical bypass / Morning villa routine inspection',
      ),
    ];
  }

  static List<RoomModel> get initialRooms {
    return [
      RoomModel(
        id: 'room-01',
        name: 'Villa LuisAna (Main Heritage House)',
        capacity: 10,
        pricePerNight: 16000.0,
        status: RoomStatus.occupied,
        imageUrl: 'assets/images/gmaps/img-01.jpg',
        amenities: ['Master Suite', 'Private Veranda', 'Full Kitchen', 'High-speed WiFi', 'Smart Lock'],
      ),
      RoomModel(
        id: 'room-02',
        name: 'Casita Del Rio (Garden Suite)',
        capacity: 4,
        pricePerNight: 8500.0,
        status: RoomStatus.available,
        imageUrl: 'assets/images/gmaps/img-02.jpg',
        amenities: ['Queen Bed', 'Private Bath', 'Coffee Bar', 'Garden View', 'Smart Lock'],
      ),
      RoomModel(
        id: 'room-03',
        name: 'House A Glamping & Camping Camp',
        capacity: 4,
        pricePerNight: 6000.0,
        status: RoomStatus.available,
        imageUrl: 'assets/images/gmaps/img-03.jpg',
        amenities: ['Outdoor Bonfire', 'Glamping Tents', 'Grill Pit', 'Stargazing Lawn'],
      ),
      RoomModel(
        id: 'room-04',
        name: 'Poolside Casita B',
        capacity: 2,
        pricePerNight: 7500.0,
        status: RoomStatus.maintenance,
        imageUrl: 'assets/images/gmaps/img-04.jpg',
        amenities: ['Direct Pool Deck Access', 'Rain Shower', 'Mini Bar'],
      ),
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
        notes: 'Prefers early check-in and fresh mountain view rooms. Highly cooperative with RFID lock guidelines.',
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
