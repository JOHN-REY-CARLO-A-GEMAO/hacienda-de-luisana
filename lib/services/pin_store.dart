// ----------------------------------------------------------------------------
// The Admin's Security PIN — storage, hashing, lockout, ticket (ADR-0015)
// Hacienda de LuisAna Admin app
// ----------------------------------------------------------------------------
// The device copy is a cache so the check works offline; Firestore
// (`admin_security/{uid}`, guarded by its own firestore.rules block) is the
// source of truth and is reconciled on the next successful write. A failure
// to persist costs what a missed tour flag costs in tutorial_store.dart: the
// PIN simply gets asked for again.
//
// Hashing keeps one convention with the website's demo mode
// (src/lib/authLocal.ts): PBKDF2-HMAC-SHA256, a 16-byte `Random.secure()`
// salt, base64 salt and key. The plaintext PIN is never written anywhere.
//
// Two deliberate departures from "write everything, hope":
//
//   - Firestore's `failed_attempts` is a ratchet. The rules refuse to lower
//     it or clear a live `locked_until` (only a stamped rotation, which the
//     app offers only after a current-PIN check, may), so clearing app data
//     or writing Firestore directly does not clear a lockout. The friendly
//     reset-on-success lives on the device counter; the server counter is
//     the tamper-evident watermark the ladder reads upward from.
//   - A correct PIN mints a [SecurityTicket] valid for 120 s, so reviewing a
//     morning's arrivals costs one entry, not one per arrival. The ticket is
//     wiped the moment the app is backgrounded (AuthGate's lifecycle
//     observer) — the exact boundary of "signed in".
//
// No Flutter imports: `test/pin_policy_test.dart` runs every policy decision
// here against a MemoryPinStore.
// ----------------------------------------------------------------------------

library;

import 'dart:convert';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ---------------------------------------------------------------------------
// Hashing — the one convention shared with the website's demo mode
// ---------------------------------------------------------------------------

/// Identifies the scheme in stored records, the way `authLocal.ts` does.
const String kPinAlgorithm = 'pbkdf2-sha256';

const int kPinSaltBytes = 16;
const int kPinHashBytes = 32;

/// One hundred thousand PBKDF2 rounds. Stored per record (`iterations`), so
/// raising the default later re-hashes at the next PIN change instead of
/// stranding existing records.
const int kPinIterations = 100000;

/// A fresh base64 salt from `Random.secure()`.
String newPinSalt() {
  final random = math.Random.secure();
  return base64.encode(
      List<int>.generate(kPinSaltBytes, (_) => random.nextInt(256)));
}

/// PBKDF2-HMAC-SHA256, first block (DK[0]) only — a 32-byte key is one block,
/// which is all a verifier needs. Implementing the 20-line loop on the Dart
/// team's `crypto` keeps a second dependency (pointycastle) out of the app.
String derivePinHash(String pin, String saltB64, int iterations) {
  final salt = base64.decode(saltB64);
  final mac = Hmac(sha256, utf8.encode(pin));
  // U1 = PRF(password, salt || INT_32_BE(1)); every later round feeds the
  // previous U back in, XOR-accumulated into the key.
  final first = BytesBuilder()..add(salt)..add(const [0, 0, 0, 1]);
  var u = List<int>.of(mac.convert(first.toBytes()).bytes);
  final acc = List<int>.of(u);
  for (var round = 1; round < iterations; round++) {
    u = List<int>.of(mac.convert(u).bytes);
    for (var i = 0; i < acc.length; i++) {
      acc[i] ^= u[i];
    }
  }
  return base64.encode(acc);
}

/// Constant-time-enough comparison of two equal-length base64 keys: a string
/// compare short-circuits on the first differing character, which leaks far
/// less than an early `==` on a wrong length would. Lengths here are fixed
/// (32 bytes → 44 chars), so the practical difference is nil; the shape is
/// what matters.
bool pinHashMatches(String candidate, String stored) {
  if (candidate.length != stored.length) return false;
  var diff = 0;
  for (var i = 0; i < candidate.length; i++) {
    diff |= candidate.codeUnitAt(i) ^ stored.codeUnitAt(i);
  }
  return diff == 0;
}

// ---------------------------------------------------------------------------
// Lockout ladder
// ---------------------------------------------------------------------------

/// Five wrong entries start the ladder; each failure after that doubles it.
const int kPinLockoutAfterFailures = 5;
const Duration kPinLockoutBase = Duration(seconds: 30);
const Duration kPinLockoutMax = Duration(minutes: 5);

/// The lockout the [failedAttempts]-th wrong entry earns, or null below the
/// ladder's first rung. 5 → 30 s, 6 → 60 s, 7 → 120 s, 8 → 240 s, 9 and past
/// → the 5-minute cap.
Duration? lockoutFor(int failedAttempts) {
  if (failedAttempts < kPinLockoutAfterFailures) return null;
  final doubling = math.min(
      failedAttempts - kPinLockoutAfterFailures, 4); // 2^4 = 16× ≥ the cap
  final seconds = kPinLockoutBase.inSeconds * (1 << doubling);
  if (seconds >= kPinLockoutMax.inSeconds) return kPinLockoutMax;
  return Duration(seconds: seconds);
}

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

/// What a correct PIN mints: proof, for [validity], that this session passed
/// the gate. The service backstop accepts a fresh ticket in place of a new
/// entry; AuthGate clears it on `AppLifecycleState.paused`.
class SecurityTicket {
  final DateTime issuedAt;

  const SecurityTicket(this.issuedAt);

  /// Approving a morning's arrivals costs one entry, not one per arrival.
  static const Duration validity = Duration(seconds: 120);

  bool isValid(DateTime now) {
    final age = now.difference(issuedAt);
    return !age.isNegative && age <= validity;
  }
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/// The PIN record as the device cache and the Firestore document both hold
/// it (the document adds `uid`, `pin_updated_at`, `pin_updated_by` — the
/// service stamps those, and the rules hold them to the writer).
class PinRecord {
  final String salt;
  final String hash;
  final int iterations;
  final int failedAttempts;
  final DateTime? lockedUntil;
  final DateTime? updatedAt;

  const PinRecord({
    required this.salt,
    required this.hash,
    required this.iterations,
    this.failedAttempts = 0,
    this.lockedUntil,
    this.updatedAt,
  });

  /// The device-cache shape. Mirrors `authLocal.ts`'s stored password.
  Map<String, dynamic> toMap() => {
        'algorithm': kPinAlgorithm,
        'iterations': iterations,
        'salt': salt,
        'hash': hash,
        'failed_attempts': failedAttempts,
        'locked_until': lockedUntil?.toIso8601String(),
        'pin_updated_at': updatedAt?.toIso8601String(),
      };

  static PinRecord? fromMap(Map<dynamic, dynamic>? map) {
    if (map == null) return null;
    final salt = map['salt'];
    final hash = map['hash'];
    if (salt is! String || hash is! String) return null;
    if (map['algorithm'] != null && map['algorithm'] != kPinAlgorithm) {
      return null;
    }
    final lockedUntil = map['locked_until'];
    final updatedAt = map['pin_updated_at'];
    return PinRecord(
      salt: salt,
      hash: hash,
      iterations: map['iterations'] is int && (map['iterations'] as int) > 0
          ? map['iterations'] as int
          : kPinIterations,
      failedAttempts: map['failed_attempts'] is int ? map['failed_attempts'] as int : 0,
      lockedUntil: lockedUntil is String ? DateTime.tryParse(lockedUntil) : null,
      updatedAt: updatedAt is String ? DateTime.tryParse(updatedAt) : null,
    );
  }

  /// The Firestore document body, without the fields the service stamps
  /// (`pin_updated_at` as a server timestamp, `pin_updated_by` as the
  /// writer) — pin_store.dart stays free of Firebase imports.
  Map<String, dynamic> toFirestoreDoc(String uid) => {
        'uid': uid,
        'pin_hash': hash,
        'salt': salt,
        'iterations': iterations,
        'failed_attempts': failedAttempts,
        'locked_until': lockedUntil,
      };

  /// Accepts the three shapes a read can hand over: Firestore Timestamps
  /// (`toDate()`), plain DateTimes (tests, cached echoes) and ISO strings.
  static DateTime? _asDateTime(Object? value) {
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    if (value != null) {
      try {
        return (value as dynamic).toDate() as DateTime?;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  static PinRecord? fromFirestoreDoc(Map<dynamic, dynamic>? doc) {
    if (doc == null) return null;
    final salt = doc['salt'];
    final hash = doc['pin_hash'];
    if (salt is! String || hash is! String) return null;
    return PinRecord(
      salt: salt,
      hash: hash,
      iterations: doc['iterations'] is int && (doc['iterations'] as int) > 0
          ? doc['iterations'] as int
          : kPinIterations,
      failedAttempts:
          doc['failed_attempts'] is int ? doc['failed_attempts'] as int : 0,
      lockedUntil: _asDateTime(doc['locked_until']),
      updatedAt: _asDateTime(doc['pin_updated_at']),
    );
  }

  PinRecord copyWith({int? failedAttempts, DateTime? lockedUntil}) =>
      PinRecord(
        salt: salt,
        hash: hash,
        iterations: iterations,
        failedAttempts: failedAttempts ?? this.failedAttempts,
        lockedUntil: lockedUntil,
        updatedAt: updatedAt,
      );
}

// ---------------------------------------------------------------------------
// Store triple — the house pattern from tutorial_store.dart
// ---------------------------------------------------------------------------

/// Where the device copy of the PIN record lives.
abstract class PinStore {
  Future<PinRecord?> load(String uid);
  Future<void> save(String uid, PinRecord record);
  Future<void> clear(String uid);
}

/// The real store: SharedPreferences, per-uid, every failure swallowed. A
/// missed write costs nothing but a re-seed from Firestore (or, offline, a
/// forced setup check that refuses to fail open).
class SharedPrefsPinStore implements PinStore {
  static String keyFor(String uid) => 'hdl_admin_security_pin_$uid';

  Future<SharedPreferences?> _prefs() async {
    try {
      return await SharedPreferences.getInstance();
    } catch (_) {
      return null;
    }
  }

  @override
  Future<PinRecord?> load(String uid) async {
    final prefs = await _prefs();
    if (prefs == null || !prefs.containsKey(keyFor(uid))) return null;
    try {
      final decoded = jsonDecode(prefs.getString(keyFor(uid)) ?? '');
      return PinRecord.fromMap(decoded is Map ? decoded : null);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(String uid, PinRecord record) async {
    try {
      final prefs = await _prefs();
      await prefs?.setString(keyFor(uid), jsonEncode(record.toMap()));
    } catch (_) {
      /* the cache is rebuildable from Firestore; never surface a write miss */
    }
  }

  @override
  Future<void> clear(String uid) async {
    try {
      final prefs = await _prefs();
      await prefs?.remove(keyFor(uid));
    } catch (_) {}
  }
}

/// Tests and any host without the plugin.
class MemoryPinStore implements PinStore {
  final Map<String, PinRecord> _records = {};

  @override
  Future<PinRecord?> load(String uid) async => _records[uid];

  @override
  Future<void> save(String uid, PinRecord record) async {
    _records[uid] = record;
  }

  @override
  Future<void> clear(String uid) async {
    _records.remove(uid);
  }
}

// ---------------------------------------------------------------------------
// The Firestore side, phrased without Firebase imports
// ---------------------------------------------------------------------------

/// What [PinGate] needs from `admin_security/{uid}`. FirestoreService
/// implements this; the indirection keeps pin_store.dart free of Firebase
/// and the tests free of mocks.
abstract class PinSecurityRemote {
  /// The stored document, or null when the Admin has none yet.
  Future<Map<String, dynamic>?> fetchAdminSecurity(String uid);

  /// One wrong entry, merged onto the counters. Fire-and-forget by contract:
  /// implementers swallow their own errors.
  Future<void> recordPinFailure(
    String uid, {
    required int failedAttempts,
    required DateTime? lockedUntil,
  });

  /// Create or rotate: the full document, `pin_updated_at`/`pin_updated_by`
  /// stamped by the implementer (the rules hold the stamp to the writer).
  Future<void> writeAdminSecurity(String uid, Map<String, dynamic> doc);
}

// ---------------------------------------------------------------------------
// PinGate
// ---------------------------------------------------------------------------

/// Whether the Admin has a PIN this device can check.
enum PinSetupState {
  /// A record exists locally (just seeded from Firestore counts too).
  ready,

  /// No record anywhere reachable — first sign-in, create one.
  setUpNeeded,

  /// No local record and Firestore could not be asked. Refuse rather than
  /// fail open: offline with no cache, a PIN cannot be checked and a new
  /// one cannot be minted by whoever is holding the phone.
  unreachable,
}

enum PinVerifyOutcome { verified, wrongPin, locked, notSetUp, unavailable }

class PinVerifyResult {
  final PinVerifyOutcome outcome;
  final SecurityTicket? ticket;
  final int failedAttempts;
  final DateTime? lockedUntil;

  const PinVerifyResult._(
    this.outcome, {
    this.ticket,
    this.failedAttempts = 0,
    this.lockedUntil,
  });

  const PinVerifyResult.verified(SecurityTicket ticket)
      : this._(PinVerifyOutcome.verified, ticket: ticket);
  const PinVerifyResult.wrongPin(int attempts, DateTime? lockedUntil)
      : this._(PinVerifyOutcome.wrongPin,
            failedAttempts: attempts, lockedUntil: lockedUntil);
  const PinVerifyResult.locked(DateTime lockedUntil)
      : this._(PinVerifyOutcome.locked, lockedUntil: lockedUntil);
  const PinVerifyResult.notSetUp()
      : this._(PinVerifyOutcome.notSetUp);
  const PinVerifyResult.unavailable()
      : this._(PinVerifyOutcome.unavailable);
}

/// The gate itself: verifies entries against the cached record, keeps the
/// ladder, mints tickets, writes the PIN. Plain Dart — the sheets drive it
/// and the screens read its ticket.
class PinGate {
  final PinStore store;
  final PinSecurityRemote? remote;
  SecurityTicket? _ticket;

  PinGate({required this.store, this.remote});

  /// The session's live ticket, or null. A fresh ticket is why the second
  /// sensitive action in two minutes does not ask again.
  SecurityTicket? freshTicket([DateTime? now]) {
    final at = now ?? DateTime.now();
    final ticket = _ticket;
    return ticket != null && ticket.isValid(at) ? ticket : null;
  }

  /// The exact boundary of "signed in": backgrounding the app.
  void clearTicket() => _ticket = null;

  /// First sign-in (or app data cleared): decide what this device can do.
  /// Seeds the cache from Firestore when it can, and refuses to fail open
  /// when it cannot.
  Future<PinSetupState> setupState(String uid) async {
    final local = await store.load(uid);
    if (local != null) return PinSetupState.ready;
    final api = remote;
    if (api == null) return PinSetupState.setUpNeeded; // demo mode: device-only
    Map<String, dynamic>? doc;
    try {
      doc = await api.fetchAdminSecurity(uid);
    } catch (_) {
      return PinSetupState.unreachable;
    }
    if (doc == null) return PinSetupState.setUpNeeded;
    final record = PinRecord.fromFirestoreDoc(doc);
    if (record == null) return PinSetupState.unreachable;
    await store.save(uid, record);
    return PinSetupState.ready;
  }

  /// One PIN entry. Never throws; every persistence miss is swallowed.
  Future<PinVerifyResult> verify(String uid, String pin, {DateTime? now}) async {
    final at = now ?? DateTime.now();
    var record = await store.load(uid);
    if (record == null) {
      final state = await setupState(uid);
      if (state == PinSetupState.setUpNeeded) {
        return const PinVerifyResult.notSetUp();
      }
      if (state == PinSetupState.unreachable) {
        return const PinVerifyResult.unavailable();
      }
      record = await store.load(uid);
      if (record == null) return const PinVerifyResult.unavailable();
    }
    final locked = record.lockedUntil;
    if (locked != null && locked.isAfter(at)) {
      return PinVerifyResult.locked(locked);
    }
    final candidate = derivePinHash(pin, record.salt, record.iterations);
    if (!pinHashMatches(candidate, record.hash)) {
      final attempts = record.failedAttempts + 1;
      final lockout = lockoutFor(attempts);
      final lockedUntil = lockout == null ? null : at.add(lockout);
      final updated = record.copyWith(
          failedAttempts: attempts, lockedUntil: lockedUntil ?? locked);
      await store.save(uid, updated);
      final api = remote;
      if (api != null) {
        try {
          await api.recordPinFailure(uid,
              failedAttempts: attempts, lockedUntil: lockedUntil);
        } catch (_) {
          /* Firestore is the watermark, not the gate; the device copy governs */
        }
      }
      return PinVerifyResult.wrongPin(attempts, lockedUntil);
    }
    final ticket = SecurityTicket(at);
    _ticket = ticket;
    // The friendly reset is device-local. Firestore's counter is the ratchet
    // the rules refuse to lower; the server lock simply runs out on its own.
    await store.save(uid, record.copyWith(failedAttempts: 0));
    _reconcile(uid);
    return PinVerifyResult.verified(ticket);
  }

  /// Create (first sign-in) or rotate (Settings, after a current-PIN check
  /// the sheet runs). Returns an error message, or null on success — the
  /// house `String?` shape.
  Future<String?> setPin(
    String uid,
    String pin, {
    int iterations = kPinIterations,
    DateTime? now,
  }) async {
    if (pin.length != 6) return 'The PIN is six digits.';
    final salt = newPinSalt();
    final record = PinRecord(
      salt: salt,
      hash: derivePinHash(pin, salt, iterations),
      iterations: iterations,
      updatedAt: now ?? DateTime.now(),
    );
    await store.save(uid, record);
    final api = remote;
    if (api != null) {
      try {
        await api.writeAdminSecurity(uid, record.toFirestoreDoc(uid));
      } catch (_) {
        /* the device copy governs; _reconcile repairs the server next verify */
      }
    }
    _ticket = null;
    return null;
  }

  /// Best-effort server reconciliation after a success: create the document
  /// if this device has a PIN the server never saw, and otherwise leave the
  /// server alone — the ratchet rules refuse anything weaker anyway.
  Future<void> _reconcile(String uid) async {
    final api = remote;
    if (api == null) return;
    try {
      final record = await store.load(uid);
      if (record == null) return;
      final doc = await api.fetchAdminSecurity(uid);
      if (doc == null || doc['pin_hash'] != record.hash) {
        await api.writeAdminSecurity(uid, record.toFirestoreDoc(uid));
      }
    } catch (_) {
      /* offline: the next success tries again */
    }
  }
}
