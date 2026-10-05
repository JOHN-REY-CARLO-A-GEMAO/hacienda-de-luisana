// Unit tests for the Security PIN's policy layer
// (lib/services/pin_store.dart): the lockout ladder, the ticket, the PBKDF2
// round trip through a MemoryPinStore, and the gate's setup/verify flows.
//
// Run: flutter test test/pin_policy_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/pin_store.dart';

/// A PinSecurityRemote that records what the gate asked of it — the same
/// shape FirestoreService implements, without Firebase.
class _RecordingRemote implements PinSecurityRemote {
  final Map<String, Map<String, dynamic>> docs = {};
  final List<Map<String, dynamic>> failures = [];
  bool unreachable = false;

  @override
  Future<Map<String, dynamic>?> fetchAdminSecurity(String uid) async {
    if (unreachable) throw Exception('offline');
    return docs[uid];
  }

  @override
  Future<void> recordPinFailure(
    String uid, {
    required int failedAttempts,
    required DateTime? lockedUntil,
  }) async {
    failures.add({
      'uid': uid,
      'failed_attempts': failedAttempts,
      'locked_until': lockedUntil,
    });
  }

  @override
  Future<void> writeAdminSecurity(String uid, Map<String, dynamic> doc) async {
    docs[uid] = Map<String, dynamic>.from(doc);
  }
}

void main() {
  final t0 = DateTime.utc(2026, 10, 1, 9);

  group('the lockout ladder', () {
    test('nothing below five wrong entries', () {
      expect(lockoutFor(0), isNull);
      expect(lockoutFor(1), isNull);
      expect(lockoutFor(4), isNull);
    });

    test('five wrong starts at 30 s and doubles', () {
      expect(lockoutFor(5), const Duration(seconds: 30));
      expect(lockoutFor(6), const Duration(seconds: 60));
      expect(lockoutFor(7), const Duration(seconds: 120));
      expect(lockoutFor(8), const Duration(seconds: 240));
    });

    test('the ninth and every later failure sit at the 5-minute cap', () {
      expect(lockoutFor(9), const Duration(minutes: 5));
      expect(lockoutFor(10), const Duration(minutes: 5));
      expect(lockoutFor(50), const Duration(minutes: 5));
      expect(lockoutFor(5000), const Duration(minutes: 5));
    });
  });

  group('the ticket', () {
    test('lives for 120 seconds, not a second more', () {
      final ticket = SecurityTicket(t0);
      expect(ticket.isValid(t0), isTrue);
      expect(ticket.isValid(t0.add(const Duration(seconds: 119))), isTrue);
      expect(ticket.isValid(t0.add(SecurityTicket.validity)), isTrue);
      expect(ticket.isValid(t0.add(const Duration(seconds: 121))), isFalse);
    });

    test('a ticket from the future is not valid — clocks cannot mint one',
        () {
      final ticket = SecurityTicket(t0);
      expect(ticket.isValid(t0.subtract(const Duration(seconds: 1))), isFalse);
    });
  });

  group('PBKDF2', () {
    test('is deterministic for the same pin and salt', () {
      final a = derivePinHash('492713', 'c29tZXNhbHQ=', 100);
      final b = derivePinHash('492713', 'c29tZXNhbHQ=', 100);
      expect(a, b);
    });

    test('a different salt or pin changes the key', () {
      final base = derivePinHash('492713', 'c29tZXNhbHQ=', 100);
      expect(derivePinHash('492713', 'b3RoZXJzYWx0', 100), isNot(base));
      expect(derivePinHash('492714', 'c29tZXNhbHQ=', 100), isNot(base));
    });

    test('is 32 bytes, base64 — the website demo-mode convention', () {
      final hash = derivePinHash('492713', 'c29tZXNhbHQ=', 100);
      expect(hash.length, 44); // base64 of 32 bytes with padding
      // 44 chars of base64 decode to exactly 32 bytes.
      // (3 bytes per 4 chars, minus 2 padding.)
    });

    test('more rounds give a different key for the same pin', () {
      final fast = derivePinHash('492713', 'c29tZXNhbHQ=', 100);
      final slow = derivePinHash('492713', 'c29tZXNhbHQ=', 200);
      expect(slow, isNot(fast));
    });

    test('pinHashMatches compares without length tricks', () {
      expect(pinHashMatches('abc', 'abc'), isTrue);
      expect(pinHashMatches('abc', 'abd'), isFalse);
      expect(pinHashMatches('abc', 'abcd'), isFalse);
    });
  });

  group('PinRecord maps', () {
    test('survive the device-cache round trip', () {
      const record = PinRecord(
        salt: 'c29tZXNhbHQ=',
        hash: 'aGVsbG8gd29ybGQgYQ==',
        iterations: 100000,
        failedAttempts: 3,
        lockedUntil: null,
        updatedAt: null,
      );
      final back = PinRecord.fromMap(record.toMap());
      expect(back, isNotNull);
      expect(back!.salt, record.salt);
      expect(back.hash, record.hash);
      expect(back.iterations, record.iterations);
      expect(back.failedAttempts, 3);
    });

    test('refuse a foreign algorithm instead of verifying against it', () {
      final back = PinRecord.fromMap({
        'algorithm': 'scrypt',
        'salt': 'c29tZXNhbHQ=',
        'hash': 'aGVsbG8=',
        'iterations': 100,
      });
      expect(back, isNull);
    });
  });

  group('PinGate with a MemoryPinStore', () {
    late MemoryPinStore store;
    late _RecordingRemote remote;
    late PinGate gate;

    setUp(() {
      store = MemoryPinStore();
      remote = _RecordingRemote();
      gate = PinGate(store: store, remote: remote);
    });

    test('setPin → verify round trip mints a fresh ticket', () async {
      final problem = await gate.setPin('admin-1', '492713',
          iterations: 100, now: t0);
      expect(problem, isNull);

      final result = await gate.verify('admin-1', '492713', now: t0);
      expect(result.outcome, PinVerifyOutcome.verified);
      expect(result.ticket, isNotNull);
      expect(result.ticket!.isValid(t0), isTrue);
      expect(gate.freshTicket(t0), same(result.ticket));
    });

    test('a wrong pin raises the counter, and the remote hears about it',
        () async {
      await gate.setPin('admin-1', '492713', iterations: 100, now: t0);

      final result = await gate.verify('admin-1', '000000', now: t0);
      expect(result.outcome, PinVerifyOutcome.wrongPin);
      expect(result.failedAttempts, 1);
      expect(result.lockedUntil, isNull);
      expect(remote.failures, hasLength(1));
      expect(remote.failures.first['failed_attempts'], 1);
    });

    test('five wrong entries lock, and the correct pin waits out the clock',
        () async {
      await gate.setPin('admin-1', '492713', iterations: 100, now: t0);

      var lockedUntil;
      for (var attempt = 1; attempt <= 5; attempt++) {
        final result = await gate.verify('admin-1', '000000', now: t0);
        expect(result.outcome, PinVerifyOutcome.wrongPin);
        expect(result.failedAttempts, attempt);
        lockedUntil = result.lockedUntil;
      }
      expect(lockedUntil, t0.add(const Duration(seconds: 30)));

      // Inside the window even the correct pin is refused — and the server
      // counter kept climbing.
      final during = await gate.verify('admin-1', '492713', now: t0);
      expect(during.outcome, PinVerifyOutcome.locked);

      // Past it, the correct pin opens.
      final after = await gate.verify(
          'admin-1', '492713', now: t0.add(const Duration(seconds: 31)));
      expect(after.outcome, PinVerifyOutcome.verified);
      expect(
        remote.failures.map((f) => f['failed_attempts']),
        [1, 2, 3, 4, 5],
      );
    });

    test('a success resets the device counter, not the server ratchet',
        () async {
      await gate.setPin('admin-1', '492713', iterations: 100, now: t0);
      await gate.verify('admin-1', '000000', now: t0);
      await gate.verify('admin-1', '492713', now: t0);

      // Device counter is back to zero: one wrong entry is attempt 1.
      final result = await gate.verify('admin-1', '000000', now: t0);
      expect(result.failedAttempts, 1);

      // The server copy keeps the born-zero record — the reconcile after a
      // success never rewrites a document whose hash matches.
      expect(remote.failures.map((f) => f['failed_attempts']), [1, 1]);
    });

    test('the ticket dies on clearTicket — the backgrounding boundary',
        () async {
      await gate.setPin('admin-1', '492713', iterations: 100, now: t0);
      await gate.verify('admin-1', '492713', now: t0);
      expect(gate.freshTicket(t0), isNotNull);
      gate.clearTicket();
      expect(gate.freshTicket(t0), isNull);
    });

    test('setupState: no record anywhere means first sign-in', () async {
      expect(await gate.setupState('admin-1'), PinSetupState.setUpNeeded);
    });

    test('setupState: a server record seeds the cache', () async {
      final otherGate = PinGate(store: store, remote: remote);
      await otherGate.setPin('admin-1', '246810', iterations: 100, now: t0);
      expect(remote.docs['admin-1'], isNotNull);

      // A second device (empty store) seeds from the server and verifies.
      final freshStore = MemoryPinStore();
      final secondDevice = PinGate(store: freshStore, remote: remote);
      expect(await secondDevice.setupState('admin-1'), PinSetupState.ready);
      final result =
          await secondDevice.verify('admin-1', '246810', now: t0);
      expect(result.outcome, PinVerifyOutcome.verified);
    });

    test('setupState: offline with no cache refuses to fail open', () async {
      remote.unreachable = true;
      expect(await gate.setupState('admin-1'), PinSetupState.unreachable);

      // And a verify against it answers unavailable, not verified.
      final result = await gate.verify('admin-1', '000000', now: t0);
      expect(result.outcome, PinVerifyOutcome.unavailable);
    });

    test('rotate replaces the hash; the old pin stops opening', () async {
      await gate.setPin('admin-1', '492713', iterations: 100, now: t0);
      await gate.setPin('admin-1', '135790', iterations: 100, now: t0);

      expect(
        (await gate.verify('admin-1', '492713', now: t0)).outcome,
        PinVerifyOutcome.wrongPin,
      );
      expect(
        (await gate.verify('admin-1', '135790', now: t0)).outcome,
        PinVerifyOutcome.verified,
      );
    });

    test('setPin refuses anything that is not six digits', () async {
      expect(await gate.setPin('admin-1', '49271', iterations: 100), isNotNull);
      expect(await gate.setPin('admin-1', '4927133', iterations: 100),
          isNotNull);
      expect(await gate.setPin('admin-1', '492713', iterations: 100), isNull);
    });
  });
}
