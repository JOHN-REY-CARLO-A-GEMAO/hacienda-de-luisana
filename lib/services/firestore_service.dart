import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import '../models/booking_model.dart';
import '../models/guest_location_model.dart';
import '../models/smart_lock_event_model.dart';
import '../models/room_model.dart';
import '../models/guest_crm_model.dart';
import '../constants/app_constants.dart';
import 'mock_data_service.dart';

class FirestoreService {
  final FirebaseFirestore? _firestore;
  bool _isFirebaseReady = false;

  // In-memory fallback stream controllers
  final _bookingsController = StreamController<List<BookingModel>>.broadcast();
  final _trackingController = StreamController<List<GuestLocationModel>>.broadcast();
  final _lockLogsController = StreamController<List<SmartLockEventModel>>.broadcast();
  final _roomsController = StreamController<List<RoomModel>>.broadcast();
  final _crmController = StreamController<List<GuestCrmModel>>.broadcast();

  // In-memory state buffers
  List<BookingModel> _bookings = [];
  List<GuestLocationModel> _trackingSessions = [];
  List<SmartLockEventModel> _lockLogs = [];
  List<RoomModel> _rooms = [];
  List<GuestCrmModel> _crmProfiles = [];

  FirestoreService([FirebaseFirestore? firestore])
      : _firestore = firestore {
    _initialize();
  }

  void _initialize() {
    _bookings = MockDataService.initialBookings;
    _trackingSessions = MockDataService.initialLocations;
    _lockLogs = MockDataService.initialSmartLockLogs;
    _rooms = MockDataService.initialRooms;
    _crmProfiles = MockDataService.initialGuestProfiles;

    try {
      if (Firebase.apps.isNotEmpty) {
        _isFirebaseReady = true;
      }
    } catch (_) {
      _isFirebaseReady = false;
    }

    _emitAllLocal();
  }

  void _emitAllLocal() {
    _bookingsController.add(List.unmodifiable(_bookings));
    _trackingController.add(List.unmodifiable(_trackingSessions));
    _lockLogsController.add(List.unmodifiable(_lockLogs));
    _roomsController.add(List.unmodifiable(_rooms));
    _crmController.add(List.unmodifiable(_crmProfiles));
  }

  // ---- STREAMS ----

  Stream<List<BookingModel>> streamBookings() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _firestore!
            .collection(AppConstants.colBookings)
            .orderBy('createdAt', descending: true)
            .snapshots()
            .map((snap) {
          if (snap.docs.isEmpty) return _bookings;
          return snap.docs
              .map((doc) => BookingModel.fromJson(doc.data(), doc.id))
              .toList();
        }).handleError((_) => _bookings);
      } catch (_) {}
    }
    return _bookingsController.stream;
  }

  Stream<List<GuestLocationModel>> streamTrackingSessions() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _firestore!
            .collection(AppConstants.colTrackingSessions)
            .snapshots()
            .map((snap) {
          if (snap.docs.isEmpty) return _trackingSessions;
          return snap.docs
              .map((doc) => GuestLocationModel.fromJson(doc.data(), doc.id))
              .toList();
        }).handleError((_) => _trackingSessions);
      } catch (_) {}
    }
    return _trackingController.stream;
  }

  Stream<List<SmartLockEventModel>> streamSmartLockLogs() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _firestore!
            .collection(AppConstants.colSmartLockLogs)
            .orderBy('timestamp', descending: true)
            .snapshots()
            .map((snap) {
          if (snap.docs.isEmpty) return _lockLogs;
          return snap.docs
              .map((doc) => SmartLockEventModel.fromJson(doc.data(), doc.id))
              .toList();
        }).handleError((_) => _lockLogs);
      } catch (_) {}
    }
    return _lockLogsController.stream;
  }

  Stream<List<RoomModel>> streamRooms() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _firestore!
            .collection(AppConstants.colRooms)
            .snapshots()
            .map((snap) {
          if (snap.docs.isEmpty) return _rooms;
          return snap.docs
              .map((doc) => RoomModel.fromJson(doc.data(), doc.id))
              .toList();
        }).handleError((_) => _rooms);
      } catch (_) {}
    }
    return _roomsController.stream;
  }

  Stream<List<GuestCrmModel>> streamGuestProfiles() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _firestore!
            .collection(AppConstants.colGuestProfiles)
            .snapshots()
            .map((snap) {
          if (snap.docs.isEmpty) return _crmProfiles;
          return snap.docs
              .map((doc) => GuestCrmModel.fromJson(doc.data(), doc.id))
              .toList();
        }).handleError((_) => _crmProfiles);
      } catch (_) {}
    }
    return _crmController.stream;
  }

  // ---- MUTATION METHODS ----

  Future<void> updateBookingStatus(String bookingId, BookingStatus newStatus) async {
    final index = _bookings.indexWhere((b) => b.id == bookingId);
    if (index != -1) {
      _bookings[index] = _bookings[index].copyWith(status: newStatus);
      _bookingsController.add(List.unmodifiable(_bookings));
    }

    if (_isFirebaseReady && _firestore != null) {
      try {
        await _firestore!
            .collection(AppConstants.colBookings)
            .doc(bookingId)
            .update({'status': newStatus.name});
      } catch (_) {}
    }
  }

  Future<void> updateGuestLocation({
    required String bookingId,
    required double latitude,
    required double longitude,
    required String area,
    required double distanceKm,
    required int etaMinutes,
  }) async {
    final index = _trackingSessions.indexWhere((s) => s.bookingId == bookingId);
    final isNear = distanceKm <= AppConstants.nearbyThresholdKm;
    final hasArr = distanceKm <= AppConstants.arrivedThresholdKm;

    if (index != -1) {
      _trackingSessions[index] = _trackingSessions[index].copyWith(
        latitude: latitude,
        longitude: longitude,
        currentArea: area,
        distanceRemainingKm: distanceKm,
        estimatedMinutesRemaining: etaMinutes,
        isNearResort: isNear,
        hasArrived: hasArr,
        lastUpdated: DateTime.now(),
      );
    } else {
      _trackingSessions.insert(
        0,
        GuestLocationModel(
          sessionId: 'sess-${DateTime.now().millisecondsSinceEpoch}',
          bookingId: bookingId,
          guestName: 'Guest $bookingId',
          latitude: latitude,
          longitude: longitude,
          currentArea: area,
          distanceRemainingKm: distanceKm,
          estimatedMinutesRemaining: etaMinutes,
          isNearResort: isNear,
          hasArrived: hasArr,
          lastUpdated: DateTime.now(),
        ),
      );
    }
    _trackingController.add(List.unmodifiable(_trackingSessions));

    if (_isFirebaseReady && _firestore != null) {
      try {
        await _firestore!
            .collection(AppConstants.colTrackingSessions)
            .doc(bookingId)
            .set({
          'bookingId': bookingId,
          'latitude': latitude,
          'longitude': longitude,
          'currentArea': area,
          'distanceRemainingKm': distanceKm,
          'estimatedMinutesRemaining': etaMinutes,
          'isNearResort': isNear,
          'hasArrived': hasArr,
          'lastUpdated': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      } catch (_) {}
    }
  }

  Future<void> recordSmartLockEvent(SmartLockEventModel event) async {
    _lockLogs.insert(0, event);
    _lockLogsController.add(List.unmodifiable(_lockLogs));

    if (_isFirebaseReady && _firestore != null) {
      try {
        await _firestore!
            .collection(AppConstants.colSmartLockLogs)
            .add(event.toJson());
      } catch (_) {}
    }
  }

  Future<void> updateRoomStatus(String roomId, RoomStatus status, [double? newPrice]) async {
    final index = _rooms.indexWhere((r) => r.id == roomId);
    if (index != -1) {
      _rooms[index] = _rooms[index].copyWith(
        status: status,
        pricePerNight: newPrice ?? _rooms[index].pricePerNight,
      );
      _roomsController.add(List.unmodifiable(_rooms));
    }

    if (_isFirebaseReady && _firestore != null) {
      try {
        final Map<String, dynamic> data = {'status': status.name};
        if (newPrice != null) data['pricePerNight'] = newPrice;
        await _firestore!.collection(AppConstants.colRooms).doc(roomId).update(data);
      } catch (_) {}
    }
  }

  void dispose() {
    _bookingsController.close();
    _trackingController.close();
    _lockLogsController.close();
    _roomsController.close();
    _crmController.close();
  }
}
