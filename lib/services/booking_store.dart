import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/booking.dart';

/// Guest-side booking state for the demo.
///
/// Flow (demo simulation of the real pipeline):
///   submitBooking()      → status: pending, kyc: required
///   markKycSubmitted()   → kyc: submitted  (status STAYS pending)
///   ~6s "host review"    → status: confirmed, kyc: approved
///
/// Everything is persisted to SharedPreferences so bookings survive app
/// restarts. In Phase 2 this store becomes a thin wrapper over Firestore and
/// the simulated timer is replaced by the real host's /admin action.
class BookingStore extends ChangeNotifier {
  static const String _storeKey = 'hdl_demo_bookings';

  final List<Booking> _bookings = [];
  Timer? _hostReviewTimer;

  BookingStore() {
    _load();
  }

  List<Booking> get bookings => List.unmodifiable(_bookings);

  /// The booking the dashboard should surface (latest active one).
  Booking? get currentBooking {
    final active = _bookings.where((b) => b.isActive).toList();
    if (active.isEmpty) return null;
    active.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return active.first;
  }

  bool get isConfirmed => currentBooking?.isConfirmed ?? false;

  bool get isCheckedIn => currentBooking?.status == 'checked_in';

  Booking? _findByRef(String referenceId) {
    for (final b in _bookings) {
      if (b.referenceId == referenceId) return b;
    }
    return null;
  }

  // ---- Actions ----

  /// Guest submitted the reservation form. Booking starts as pending.
  void submitBooking(Booking booking) {
    _bookings.add(booking);
    _persist();
    notifyListeners();
  }

  /// Guest uploaded ID + receipt. Docs are "received" — the host still has to
  /// approve. Demo: simulate that host review completing after a short delay.
  void markKycSubmitted(String referenceId, {String? govtIdPath, String? receiptPath}) {
    final b = _findByRef(referenceId);
    if (b == null) return;
    b.kycStatus = 'submitted';
    b.govtIdPath = govtIdPath ?? b.govtIdPath;
    b.paymentReceiptPath = receiptPath ?? b.paymentReceiptPath;
    _persist();
    notifyListeners();

    _hostReviewTimer?.cancel();
    _hostReviewTimer = Timer(const Duration(seconds: 6), () {
      _simulateHostApproval(referenceId);
    });
  }

  /// DEMO ONLY: stands in for the host pressing "Confirm" in the web /admin.
  void _simulateHostApproval(String referenceId) {
    final b = _findByRef(referenceId);
    if (b == null || b.status != 'pending') return;
    b.status = 'confirmed';
    b.kycStatus = 'approved';
    _persist();
    notifyListeners();
    debugPrint('Demo host approved booking $referenceId');
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
  bool cancelBooking() {
    final b = currentBooking;
    if (b == null || b.status != 'pending') return false;
    b.status = 'cancelled';
    _hostReviewTimer?.cancel();
    _persist();
    notifyListeners();
    return true;
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
        // Re-arm the demo host review if the app was restarted mid-review.
        final pending = _bookings.where((b) => b.status == 'pending' && b.kycStatus == 'submitted');
        if (pending.isNotEmpty) {
          _hostReviewTimer?.cancel();
          _hostReviewTimer = Timer(const Duration(seconds: 3), () {
            for (final b in pending.toList()) {
              _simulateHostApproval(b.referenceId);
            }
          });
        }
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
    _hostReviewTimer?.cancel();
    super.dispose();
  }
}
