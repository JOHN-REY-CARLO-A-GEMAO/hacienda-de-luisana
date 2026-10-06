import 'dart:async';
import 'dart:math' as math;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import '../models/booking_model.dart';
import '../models/smart_lock_event_model.dart';
import '../models/room_model.dart';
import '../models/guest_crm_model.dart';
import '../core/constants/app_constants.dart';
import 'booking_lifecycle.dart';
import 'mock_data_service.dart';
import 'pin_store.dart' show PinSecurityRemote, SecurityTicket;
import 'security_gate.dart';

/// Why a `site_config/payment` document cannot be published, or null when it can.
///
/// The document has two shapes: a `methods` list of up to five official payment
/// channels, or the three singular fields a document published before that list
/// existed. `firestore.rules` accepts either (`validPaymentConfig`), and so does
/// the website (`validatePaymentInformation` in `src/lib/paymentInfoDB.ts`), so
/// this accepts both too.
///
/// It used to read only the singular fields. The Admin screen publishes the list
/// shape, where `doc['method']` does not exist, so every publish was refused with
/// "method is required and must be at most 80 characters" — no way for the person
/// publishing to get a channel saved.
///
/// Pure, so it is a test rather than a guess (`test/payment_information_test.dart`).
String? validatePaymentInformationDocument(Map<String, dynamic> doc) {
  String? validateText(String path, Object? value, int max) {
    if (value is! String || value.trim().isEmpty || value.length > max) {
      return '$path is required and must be at most $max characters.';
    }
    return null;
  }

  String? validateChannel(Object? channel, String path) {
    if (channel is! Map) return '$path must be an object.';
    final method = validateText('$path.method', channel['method'], 80);
    if (method != null) return method;
    final recipient = validateText('$path.recipient_name', channel['recipient_name'], 120);
    if (recipient != null) return recipient;
    return validateText('$path.account_identifier', channel['account_identifier'], 120);
  }

  if (doc['active'] is! bool) return 'Active must be true or false.';

  final methods = doc['methods'];
  if (methods is List) {
    if (methods.isEmpty || methods.length > 5) {
      return 'methods must list between 1 and 5 payment channels.';
    }
    for (var i = 0; i < methods.length; i++) {
      final problem = validateChannel(methods[i], 'methods[$i]');
      if (problem != null) return problem;
    }
  } else {
    final problem = validateChannel(doc, '');
    if (problem != null) return problem;
  }

  final instructions = validateText('instructions', doc['instructions'], 1000);
  if (instructions != null) return instructions;

  for (final key in ['security_deposit_notes', 'notes']) {
    final value = doc[key];
    if (value != null && (value is! String || value.length > 1000)) {
      return '$key must be at most 1000 characters.';
    }
  }
  return null;
}

class FirestoreService implements PinSecurityRemote {
  final FirebaseFirestore? _firestore;
  bool _isFirebaseReady = false;

  // In-memory fallback stream controllers
  final _bookingsController = StreamController<List<BookingModel>>.broadcast();
  final _lockLogsController = StreamController<List<SmartLockEventModel>>.broadcast();
  final _roomsController = StreamController<List<RoomModel>>.broadcast();
  final _crmController = StreamController<List<GuestCrmModel>>.broadcast();
  final _ratesController =
      StreamController<Map<String, dynamic>?>.broadcast();
  final _paymentController =
      StreamController<Map<String, dynamic>?>.broadcast();
  final _activityControllers =
      <String, StreamController<List<Map<String, dynamic>>>>{};

  // In-memory state buffers
  List<BookingModel> _bookings = [];
  List<SmartLockEventModel> _lockLogs = [];
  List<RoomModel> _rooms = [];
  List<GuestCrmModel> _crmProfiles = [];
  /// The latest Bookings seen (cloud or local): what Approve checks dates
  /// against, and what the in-memory fallback mutates.
  List<BookingModel> _latestBookings = [];
  Map<String, dynamic>? _rates;
  Map<String, dynamic>? _paymentInformation;
  final Map<String, List<Map<String, dynamic>>> _localActivity = {};

  bool get isCloud => _isFirebaseReady && _firestore != null;

  FirestoreService([FirebaseFirestore? firestore])
      : _firestore = firestore {
    _initialize();
  }

  void _initialize() {
    _bookings = MockDataService.initialBookings;
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
    SecurityTicket? ticket,
  }) async {
    // The structural backstop (ADR-0015): every Booking action re-asks what
    // the gate demands of it, so a call site that forgets the PIN sheet
    // still cannot take a PIN-tier action — the service refuses anything at
    // that tier without a fresh ticket. Confirm-tier actions pass with no
    // ticket; their deliberate input is the confirm modal (or, for Reject,
    // the reason the Guest reads).
    if (gateForBookingAction(action,
                proofRejectionCancels: !input.guestResubmits) ==
            GateLevel.pin &&
        (ticket == null || !ticket.isValid(DateTime.now()))) {
      return ActionResult.refused(
          'This action needs a fresh Security PIN. Run it again and enter the PIN when the sheet asks.');
    }
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
  ///
  /// Deletion is PIN-tier (ADR-0015) and is irreversible, so the service
  /// re-asks the gate the way [applyBookingAction] does: a call site that
  /// forgets the PIN sheet gets a refusal and no write, never a silent delete.
  /// Returns null on success, or the reason it refused/failed.
  Future<String?> deleteBooking(String bookingId, {SecurityTicket? ticket}) async {
    if (gateFor(GateAction.deleteBooking) == GateLevel.pin &&
        (ticket == null || !ticket.isValid(DateTime.now()))) {
      return 'Deleting a Booking needs a fresh Security PIN. Run it again and '
          'enter the PIN when the sheet asks.';
    }
    if (isCloud) {
      try {
        await _firestore!
            .collection(AppConstants.colBookings)
            .doc(bookingId)
            .delete();
      } catch (e) {
        return 'Could not delete from Firestore (${e.toString().split('\n').first}).';
      }
    }
    _bookings.removeWhere((b) => b.id == bookingId);
    _latestBookings = _latestBookings.where((b) => b.id != bookingId).toList();
    _bookingsController.add(List.unmodifiable(_bookings));
    return null;
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
  ///
  /// PIN-tier (ADR-0015), and the in-memory copy moves only once the network
  /// write has survived: publishing used to overwrite the local rates before
  /// Firestore answered, so a failed write left the app quoting figures the
  /// website had never agreed to.
  Future<List<RatesProblem>> publishRates(Map<String, dynamic> doc,
      {SecurityTicket? ticket}) async {
    if (ticket == null || !ticket.isValid(DateTime.now())) {
      return [
        const RatesProblem('',
            'Publishing rates needs a fresh Security PIN. Press Publish again and enter the PIN.')
      ];
    }
    final problems = validatePublishedRates(doc, kKnownAccommodationIds);
    if (problems.isNotEmpty) return problems;
    final previous = _rates;
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
        _rates = previous;
        _ratesController.add(_rates);
        return [
          RatesProblem('',
              'Could not save to Firestore (${e.toString().split('\n').first}). The previous rates still stand.')
        ];
      }
    }
    return const [];
  }

  Stream<Map<String, dynamic>?> streamPaymentInformation() {
    if (isCloud) {
      return _firestore!
          .collection(AppConstants.colSiteConfig)
          .doc(AppConstants.docPayment)
          .snapshots()
          .map((snap) {
        _paymentInformation = snap.data();
        return _paymentInformation;
      }).transform(StreamTransformer<Map<String, dynamic>?,
          Map<String, dynamic>?>.fromHandlers(
        handleData: (data, sink) => sink.add(data),
        handleError: (_, __, sink) => sink.add(_paymentInformation),
      ));
    }
    return Stream<Map<String, dynamic>?>.multi((mc) {
      mc.add(_paymentInformation);
      final sub = _paymentController.stream.listen(mc.add);
      mc.onCancel = sub.cancel;
    });
  }

  /// PIN-tier (ADR-0015). The GCash and bank numbers here go to every
  /// visitor, and the in-memory copy only moves once Firestore has accepted
  /// the write — same rollback rule as [publishRates].
  Future<String?> publishPaymentInformation(Map<String, dynamic> doc,
      {SecurityTicket? ticket}) async {
    final problem = validatePaymentInformationDocument(doc);
    if (problem != null) return problem;
    if (ticket == null || !ticket.isValid(DateTime.now())) {
      return 'Publishing payment information needs a fresh Security PIN. Press Publish again and enter the PIN.';
    }
    final previous = _paymentInformation;
    _paymentInformation = Map<String, dynamic>.from(doc);
    _paymentController.add(_paymentInformation);
    if (isCloud) {
      try {
        await _firestore!
            .collection(AppConstants.colSiteConfig)
            .doc(AppConstants.docPayment)
            .set({...doc, 'updated_at': FieldValue.serverTimestamp()});
      } catch (e) {
        _paymentInformation = previous;
        _paymentController.add(_paymentInformation);
        return 'Could not save payment information (${e.toString().split('\n').first}). The previous instructions still stand.';
      }
    }
    return null;
  }

  /// Returns what went wrong, or null — a swallowed failure here used to
  /// mean a simulator tap that looked recorded and was not.
  Future<String?> recordSmartLockEvent(SmartLockEventModel event) async {
    _lockLogs.insert(0, event);
    _lockLogsController.add(List.unmodifiable(_lockLogs));

    if (_isFirebaseReady && _firestore != null) {
      try {
        await _firestore!
            .collection(AppConstants.colSmartLockLogs)
            .add(event.toJson());
      } catch (e) {
        return 'Could not record the event (${e.toString().split('\n').first}).';
      }
    }
    return null;
  }

  /// Confirm-tier in the gate (ADR-0015) — the confirm modal is the call
  /// site's job; the service's job is to say what went wrong instead of
  /// swallowing it, and the call sites await this and surface it.
  /// Record an Accommodation's operational status.
  ///
  /// Status only. This used to accept a `newPrice` and write
  /// `rooms.pricePerNight`, behind a dialog labelled "Peak Season Rate
  /// Override" — a control that looked like it changed what a Guest pays and
  /// changed nothing, because no booking, website page or availability check ever
  /// read that field. Rates are published on `site_config/rates` and read by the
  /// booking system; `firestore.rules` refuses any other field on this document.
  Future<String?> updateRoomStatus(String roomId, RoomStatus status) async {
    final index = _rooms.indexWhere((r) => r.id == roomId);
    if (index != -1) {
      _rooms[index] = _rooms[index].copyWith(status: status);
      _roomsController.add(List.unmodifiable(_rooms));
    }

    if (_isFirebaseReady && _firestore != null) {
      try {
        await _firestore!
            .collection(AppConstants.colRooms)
            .doc(roomId)
            .update({'status': status.name});
      } catch (e) {
        return 'Could not save the status (${e.toString().split('\n').first}). '
            'It shows the new status here only.';
      }
    }
    return null;
  }

  // ---- ADMIN SECURITY (admin_security/{uid} — ADR-0015) ----
  //
  // FirestoreService is the [PinSecurityRemote]: the device copy of the PIN
  // record governs the check (it has to work offline); Firestore is the
  // watermark the rules refuse to lower. Every method below is
  // best-effort — a missed write costs a reconciliation, never a crash.

  @override
  Future<Map<String, dynamic>?> fetchAdminSecurity(String uid) async {
    if (!isCloud) return null;
    final snap = await _firestore!
        .collection(AppConstants.colAdminSecurity)
        .doc(uid)
        .get();
    return snap.data();
  }

  @override
  Future<void> recordPinFailure(
    String uid, {
    required int failedAttempts,
    required DateTime? lockedUntil,
  }) async {
    if (!isCloud) return;
    await _firestore!
        .collection(AppConstants.colAdminSecurity)
        .doc(uid)
        .update({
      'failed_attempts': failedAttempts,
      'locked_until': lockedUntil,
    });
  }

  @override
  Future<void> writeAdminSecurity(String uid, Map<String, dynamic> doc) async {
    if (!isCloud) return;
    await _firestore!
        .collection(AppConstants.colAdminSecurity)
        .doc(uid)
        .set({
      ...doc,
      // The stamp the rules hold to the writer: rotated now, by this uid.
      // A server timestamp satisfies `pin_updated_at == request.time`.
      'pin_updated_at': FieldValue.serverTimestamp(),
      'pin_updated_by': FirebaseAuth.instance.currentUser?.uid ?? uid,
    });
  }

  /// Dispose of the PIN record and file its `PinReset` line in one batch
  /// (ADR-0016).
  ///
  /// Unlike the three methods above, this one **propagates its failure**. The
  /// two friends are best-effort by contract — a missed write costs a
  /// reconciliation, because the device copy governs. This one cannot work that
  /// way: if the delete does not happen, `PinGate.forgetPin` has to keep the
  /// local record and the gate has to keep asking for the PIN. A swallowed
  /// error here would show the Admin a fresh setup screen while the server
  /// still held the old record, which is the one outcome ADR-0016 exists to
  /// make impossible.
  ///
  /// The event and the delete go together so the trail never disagrees with the
  /// store: a record that vanished with no companion line, or a line with no
  /// record gone, is not a state this system should be able to be in.
  @override
  Future<void> forgetPin(String uid) async {
    if (!isCloud) throw StateError('no cloud connection to dispose of the PIN in');
    final firestore = _firestore!;
    final batch = firestore.batch();

    batch.delete(firestore.collection(AppConstants.colAdminSecurity).doc(uid));
    batch.set(
      firestore
          .collection(AppConstants.colAdminSecurityEvents)
          .doc(_pinResetEventId()),
      {
        'uid': uid,
        'action': 'PinReset',
        // Server-stamped: the rules hold `at == request.time`, so the line
        // cannot claim to have been filed at a time of the writer's choosing.
        'at': FieldValue.serverTimestamp(),
      },
    );

    await batch.commit();
  }

  /// A fresh id for each reset, so the trail only ever grows.
  ///
  /// Deliberately NOT stable per uid: `admin_security_events` refuses `update`,
  /// so reusing one document id would make an Admin's *second* reset — years
  /// later, after a fresh PIN and another 24 h — an update the rules refuse.
  /// Append-only means append-only.
  String _pinResetEventId() {
    final random = math.Random.secure();
    final suffix = List<int>.generate(12, (_) => random.nextInt(36))
        .map((n) => n.toRadixString(36))
        .join();
    return 'pin-reset-${DateTime.now().microsecondsSinceEpoch}-$suffix';
  }

  void dispose() {
    _bookingsController.close();
    _lockLogsController.close();
    _roomsController.close();
    _crmController.close();
    _ratesController.close();
    _paymentController.close();
    for (final c in _activityControllers.values) {
      c.close();
    }
  }
}
