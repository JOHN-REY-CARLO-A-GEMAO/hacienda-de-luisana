import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// One lock event. Central DB shape: the same map syncs to Firestore
/// (`access_logs` collection) when online — see [Esp32Service.syncLogs].
class AccessLogEntry {
  final DateTime timestamp;
  final String uid;
  final String refId;
  final bool granted;
  final String reason;
  bool synced;

  AccessLogEntry({
    required this.timestamp,
    required this.uid,
    required this.refId,
    required this.granted,
    required this.reason,
    this.synced = false,
  });

  Map<String, dynamic> toMap() => {
        'timestamp': timestamp.toIso8601String(),
        'uid': uid,
        'ref_id': refId,
        'result': granted ? 'granted' : 'denied',
        'reason': reason,
        'synced': synced,
      };

  Map<String, dynamic> toCentralDb() => {
        'timestamp': timestamp.toIso8601String(),
        'uid': uid,
        'ref_id': refId,
        'result': granted ? 'granted' : 'denied',
        'reason': reason,
      };

  factory AccessLogEntry.fromMap(Map<String, dynamic> m) => AccessLogEntry(
        timestamp: DateTime.parse(m['timestamp'] as String),
        uid: (m['uid'] ?? '').toString(),
        refId: (m['ref_id'] ?? '').toString(),
        granted: (m['result'] ?? m['granted']) == 'granted' ||
            m['granted'] == true,
        reason: (m['reason'] ?? '').toString(),
        synced: (m['synced'] as bool?) ?? true,
      );

  factory AccessLogEntry.fromJson(Map<String, dynamic> j) =>
      AccessLogEntry.fromMap(j);
  Map<String, dynamic> toJson() => toMap();
}

/// Outcome of a single unlock attempt (drives UI copy + logging).
class UnlockOutcome {
  final bool granted;
  final String reason;
  const UnlockOutcome.granted([this.reason = 'Unlocked'])
      : granted = true;
  const UnlockOutcome.denied(this.reason) : granted = false;
}

/// P4-prep smart-lock service. Transport stays SIMULATED (800ms handshake,
/// 5s auto-relock) — real BLE GATT swaps the transport only (see door_key).
///
/// Added for hardware readiness:
/// - Offline access-log buffer (persisted, cap 200) + [syncLogs] uploader
///   hook for Central DB sync when online.
/// - 3 failed attempts / 10min → 15min lockout cooldown + admin alert hook.
/// - Master override hook for the host (physical code / master RFID).
class Esp32Service extends ChangeNotifier {
  static const _logsKey = 'hdl_access_logs';
  static const _maxLogs = 200;

  /// Lockout policy: 3 fails within 10min → 15min cooldown.
  static const maxFails = 3;
  static const failWindow = Duration(minutes: 10);
  static const lockoutCooldown = Duration(minutes: 15);

  bool _connected = true;
  bool _unlocked = false;
  Timer? _relockTimer;
  final _connectionController = StreamController<bool>.broadcast();
  Timer? _connectionStreamTimer;

  final List<AccessLogEntry> _logs = [];
  final List<DateTime> _failures = [];

  /// Master override hook: return true when [code] is the host master code
  /// (wired to the physical keypad / master RFID in firmware; in-app it is
  /// a fallback button for the host). Null = no override configured.
  bool Function(String code)? masterVerifier;

  /// Alert hook: invoked on lockout (admin push / caretaker call in prod).
  void Function(String message)? onLockoutAlert;

  bool _loaded = false;

  Esp32Service() {
    _loadLogs();
    // Periodically pulse connection status every 8 seconds
    _connectionStreamTimer = Timer.periodic(const Duration(seconds: 8), (timer) {
      _rssiIndex = (_rssiIndex + 1) % _rssiSamples.length;
      _connectionController.add(_connected);
      notifyListeners();
    });
  }

  bool get connected => _connected;
  bool get unlocked => _unlocked;

  Stream<bool> get connectionStream => _connectionController.stream;

  // ---- Placeholders (simulated; real values come over BLE/GATT) ----

  /// Simulated battery — drains 1% per 10 unlocks from 87%.
  int get batteryPercent {
    final unlocks = _logs.where((l) => l.granted).length;
    return (87 - unlocks ~/ 10).clamp(5, 100);
  }

  static const _rssiSamples = [-62, -65, -59, -64];
  int _rssiIndex = 0;

  /// Simulated signal strength in dBm (placeholder until BLE RSSI).
  int get rssiDbm => _rssiSamples[_rssiIndex];

  // ---- Access log (persisted, Central-DB ready) ----

  List<AccessLogEntry> get logs => List.unmodifiable(_logs);

  List<AccessLogEntry> get recentLogs => _logs.length <= 5
      ? List.unmodifiable(_logs.reversed.toList())
      : List.unmodifiable(_logs.reversed.take(5).toList());

  int get pendingSyncCount => _logs.where((l) => !l.synced).length;

  Future<void> _loadLogs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_logsKey);
      if (raw != null && raw.isNotEmpty) {
        final list = jsonDecode(raw) as List<dynamic>;
        final loaded = list.map((e) => AccessLogEntry.fromJson(
            (e as Map).map((k, v) => MapEntry(k.toString(), v))));
        // Merge (never wipe): attempts made before this load finished are
        // already in _logs — skip duplicates instead of clearing them.
        for (final e in loaded) {
          final dup = _logs.any((l) =>
              l.timestamp == e.timestamp &&
              l.refId == e.refId &&
              l.uid == e.uid);
          if (!dup) _logs.add(e);
        }
        _logs.sort((a, b) => a.timestamp.compareTo(b.timestamp));
        if (_logs.length > _maxLogs) {
          _logs.removeRange(0, _logs.length - _maxLogs);
        }
        // Rebuild failure window from persisted denials (survives restart).
        _failures
          ..clear()
          ..addAll(_logs
              .where((l) => !l.granted && l.reason != 'master-override')
              .map((l) => l.timestamp));
        _pruneFailures(DateTime.now());
      }
    } catch (_) {
      // Corrupt log — start clean.
    } finally {
      _loaded = true;
      notifyListeners();
    }
  }

  bool get logsLoaded => _loaded;

  Future<void> _persistLogs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _logsKey,
        jsonEncode(_logs.map((l) => l.toJson()).toList()),
      );
    } catch (_) {}
  }

  void _appendLog(AccessLogEntry entry) {
    _logs.add(entry);
    if (_logs.length > _maxLogs) {
      _logs.removeRange(0, _logs.length - _maxLogs);
    }
    _persistLogs();
    notifyListeners();
  }

  /// Pushes buffered logs to Central DB via [uploader]. Returns flushed count.
  /// Entries stay buffered (synced=false) when offline — sync() retries later.
  Future<int> syncLogs(
      Future<bool> Function(List<Map<String, dynamic>> batch) uploader) async {
    final pending = _logs.where((l) => !l.synced).toList();
    if (pending.isEmpty) return 0;
    try {
      final ok =
          await uploader(pending.map((l) => l.toCentralDb()).toList());
      if (ok) {
        for (final l in pending) {
          l.synced = true;
        }
        await _persistLogs();
        notifyListeners();
        return pending.length;
      }
      return 0;
    } catch (_) {
      return 0;
    }
  }

  // ---- Lockout (3 fails / 10min → 15min cooldown) ----

  void _pruneFailures(DateTime now) {
    _failures.removeWhere((t) => now.difference(t) > failWindow);
  }

  /// True while the cooldown is active. Cooldown runs 15min from the
  /// triggering (most recent) failure. Power-cycling the phone does not
  /// clear it — failures rebuild from the persisted log on restart.
  bool isLockedOut([DateTime? now]) {
    final current = now ?? DateTime.now();
    _pruneFailures(current);
    if (_failures.length < maxFails) return false;
    final trigger = _failures.last;
    return current.difference(trigger) < lockoutCooldown;
  }

  DateTime? lockoutUntil([DateTime? now]) {
    final current = now ?? DateTime.now();
    _pruneFailures(current);
    if (_failures.length < maxFails) return null;
    final until = _failures.last.add(lockoutCooldown);
    return until.isAfter(current) ? until : null;
  }

  /// Test/seeding hook: records a failure at [at] (defaults to now).
  void recordFailure({DateTime? at, String reason = 'denied'}) {
    final t = at ?? DateTime.now();
    _failures.add(t);
    _pruneFailures(t);
    if (isLockedOut(t)) {
      onLockoutAlert?.call(
          'Lock alert: $maxFails failed attempts within ${failWindow.inMinutes}min — 15min cooldown.');
    }
    notifyListeners();
  }

  // ---- Unlock (sim transport: 800ms handshake, 5s relock) ----

  Future<bool> unlock() async {
    // 800ms delay to simulate hardware bluetooth/wifi handshake with ESP32 lock
    await Future.delayed(const Duration(milliseconds: 800));
    _unlocked = true;

    // Auto re-lock after 5 seconds
    _relockTimer?.cancel();
    _relockTimer = Timer(const Duration(seconds: 5), () {
      _unlocked = false;
      notifyListeners();
    });
    notifyListeners();
    return true;
  }

  void forceLock() {
    _relockTimer?.cancel();
    _unlocked = false;
    notifyListeners();
  }

  /// Central unlock gate: lockout → master override → signed token validity.
  /// Every attempt is logged (granted/denied + reason) for the admin
  /// smart-lock records view. [tokenValid] is the DoorKey.verify result
  /// (challenge-response answer checked by the caller/transport).
  Future<UnlockOutcome> requestUnlock({
    required String uid,
    required String refId,
    required bool tokenValid,
    String? masterCode,
    DateTime? now,
  }) async {
    final current = now ?? DateTime.now();

    // 1. Lockout cooldown (master override still works — host rescue path).
    if (isLockedOut(current)) {
      if (masterCode != null && _tryMaster(masterCode)) {
        return _grant(uid, refId, 'master-override', current);
      }
      final until = lockoutUntil(current);
      final reason = until == null
          ? 'Too many failed attempts — try again in 15 minutes.'
          : 'Too many failed attempts — locked until ${_hhmm(until)}.';
      _appendLog(AccessLogEntry(
          timestamp: current,
          uid: uid,
          refId: refId,
          granted: false,
          reason: 'lockout'));
      recordFailure(at: current, reason: 'lockout');
      return UnlockOutcome.denied(reason);
    }

    // 2. Master override (host): bypasses token check, always logged.
    if (masterCode != null) {
      if (_tryMaster(masterCode)) {
        return _grant(uid, refId, 'master-override', current);
      }
      return _deny(uid, refId, 'Wrong master code.', current);
    }

    // 3. Signed time-windowed token (challenge-response, never proximity).
    if (!tokenValid) {
      return _deny(
          uid, refId, 'Key not valid right now — check dates and KYC status.',
          current);
    }

    final ok = await unlock();
    if (!ok) {
      return _deny(uid, refId, 'Lock unreachable — walk to the door.',
          current);
    }
    return _grant(uid, refId, 'unlocked', current);
  }

  /// Host master-code unlock path (keypad fallback / rescue).
  Future<UnlockOutcome> masterUnlock(String code,
      {String uid = 'host', String refId = '', DateTime? now}) {
    return requestUnlock(
        uid: uid, refId: refId, tokenValid: false, masterCode: code, now: now);
  }

  bool _tryMaster(String code) {
    final v = masterVerifier;
    if (v == null) return false;
    try {
      return v(code);
    } catch (_) {
      return false;
    }
  }

  UnlockOutcome _grant(
      String uid, String refId, String reason, DateTime at) {
    _appendLog(AccessLogEntry(
        timestamp: at, uid: uid, refId: refId, granted: true, reason: reason));
    return UnlockOutcome.granted(
        reason == 'master-override' ? 'Master override accepted.' : 'Unlocked');
  }

  UnlockOutcome _deny(String uid, String refId, String reason, DateTime at) {
    _appendLog(AccessLogEntry(
        timestamp: at,
        uid: uid,
        refId: refId,
        granted: false,
        reason: reason));
    recordFailure(at: at, reason: reason);
    return UnlockOutcome.denied(reason);
  }

  static String _hhmm(DateTime dt) =>
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';

  @override
  void dispose() {
    _relockTimer?.cancel();
    _connectionStreamTimer?.cancel();
    _connectionController.close();
    super.dispose();
  }
}
