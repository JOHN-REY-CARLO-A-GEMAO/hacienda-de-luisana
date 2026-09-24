import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import '../models/booking_model.dart';
import '../models/guest_location_model.dart';
import '../models/smart_lock_event_model.dart';
import '../models/room_model.dart';
import '../models/guest_crm_model.dart';
import '../core/constants/app_constants.dart';
import 'booking_lifecycle.dart';
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
  final _ratesController =
      StreamController<Map<String, dynamic>?>.broadcast();
  final _activityControllers =
      <String, StreamController<List<Map<String, dynamic>>>>{};

  // In-memory state buffers
  List<BookingModel> _bookings = [];
  List<GuestLocationModel> _trackingSessions = [];
  List<SmartLockEventModel> _lockLogs = [];
  List<RoomModel> _rooms = [];
  List<GuestCrmModel> _crmProfiles = [];
  /// The latest Bookings seen (cloud or local): what Approve checks dates
  /// against, and what the in-memory fallback mutates.
  List<BookingModel> _latestBookings = [];
  Map<String, dynamic>? _rates;
  final Map<String, List<Map<String, dynamic>>> _localActivity = {};

  bool get isCloud => _isFirebaseReady && _firestore != null;

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
    _latestBookings = _bookings;

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

  /// Replays the current in-memory snapshot to every new subscriber, then
  /// forwards live updates. Broadcast controllers drop events emitted before
  /// a listener attaches, so without this the UI would hang on loading forever.
  Stream<List<T>> _withInitial<T>(
      List<T> current, StreamController<List<T>> controller) {
    return Stream<List<T>>.multi((mc) {
      mc.add(List<T>.unmodifiable(current));
      final sub = controller.stream.listen(
        mc.add,
        onError: mc.addError,
        onDone: mc.close,
      );
      mc.onCancel = sub.cancel;
    });
  }

  /// Converts a Firestore snapshots stream into one that NEVER errors out:
  /// permission-denied / offline / parse failures fall back to local data
  /// so tabs render instantly instead of spinning forever.
  Stream<List<T>> _cloudOrLocal<T>(
    Stream<List<T>> cloud,
    List<T> local,
  ) {
    return cloud.transform(
      StreamTransformer<List<T>, List<T>>.fromHandlers(
        handleData: (data, sink) => sink.add(data),
        handleError: (_, __, sink) =>
            sink.add(List<T>.unmodifiable(local)),
      ),
    );
  }

  // ---- STREAMS ----

  Stream<List<BookingModel>> streamBookings() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _cloudOrLocal(
          _firestore!
              .collection(AppConstants.colBookings)
              // Website docs carry created_at (snake_case, serverTimestamp).
              // Ordering by the app's old createdAt excluded every web doc.
              .orderBy('created_at', descending: true)
              .snapshots()
              .map((snap) {
            if (snap.docs.isEmpty) return _bookings;
            try {
              final parsed = snap.docs
                  .map((doc) => BookingModel.fromJson(doc.data(), doc.id))
                  .toList();
              _latestBookings = parsed;
              return parsed;
            } catch (_) {
              return _bookings;
            }
          }),
          _bookings,
        );
      } catch (_) {}
    }
    return _withInitial(_bookings, _bookingsController);
  }

  Stream<List<GuestLocationModel>> streamTrackingSessions() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _cloudOrLocal(
          _firestore!
              .collection(AppConstants.colTrackingSessions)
              .snapshots()
              .map((snap) {
            if (snap.docs.isEmpty) return _trackingSessions;
            try {
              return snap.docs
                  .map((doc) => GuestLocationModel.fromJson(doc.data(), doc.id))
                  .toList();
            } catch (_) {
              return _trackingSessions;
            }
          }),
          _trackingSessions,
        );
      } catch (_) {}
    }
    return _withInitial(_trackingSessions, _trackingController);
  }

  /// Reads the `access_logs` collection every lock touch is written to.
  /// Field mapping lives in SmartLockEventModel.fromJson, which accepts both
  /// the website's and the app's shapes.
  Stream<List<SmartLockEventModel>> streamSmartLockLogs() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _cloudOrLocal(
          _firestore!
              .collection(AppConstants.colSmartLockLogs)
              .orderBy('created_at', descending: true)
              .snapshots()
              .map((snap) {
            if (snap.docs.isEmpty) return _lockLogs;
            try {
              return snap.docs
                  .map((doc) => SmartLockEventModel.fromJson(doc.data(), doc.id))
                  .toList();
            } catch (_) {
              return _lockLogs;
            }
          }),
          _lockLogs,
        );
      } catch (_) {}
    }
    return _withInitial(_lockLogs, _lockLogsController);
  }

  Stream<List<RoomModel>> streamRooms() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _cloudOrLocal(
          _firestore!
              .collection(AppConstants.colRooms)
              .snapshots()
              .map((snap) {
            if (snap.docs.isEmpty) return _rooms;
            try {
              return snap.docs
                  .map((doc) => RoomModel.fromJson(doc.data(), doc.id))
                  .toList();
            } catch (_) {
              return _rooms;
            }
          }),
          _rooms,
        );
      } catch (_) {}
    }
    return _withInitial(_rooms, _roomsController);
  }

  Stream<List<GuestCrmModel>> streamGuestProfiles() {
    if (_isFirebaseReady && _firestore != null) {
      try {
        return _cloudOrLocal(
          _firestore!
              .collection(AppConstants.colGuestProfiles)
              .snapshots()
              .map((snap) {
            if (snap.docs.isEmpty) return _crmProfiles;
            try {
              return snap.docs
                  .map((doc) => GuestCrmModel.fromJson(doc.data(), doc.id))
                  .toList();
            } catch (_) {
              return _crmProfiles;
            }
          }),
          _crmProfiles,
        );
      } catch (_) {}
    }
    return _withInitial(_crmProfiles, _crmController);
  }

  // ---- MUTATION METHODS ----

  // ---- BOOKING LIFECYCLE (Admin) ----

  /// Take one Admin/system action on a Booking.
  ///
  /// The rules (`applyAdminAction`) decide; this only stores the result: the
  /// patch on `bookings/{id}` and the Activity entry under
  /// `bookings/{id}/activity`, in one batch so a transition is never unlogged.
  /// Without Firebase the in-memory list is patched the same way.
  Future<ActionResult> applyBookingAction(
    BookingModel booking,
    AdminAction action,
    Actor actor, {
    ActionInput input = const ActionInput(),
  }) async {
    final others = _latestBookings
        .where((b) => b.id != booking.id)
        .map((b) => b.toLifecycleDoc())
        .toList();
    final merged = ActionInput(
      reason: input.reason,
      amountVerified: input.amountVerified,
      guestResubmits: input.guestResubmits,
      otherBookings: input.otherBookings.isEmpty ? others : input.otherBookings,
      publishedRates: input.publishedRates ?? _rates,
      damageDeduction: input.damageDeduction,
    );
    final result = applyAdminAction(booking.toLifecycleDoc(), action, actor,
        input: merged);
    if (!result.ok) return result;

    if (isCloud) {
      try {
        final ref =
            _firestore!.collection(AppConstants.colBookings).doc(booking.id);
        final log = ref.collection('activity');
        // The id is the sequence, so two appends that both think they are
        // next collide instead of silently reordering the log (same rule as
        // the website's activityLogDB.append).
        final written = await log.get();
        var seq = -1;
        for (final d in written.docs) {
          final v = d.data()['seq'];
          if (v is num && v > seq) seq = v.toInt();
        }
        seq += 1;
        final batch = _firestore!.batch();
        batch.update(ref, result.patch);
        batch.set(log.doc('$seq'), {...result.entry!, 'seq': seq});
        await batch.commit();
        return result;
      } catch (e) {
        return ActionResult.refused(
            'Could not save to Firestore (${e.toString().split('\n').first}).');
      }
    }

    _patchLocal(booking.id, result.patch, result.entry!);
    return result;
  }

  void _patchLocal(
      String id, Map<String, dynamic> patch, Map<String, dynamic> entry) {
    final index = _bookings.indexWhere((b) => b.id == id);
    if (index != -1) {
      _bookings[index] = _bookings[index].applyPatch(patch);
      _latestBookings = _bookings;
      _bookingsController.add(List.unmodifiable(_bookings));
    }
    final log = _localActivity.putIfAbsent(id, () => []);
    log.add({...entry, 'seq': log.length});
    _activityControllers[id]?.add(List.unmodifiable(log));
  }

  /// The append-only Activity log of one Booking, oldest first.
  Stream<List<Map<String, dynamic>>> streamBookingActivity(String bookingId) {
    if (isCloud) {
      try {
        return _firestore!
            .collection(AppConstants.colBookings)
            .doc(bookingId)
            .collection('activity')
            .orderBy('at')
            .snapshots()
            .map((snap) {
          final entries = snap.docs.map((d) => d.data()).toList();
          entries.sort((a, b) {
            final sa = a['seq'] is num ? (a['seq'] as num) : 0;
            final sb = b['seq'] is num ? (b['seq'] as num) : 0;
            return sa.compareTo(sb);
          });
          return entries;
        }).transform(
          StreamTransformer<List<Map<String, dynamic>>,
              List<Map<String, dynamic>>>.fromHandlers(
            handleData: (data, sink) => sink.add(data),
            handleError: (_, __, sink) =>
                sink.add(List<Map<String, dynamic>>.unmodifiable(
                    _localActivity[bookingId] ?? const [])),
          ),
        );
      } catch (_) {}
    }
    final controller = _activityControllers.putIfAbsent(
        bookingId, () => StreamController.broadcast());
    return _withInitial(_localActivity[bookingId] ?? const [], controller);
  }

  /// Remove a Booking outright (Admin only per firestore.rules). The lifecycle
  /// prefers Reject/Cancel — this is for test entries and duplicates.
  Future<void> deleteBooking(String bookingId) async {
    _bookings.removeWhere((b) => b.id == bookingId);
    _latestBookings = _latestBookings.where((b) => b.id != bookingId).toList();
    _bookingsController.add(List.unmodifiable(_bookings));
    if (isCloud) {
      try {
        await _firestore!
            .collection(AppConstants.colBookings)
            .doc(bookingId)
            .delete();
      } catch (_) {}
    }
  }

  // ---- PUBLISHED RATES (site_config/rates) ----

  /// The rates + cancellation policy the website quotes from; null until
  /// the Admin publishes one.
  Stream<Map<String, dynamic>?> streamPublishedRates() {
    if (isCloud) {
      try {
        return _firestore!
            .collection(AppConstants.colSiteConfig)
            .doc(AppConstants.docRates)
            .snapshots()
            .map((snap) {
          final data = snap.data();
          _rates = data == null ? null : Map<String, dynamic>.from(data);
          return _rates;
        }).transform(
          StreamTransformer<Map<String, dynamic>?,
              Map<String, dynamic>?>.fromHandlers(
            handleData: (data, sink) => sink.add(data),
            handleError: (_, __, sink) => sink.add(_rates),
          ),
        );
      } catch (_) {}
    }
    return Stream<Map<String, dynamic>?>.multi((mc) {
      mc.add(_rates);
      final sub = _ratesController.stream.listen(mc.add);
      mc.onCancel = sub.cancel;
    });
  }

  /// Publish a rates document. Refuses (returns the problems) when it would
  /// not pass the website's `validatePublishedRates`.
  Future<List<RatesProblem>> publishRates(Map<String, dynamic> doc) async {
    final problems = validatePublishedRates(doc, kKnownAccommodationIds);
    if (problems.isNotEmpty) return problems;
    _rates = Map<String, dynamic>.from(doc);
    _ratesController.add(_rates);
    if (isCloud) {
      try {
        await _firestore!
            .collection(AppConstants.colSiteConfig)
            .doc(AppConstants.docRates)
            .set({
          ...doc,
          'published_at': FieldValue.serverTimestamp(),
        });
      } catch (e) {
        return [
          RatesProblem('',
              'Could not save to Firestore (${e.toString().split('\n').first}).')
        ];
      }
    }
    return const [];
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
    _ratesController.close();
    for (final c in _activityControllers.values) {
      c.close();
    }
  }
}
