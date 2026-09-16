import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/door_key.dart';
import 'package:hacienda_de_luisana/services/esp32_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

const secret = 'test-property-secret';

DoorKeyToken testToken() => DoorKey.issue(
      uid: 'anon-1',
      refId: 'HDL-260920-T4ST',
      accommodationId: 'main-house',
      checkInDate: DateTime(2026, 9, 20),
      checkOutDate: DateTime(2026, 9, 22),
      secret: secret,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    // Flush stale async prefs writes from the previous test, then reset —
    // SharedPreferences mocks are process-global, so without this a late
    // write lands mid-test and pollutes the log under test.
    SharedPreferences.setMockInitialValues({});
    await Future.delayed(const Duration(milliseconds: 10));
    SharedPreferences.setMockInitialValues({});
  });

  group('time-windowed token (offline verify)', () {
    test('grace allows +30min but denies +2hr past checkout', () {
      final t = testToken(); // validTo = Sep 22 12:00 + 1hr = 13:00
      expect(t.validFrom, DateTime(2026, 9, 20, 14));
      expect(t.validTo, DateTime(2026, 9, 22, 13));
      expect(DoorKey.verify(t, secret, now: DateTime(2026, 9, 22, 12, 30)),
          isTrue);
      expect(DoorKey.verify(t, secret, now: DateTime(2026, 9, 22, 14)),
          isFalse);
    });

    test('expired token denies offline', () {
      final t = testToken();
      expect(DoorKey.verify(t, secret, now: DateTime(2026, 9, 23, 10)),
          isFalse);
      expect(DoorKey.verify(t, secret, now: DateTime(2026, 9, 19, 10)),
          isFalse); // before validFrom
    });

    test('tampered payload denies (signature mismatch)', () {
      final t = testToken();
      final forged = DoorKeyToken(
        uid: 'attacker',
        refId: t.refId,
        accommodationId: t.accommodationId,
        validFrom: t.validFrom,
        validTo: t.validTo,
        issuedAt: t.issuedAt,
        nonce: t.nonce,
        signature: t.signature,
      );
      expect(
          DoorKey.verify(forged, secret, now: DateTime(2026, 9, 21, 10)),
          isFalse);
    });

    test('wrong secret denies', () {
      final t = testToken();
      expect(DoorKey.verify(t, 'wrong-secret', now: DateTime(2026, 9, 21, 10)),
          isFalse);
    });
  });

  group('challenge-response (not proximity)', () {
    test('fresh answer verifies; stale challenge fails', () {
      final t = testToken();
      const c1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const c2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      final a1 = DoorKey.answerChallenge(
          token: t, secret: secret, challengeHex: c1);
      expect(
          DoorKey.verifyResponse(
              token: t, secret: secret, challengeHex: c1, responseHex: a1),
          isTrue);
      // Replay of a1 against a new challenge fails.
      expect(
          DoorKey.verifyResponse(
              token: t, secret: secret, challengeHex: c2, responseHex: a1),
          isFalse);
      expect(
          DoorKey.verifyResponse(
              token: t, secret: secret, challengeHex: '', responseHex: a1),
          isFalse);
    });
  });

  group('lockout: 3 fails / 10min → 15min cooldown', () {
    test('locks after third fail, clears after cooldown', () async {
      final svc = Esp32Service();
      addTearDown(svc.dispose);
      final base = DateTime(2026, 9, 20, 10, 0);
      expect(svc.isLockedOut(base), isFalse);
      svc.recordFailure(at: base);
      svc.recordFailure(at: base.add(const Duration(minutes: 3)));
      expect(svc.isLockedOut(base.add(const Duration(minutes: 3))), isFalse);
      svc.recordFailure(at: base.add(const Duration(minutes: 6)));
      expect(svc.isLockedOut(base.add(const Duration(minutes: 6))), isTrue);
      final until = svc.lockoutUntil(base.add(const Duration(minutes: 6)));
      expect(until, base.add(const Duration(minutes: 21)));
      // 16 minutes after the third failure → cooldown over.
      expect(svc.isLockedOut(base.add(const Duration(minutes: 22))), isFalse);
    });

    test('locked request denies fast with lockout reason + logs', () async {
      final svc = Esp32Service();
      addTearDown(svc.dispose);
      final base = DateTime(2026, 9, 20, 10, 0);
      svc.recordFailure(at: base);
      svc.recordFailure(at: base.add(const Duration(minutes: 1)));
      svc.recordFailure(at: base.add(const Duration(minutes: 2)));
      final out = await svc.requestUnlock(
        uid: 'anon-1',
        refId: 'HDL-X',
        tokenValid: true,
        now: base.add(const Duration(minutes: 3)),
      );
      expect(out.granted, isFalse);
      expect(out.reason, contains('locked until'));
      expect(svc.logs.last.granted, isFalse);
      expect(svc.logs.last.uid, 'anon-1');
    });

    test('old failures outside 10min window do not lock', () async {
      final svc = Esp32Service();
      addTearDown(svc.dispose);
      final base = DateTime(2026, 9, 20, 10, 0);
      svc.recordFailure(at: base);
      svc.recordFailure(at: base.add(const Duration(minutes: 30)));
      svc.recordFailure(at: base.add(const Duration(minutes: 60)));
      expect(svc.isLockedOut(base.add(const Duration(minutes: 60))), isFalse);
    });
  });

  group('master override hook', () {
    test('bypasses lockout and logs master-override', () async {
      final svc = Esp32Service();
      addTearDown(svc.dispose);
      svc.masterVerifier = (code) => code == '0000';
      final base = DateTime(2026, 9, 20, 10, 0);
      svc.recordFailure(at: base);
      svc.recordFailure(at: base.add(const Duration(minutes: 1)));
      svc.recordFailure(at: base.add(const Duration(minutes: 2)));
      expect(svc.isLockedOut(base.add(const Duration(minutes: 3))), isTrue);
      final out = await svc.masterUnlock('0000',
          uid: 'host', refId: '', now: base.add(const Duration(minutes: 3)));
      expect(out.granted, isTrue);
      expect(svc.logs.last.reason, 'master-override');
    });

    test('wrong master code denies (and counts a failure)', () async {
      final svc = Esp32Service();
      addTearDown(svc.dispose);
      svc.masterVerifier = (code) => code == '0000';
      final out = await svc.masterUnlock('9999',
          now: DateTime(2026, 9, 20, 10, 0));
      expect(out.granted, isFalse);
    });
  });

  group('access log buffer', () {
    test('denied attempt logs timestamp/uid/result, queued for sync',
        () async {
      final svc = Esp32Service();
      addTearDown(svc.dispose);
      final at = DateTime(2026, 9, 20, 10, 0);
      final out = await svc.requestUnlock(
          uid: 'anon-7', refId: 'HDL-7', tokenValid: false, now: at);
      expect(out.granted, isFalse);
      final last = svc.logs.last;
      expect(last.uid, 'anon-7');
      expect(last.timestamp, at);
      expect(last.synced, isFalse);
      expect(svc.pendingSyncCount, greaterThan(0));
      final flushed = await svc.syncLogs((batch) async {
        expect(batch.first['result'], 'denied');
        expect(batch.first['uid'], 'anon-7');
        return true;
      });
      expect(flushed, svc.logs.length);
      expect(svc.pendingSyncCount, 0);
    });
  });
}
