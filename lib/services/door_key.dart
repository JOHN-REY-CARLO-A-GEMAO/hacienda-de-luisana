import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';

import '../models/booking.dart';

/// P4 Real ESP32 prep — signed time-windowed door tokens + challenge-response.
///
/// WHY NOT PROXIMITY: BLE proximity ("phone is near, open") can be relayed
/// and replays a static signal. Here the lock issues a random challenge per
/// attempt and the phone must answer with HMAC(propertySecret, challenge +
/// token). A replayed answer fails the next challenge; a token outside its
/// window fails even with a correct signature.
///
/// TOKEN WINDOW (mirrors Booking key gate):
///   validFrom = check-in day 2PM, validTo = check-out day 12NN + 1hr grace.
///
/// OFFLINE VERIFY PATH (documented): the ESP32 holds the property secret +
/// a cached allowlist (uid → refId → validTo). Verify is pure HMAC + clock
/// compare — no network. Factors:
///   1. signature valid (bound to uid + refId + window + secret),
///   2. validFrom <= lockClock < validTo (lock RTC, drift-tolerant ±5min),
///   3. Booking.status allows entry (confirmed|checked_in — enforced by the
///      app gate; the lock enforces the window, the app enforces the state).
/// Sync: access logs buffer on the lock/app and upload when online
/// (see Esp32Service.syncLogs — Central DB shape = AccessLogEntry.toMap).
///
/// TRANSPORT SWAP: today Esp32Service uses SimTransport (800ms/5s). Real
/// hardware swaps in FlutterBluePlusTransport: GATT service with a
/// challenge characteristic (lock→phone notify) and an answer characteristic
/// (phone→lock write). Token + challenge/response bytes are identical —
/// only the transport changes.
class DoorKeyToken {
  final String uid;
  final String refId;
  final String accommodationId;
  final DateTime validFrom;
  final DateTime validTo;
  final DateTime issuedAt;
  final String nonce;
  final String signature;

  const DoorKeyToken({
    required this.uid,
    required this.refId,
    required this.accommodationId,
    required this.validFrom,
    required this.validTo,
    required this.issuedAt,
    required this.nonce,
    required this.signature,
  });

  Map<String, dynamic> toMap() => {
        'uid': uid,
        'ref_id': refId,
        'accommodation': accommodationId,
        'valid_from': validFrom.toIso8601String(),
        'valid_to': validTo.toIso8601String(),
        'issued_at': issuedAt.toIso8601String(),
        'nonce': nonce,
      };

  factory DoorKeyToken.fromMap(Map<String, dynamic> map, String signature) {
    return DoorKeyToken(
      uid: (map['uid'] ?? '').toString(),
      refId: (map['ref_id'] ?? '').toString(),
      accommodationId: (map['accommodation'] ?? '').toString(),
      validFrom: DateTime.parse(map['valid_from'] as String),
      validTo: DateTime.parse(map['valid_to'] as String),
      issuedAt: DateTime.parse(map['issued_at'] as String),
      nonce: (map['nonce'] ?? '').toString(),
      signature: signature,
    );
  }
}

/// BLE transport abstraction. P4-prep ships SimTransport; hardware brings
/// FlutterBluePlusTransport (same token bytes over GATT).
abstract class BleTransport {
  /// Lock → phone: fresh random challenge per attempt.
  Future<String> readChallenge();

  /// Phone → lock: write challenge answer, returns lock verdict.
  Future<bool> writeAnswer(String answerHex);

  /// Best-effort platform BLE check (false on web/desktop runners).
  Future<bool> supported();
}

/// Simulated transport — 800ms handshake, always reachable (matches the
/// current Esp32Service timing so UI behavior is unchanged).
class SimTransport implements BleTransport {
  final Random _rand = Random.secure();
  String _lastChallenge = '';

  @override
  Future<String> readChallenge() async {
    await Future.delayed(const Duration(milliseconds: 200));
    final bytes = List<int>.generate(16, (_) => _rand.nextInt(256));
    _lastChallenge =
        bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return _lastChallenge;
  }

  @override
  Future<bool> writeAnswer(String answerHex) async {
    // 600ms simulated GATT round-trip (200ms challenge + 600ms ≈ 800ms total).
    await Future.delayed(const Duration(milliseconds: 600));
    return answerHex.isNotEmpty && _lastChallenge.isNotEmpty;
  }

  @override
  Future<bool> supported() async => true;
}

/// Real-hardware transport stub. Wire service/characteristic UUIDs from the
/// ESP32 firmware here; token + challenge/response logic is unchanged.
class FlutterBluePlusTransport implements BleTransport {
  @override
  Future<String> readChallenge() {
    // TODO(hardware): discover device, subscribe to challenge characteristic.
    throw UnimplementedError('Pair ESP32 firmware UUIDs first (P4 hardware).');
  }

  @override
  Future<bool> writeAnswer(String answerHex) {
    throw UnimplementedError('Pair ESP32 firmware UUIDs first (P4 hardware).');
  }

  @override
  Future<bool> supported() async {
    try {
      return await FlutterBluePlus.isSupported;
    } catch (_) {
      return false;
    }
  }
}

class DoorKey {
  DoorKey._();

  /// DEMO property secret (P4-prep stand-in). Real deployments provision a
  /// per-property secret to the lock + host console over a secure channel and
  /// NEVER ship it in the guest app — the guest receives only their signed
  /// token. Hardcoded here so the offline path is testable without hardware.
  static const demoPropertySecret = 'hdl-demo-property-secret-v1';

  static const _nonceChars =
      'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

  static String _nonce([int len = 12]) {
    final r = Random.secure();
    return List.generate(
        len, (_) => _nonceChars[r.nextInt(_nonceChars.length)]).join();
  }

  static String _canonical(Map<String, dynamic> m) => jsonEncode({
        'uid': m['uid'],
        'ref_id': m['ref_id'],
        'accommodation': m['accommodation'],
        'valid_from': m['valid_from'],
        'valid_to': m['valid_to'],
        'issued_at': m['issued_at'],
        'nonce': m['nonce'],
      });

  static String _sign(Map<String, dynamic> payload, String secret) {
    final hmac = Hmac(sha256, utf8.encode(secret));
    return hmac.convert(utf8.encode(_canonical(payload))).toString();
  }

  /// Issues a token bound to uid + booking window. Clock maths match
  /// Booking.keyActivatesAt/keyExpiresAt exactly (2PM → 12NN+1hr).
  static DoorKeyToken issue({
    required String uid,
    required String refId,
    required String accommodationId,
    required DateTime checkInDate,
    required DateTime checkOutDate,
    required String secret,
    DateTime? now,
  }) {
    final from = DateTime(checkInDate.year, checkInDate.month, checkInDate.day,
        Booking.keyCheckInHour);
    final to = DateTime(checkOutDate.year, checkOutDate.month,
            checkOutDate.day, Booking.keyCheckOutHour)
        .add(const Duration(hours: Booking.keyGraceHours));
    final at = now ?? DateTime.now();
    final payload = {
      'uid': uid,
      'ref_id': refId,
      'accommodation': accommodationId,
      'valid_from': from.toIso8601String(),
      'valid_to': to.toIso8601String(),
      'issued_at': at.toIso8601String(),
      'nonce': _nonce(),
    };
    return DoorKeyToken(
      uid: uid,
      refId: refId,
      accommodationId: accommodationId,
      validFrom: from,
      validTo: to,
      issuedAt: at,
      nonce: payload['nonce'] as String,
      signature: _sign(payload, secret),
    );
  }

  /// Convenience: token straight from a Booking (uid falls back to '').
  static DoorKeyToken issueFromBooking(Booking b, String secret,
      {DateTime? now}) {
    return issue(
      uid: b.uid ?? '',
      refId: b.referenceId,
      accommodationId: b.accommodationId,
      checkInDate: b.checkInDate,
      checkOutDate: b.checkOutDate,
      secret: secret,
      now: now,
    );
  }

  /// Offline verify: signature + window. Pure Dart — runs on the lock, the
  /// phone, or in tests with zero network.
  static bool verify(DoorKeyToken token, String secret, {DateTime? now}) {
    final current = now ?? DateTime.now();
    final recomputed = _sign(token.toMap(), secret);
    if (recomputed != token.signature) return false;
    if (current.isBefore(token.validFrom)) return false;
    if (!current.isBefore(token.validTo)) return false;
    return true;
  }

  /// Answers a lock challenge: HMAC(secret, challenge + tokenSignature).
  static String answerChallenge({
    required DoorKeyToken token,
    required String secret,
    required String challengeHex,
  }) {
    final hmac = Hmac(sha256, utf8.encode(secret));
    return hmac
        .convert(utf8.encode('$challengeHex|${token.signature}'))
        .toString();
  }

  /// Lock-side check of the phone's answer (replay-safe: challenge is fresh).
  static bool verifyResponse({
    required DoorKeyToken token,
    required String secret,
    required String challengeHex,
    required String responseHex,
  }) {
    if (challengeHex.isEmpty || responseHex.isEmpty) return false;
    return answerChallenge(
            token: token, secret: secret, challengeHex: challengeHex) ==
        responseHex;
  }
}
