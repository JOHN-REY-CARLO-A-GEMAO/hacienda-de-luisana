import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/booking.dart';
import '../models/tracking_session.dart';
import 'cloud_bookings.dart';

/// Guest-side booking state.
///
/// P1: local correctness, no backend — submit stays pending for host review.
/// P2: offline-first Firestore sync over the same `bookings` collection the
/// web /book form uses (web-compatible shape via Booking.toCloudMap).
///
/// - Local SharedPreferences cache opens instantly and survives restarts.
/// - When cloud is live, own bookings stream in and host updates
///   (confirmed/cancelled, kyc approved/rejected) reconcile over local.
/// - Offline submits stay `synced=false` and show a "will send" banner;
///   syncPending() retries them on reconnect.
/// - Lazy EXPIRED: pending older than 24h reads as `expired` locally
///   (Booking.isExpiredLocal) and releases dates until a TTL cron exists.
class BookingStore extends ChangeNotifier {
  static const String _storeKey = 'hdl_demo_bookings';

  final List<Booking> _bookings = [];
  final List<TrackingSession> _sessions = [];

  CloudBookings? _cloud;
  StreamSubscription<List<Booking>>? _watchSub;
  StreamSubscription<List<TrackingSession>>? _sessionsSub;

  /// True once Firebase init succeeded (cloud live, own stream attached).
  bool cloudLive = false;

  /// True while a cloud write/retry is in flight.
  bool syncing = false;

  /// Last cloud error for the banner (null when clean).
  String? syncError;

  /// Active guest uid (anon Firebase uid or local fallback).
  String? uid;

  /// Owner session flag (set by OwnerShell from AuthStore.isOwner).
  /// Anak (view-only) can never confirm/cancel — rules exclude anak too.
  bool _isOwnerSession = false;
  bool get isOwnerSession => _isOwnerSession;

  void setOwnerSession(bool value) {
    if (_isOwnerSession == value) return;
    _isOwnerSession = value;
    notifyListeners();
  }

  BookingStore() {
    _load();
  }

  List<Booking> get bookings => List.unmodifiable(_bookings);

  /// Live tracking sessions (owner mode, G6) — the radar rows. Each one's
  /// `bookingId` is the booking's Firestore doc id; local-only bookings can
  /// never have a session.
  List<TrackingSession> get sessions => List.unmodifiable(_sessions);

  /// The booking the dashboard should surface (latest active one).
  /// Expired-pending is terminal locally, so it never surfaces as current.
  Booking? get currentBooking {
    final active = _bookings.where((b) => b.isActive).toList();
    if (active.isEmpty) return null;
    active.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return active.first;
  }

  /// Unsynced locals waiting for cloud (offline queue depth).
  int get pendingSyncCount => _bookings.where((b) => !b.synced).length;

  bool get isConfirmed => currentBooking?.isConfirmed ?? false;

  bool get isCheckedIn => currentBooking?.status == 'checked_in';

  Booking? _findByRef(String referenceId) {
    for (final b in _bookings) {
      if (b.referenceId == referenceId) return b;
    }
    return null;
  }

  // ---- Cloud attach ----

  /// Attaches the cloud service (call once from AppShell). Never throws.
  Future<void> attachCloud(CloudBookings cloud, {String? anonUid}) async {
    _cloud = cloud;
    try {
      cloudLive = await cloud.ensureInitialized();
      uid = cloud.uid ?? anonUid ?? uid;
      if (uid != null && cloudLive) {
        await _watchOwn();
      }
      // Opportunistically push anything queued while offline.
      await syncPending();
    } catch (e) {
      syncError = e.toString();
      cloudLive = false;
    }
    notifyListeners();
  }

  /// Owner mode: streams ALL bookings (not uid-scoped) and every live
  /// tracking session (G6) for the owner APK triage + tracking tabs. Falls
  /// back to local cache offline.
  Future<void> attachOwnerCloud(CloudBookings cloud, {String? anonUid}) async {
    _cloud = cloud;
    try {
      cloudLive = await cloud.ensureInitialized();
      uid = cloud.uid ?? anonUid ?? uid;
      if (cloudLive) {
        await _watchAll();
        _watchSessions();
      }
      await syncPending();
    } catch (e) {
      syncError = e.toString();
      cloudLive = false;
    }
    notifyListeners();
  }

  void _watchSessions() {
    final cloud = _cloud;
    if (cloud == null || !cloudLive) return;
    _sessionsSub = cloud.streamSessions().listen(
      (list) {
        _sessions
          ..clear()
          ..addAll(list);
        notifyListeners();
      },
      onError: (Object e) {
        syncError = e.toString();
        notifyListeners();
      },
    );
  }

  Future<void> _watchAll() async {
    await _watchSub?.cancel();
    final cloud = _cloud;
    if (cloud == null || !cloudLive) return;
    _watchSub = cloud.watchAllBookings().listen(
      (remote) => _reconcileCloud(remote),
      onError: (Object e) {
        syncError = e.toString();
        notifyListeners();
      },
    );
  }

  Future<void> _watchOwn() async {
    await _watchSub?.cancel();
    final cloud = _cloud;
    final id = uid ?? cloud?.uid;
    if (cloud == null || !cloudLive || id == null || id.isEmpty) return;
    _watchSub = cloud.watchOwnBookings(id).listen(
      (remote) => _reconcileCloud(remote),
      onError: (Object e) {
        syncError = e.toString();
        notifyListeners();
      },
    );
  }

  /// Merges host truth over local cache by referenceId.
  /// Remote status/kyc/urls/reject-reason/eta/firestoreId win;
  /// local-only docs are kept. Rejected KYC surfaces with the host reason
  /// so the guest sees *why* and can resubmit (key stays disabled meanwhile).
  void _reconcileCloud(List<Booking> remote) {
    if (remote.isEmpty) return;
    var changed = false;
    for (final r in remote) {
      final local = _findByRef(r.referenceId);
      if (local == null) {
        _bookings.add(r);
        changed = true;
      } else {
        // Live location is never merged here: the cloud booking doc does not
        // carry it anymore (G6) — it arrives on the sessions stream instead.
        if (local.status != r.status ||
            local.kycStatus != r.kycStatus ||
            local.kycIdUrl != r.kycIdUrl ||
            local.kycReceiptUrl != r.kycReceiptUrl ||
            local.kycRejectReason != r.kycRejectReason ||
            local.firestoreId != r.firestoreId) {
          local.status = r.status;
          local.kycStatus = r.kycStatus;
          local.kycIdUrl = r.kycIdUrl ?? local.kycIdUrl;
          local.kycReceiptUrl = r.kycReceiptUrl ?? local.kycReceiptUrl;
          local.kycRejectReason = r.kycRejectReason;
          local.firestoreId = r.firestoreId ?? local.firestoreId;
          local.synced = true;
          changed = true;
        }
      }
    }
    if (changed) {
      _persist();
      notifyListeners();
    }
  }

  // ---- Actions ----

  /// Guest submitted the reservation form. Persists locally instantly,
  /// then best-effort syncs to Firestore in web shape (fire-and-forget).
  Future<void> submitBooking(Booking booking) async {
    booking.uid ??= uid;
    _bookings.add(booking);
    _persist();
    notifyListeners();
    await _pushOne(booking);
  }

  Future<void> _pushOne(Booking booking) async {
    final cloud = _cloud;
    if (cloud == null || !cloudLive) return; // stays queued (synced=false)
    syncing = true;
    syncError = null;
    notifyListeners();
    try {
      final docId = await cloud.submitBooking(booking);
      if (docId != null) {
        booking.firestoreId = docId;
        booking.synced = true;
      }
    } catch (e) {
      syncError = e.toString();
    } finally {
      syncing = false;
      _persist();
      notifyListeners();
    }
  }

  /// Retries all unsynced locals (call on reconnect / app resume).
  Future<void> syncPending() async {
    final cloud = _cloud;
    if (cloud == null || !cloudLive) return;
    final queued = _bookings.where((b) => !b.synced).toList();
    if (queued.isEmpty) return;
    syncing = true;
    notifyListeners();
    try {
      for (final b in queued) {
        b.uid ??= uid ?? cloud.uid;
        final docId = await cloud.submitBooking(b);
        if (docId != null) {
          b.firestoreId = docId;
          b.synced = true;
        }
      }
      syncError = null;
    } catch (e) {
      syncError = e.toString();
    } finally {
      syncing = false;
      _persist();
      notifyListeners();
    }
  }

  /// Guest submitted (or resubmitted after rejection) ID + receipt.
  /// P3 uploads the files to /kyc before calling this (see KycScreen);
  /// urls here are Storage download URLs for /admin review. Status stays
  /// pending and any reject reason clears so the review loop restarts.
  /// Offline: local placeholders persist, cloud sync retries via syncPending.
  Future<void> markKycSubmitted(String referenceId,
      {String? govtIdPath,
      String? receiptPath,
      String? kycIdUrl,
      String? kycReceiptUrl}) async {
    final b = _findByRef(referenceId);
    if (b == null) return;
    b.applyKycSubmitted(idUrl: kycIdUrl, receiptUrl: kycReceiptUrl);
    b.govtIdPath = govtIdPath ?? b.govtIdPath;
    b.paymentReceiptPath = receiptPath ?? b.paymentReceiptPath;
    _persist();
    notifyListeners();
    final cloud = _cloud;
    if (cloud != null && cloudLive && b.firestoreId != null) {
      await cloud.markKycSubmitted(
        b.firestoreId!,
        idUrl: kycIdUrl,
        receiptUrl: kycReceiptUrl,
      );
    }
  }

  /// Saves the one-time ETA Maps link (booker sends when near).
  Future<void> setEtaShareUrl(String referenceId, String url) async {
    final b = _findByRef(referenceId);
    if (b == null) return;
    b.etaShareUrl = url;
    _persist();
    notifyListeners();
    final cloud = _cloud;
    if (cloud != null && cloudLive && b.firestoreId != null) {
      await cloud.setEtaShareUrl(b.firestoreId!, url);
    }
  }

  /// Guest check-in (host-assisted in the real flow).
  void checkIn() {
    final b = currentBooking;
    if (b != null && b.status == 'confirmed') {
      b.status = 'checked_in';
      _persist();
      notifyListeners();
    }
  }

  /// Guest may cancel while still pending; later cancellations go via host.
  Future<bool> cancelBooking() async {
    final b = currentBooking;
    if (b == null || b.status != 'pending') return false;
    b.status = 'cancelled';
    _persist();
    notifyListeners();
    final cloud = _cloud;
    if (cloud != null && cloudLive && b.firestoreId != null) {
      await cloud.cancelOwn(b.firestoreId!);
    }
    return true;
  }

  /// Owner: confirm any booking by ref (triage tab). Writes locally + cloud.
  /// Anak-guarded: view-only sessions return false with a syncError.
  Future<bool> confirmBooking(String referenceId) async {
    if (!_isOwnerSession) {
      syncError = 'View only — owner confirmation needed.';
      notifyListeners();
      return false;
    }
    final b = _findByRef(referenceId);
    if (b == null) return false;
    b.status = 'confirmed';
    _persist();
    notifyListeners();
    final cloud = _cloud;
    if (cloud != null && cloudLive && b.firestoreId != null) {
      return cloud.confirmBooking(b.firestoreId!);
    }
    return true;
  }

  /// Owner: cancel any booking by ref (triage tab). Writes locally + cloud.
  /// Anak-guarded: view-only sessions return false with a syncError.
  Future<bool> cancelBookingRef(String referenceId) async {
    if (!_isOwnerSession) {
      syncError = 'View only — owner confirmation needed.';
      notifyListeners();
      return false;
    }
    final b = _findByRef(referenceId);
    if (b == null) return false;
    b.status = 'cancelled';
    _persist();
    notifyListeners();
    final cloud = _cloud;
    if (cloud != null && cloudLive && b.firestoreId != null) {
      return cloud.cancelBooking(b.firestoreId!);
    }
    return true;
  }

  // ---- Availability (G2, client-side best-effort) ----

  /// Local overlap check against cached bookings.
  List<Booking> findLocalConflicts({
    required String accommodationId,
    required DateTime checkIn,
    required DateTime checkOut,
    String? excludeRefId,
  }) {
    return _bookings.where((b) {
      if (excludeRefId != null && b.referenceId == excludeRefId) return false;
      return b.blocksRange(checkIn, checkOut, sameStay: accommodationId);
    }).toList();
  }

  /// Combined local + cloud overlap check before submit.
  /// Cloud part fails open ([]) when offline or index-missing.
  Future<List<Booking>> findAllConflicts({
    required String accommodationId,
    required DateTime checkIn,
    required DateTime checkOut,
    String? excludeRefId,
  }) async {
    final local = findLocalConflicts(
      accommodationId: accommodationId,
      checkIn: checkIn,
      checkOut: checkOut,
      excludeRefId: excludeRefId,
    );
    final cloud = _cloud;
    if (cloud == null || !cloudLive) return local;
    final remote = await cloud.findConflicts(
      accommodationId: accommodationId,
      checkIn: checkIn,
      checkOut: checkOut,
      excludeRefId: excludeRefId,
    );
    final seen = local.map((b) => b.referenceId).toSet();
    final merged = [...local];
    for (final r in remote) {
      if (!seen.contains(r.referenceId)) merged.add(r);
    }
    return merged;
  }

  // ---- Persistence ----

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_storeKey);
      if (raw != null && raw.isNotEmpty) {
        final list = jsonDecode(raw) as List<dynamic>;
        _bookings
          ..clear()
          ..addAll(list.map((e) => Booking.fromJson(e as Map<String, dynamic>)));
        notifyListeners();
      }
    } catch (_) {
      // Corrupt cache — start clean.
    }
  }

  Future<void> _persist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _storeKey,
        jsonEncode(_bookings.map((b) => b.toJson()).toList()),
      );
    } catch (_) {}
  }

  @override
  void dispose() {
    _watchSub?.cancel();
    super.dispose();
  }
}
