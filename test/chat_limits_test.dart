// ----------------------------------------------------------------------------
// Chat limits, retention, and the live-location acceptance test — the three
// decisions the Admin app shares with the website and with `firestore.rules`.
//
// These are pure functions of their arguments on purpose: a rule about who may
// see a Guest's position, or how long a message may be, is worth a test that
// needs no emulator, no device and no network. The Firestore and Realtime
// Database rules that enforce them are in `firestore.rules` and
// `database.rules.json`; their suites are `test/rules/` and `test/emulator/`.
//
// NOTE: this file was authored in an environment with no Flutter SDK, so it has
// NOT been executed. Run `flutter test` before relying on it.
// ----------------------------------------------------------------------------
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/core/constants/app_constants.dart';
import 'package:hacienda_de_luisana/services/chat_retention.dart';
import 'package:hacienda_de_luisana/services/live_location_service.dart';

void main() {
  final closedAt = DateTime.utc(2026, 10, 1);

  group('a message may be 1,000 characters', () {
    test('the limit is the one the website and the rules use', () {
      // 1,000 in `src/lib/validation.ts` (MESSAGE_MAX), in
      // `firestore.rules` (`text.size() <= 1000`) and here. Three places, one
      // number: the rules are the enforcement and the other two are the courtesy.
      expect(AppConstants.messageMax, 1000);
    });
  });

  group('retention', () {
    test('stamps nothing while a Booking is still live', () {
      for (final status in ['Pending', 'Approved', 'Checked-In', 'Staying', 'Reserved']) {
        expect(retentionPatch(status: status, closedAt: closedAt), isNull,
            reason: '$status is not terminal');
      }
    });

    test('stamps ninety days after a terminal status', () {
      final patch = retentionPatch(status: 'Completed', closedAt: closedAt);
      expect(patch, isNotNull);
      expect(patch![kRetentionField], DateTime.utc(2026, 12, 30));
      expect(kChatRetentionDays, 90);
    });

    test('stamps every terminal branch', () {
      for (final status in kRetentionEligibleStatuses) {
        expect(retentionPatch(status: status, closedAt: closedAt), isNotNull);
      }
    });

    test('never moves the expiry into the past', () {
      expect(retentionExpiry(closedAt, days: 0), DateTime.utc(2026, 10, 2));
      expect(retentionExpiry(closedAt, days: -5), DateTime.utc(2026, 10, 2));
    });

    test('reports the window as elapsed only once it has passed', () {
      final now = DateTime.utc(2026, 12, 1);
      expect(retentionElapsed(null, now: now), isFalse);
      expect(retentionElapsed(DateTime.utc(2026, 12, 30), now: now), isFalse);
      expect(retentionElapsed(DateTime.utc(2026, 11, 30), now: now), isTrue);
      expect(retentionDaysLeft(DateTime.utc(2026, 12, 31), now: now), 30);
      expect(retentionDaysLeft(DateTime.utc(2026, 11, 30), now: now), 0);
      expect(retentionDaysLeft(null, now: now), isNull);
    });
  });

  group('a position is only drawn when it belongs to this session', () {
    final now = DateTime.now();
    final session = LiveLocationSession(
      conversationId: 'convo-1',
      guestUid: 'guest-uid-1',
      streamSecret: 'a' * 32,
      startedAt: now.subtract(const Duration(minutes: 2)),
      expiresAt: now.add(const Duration(minutes: 28)),
      active: true,
    );
    final atMs = now.millisecondsSinceEpoch;
    final expiresMs = session.expiresAt.millisecondsSinceEpoch;

    Map<String, Object?> fix({Object? secret, Object? guest, Object? convo, Object? at, Object? lat}) {
      return <String, Object?>{
        'lat': lat ?? 14.1,
        'lng': 121.3,
        'accuracy_m': 12,
        'at_ms': at ?? atMs,
        'seq': 1,
        'guest_uid': guest ?? 'guest-uid-1',
        'conversation_id': convo ?? 'convo-1',
        'session_secret': secret ?? 'a' * 32,
        'expires_at_ms': expiresMs,
      };
    }

    test('renders a live fix that matches the consent', () {
      final parsed = LiveFix.fromData(fix(), session);
      expect(parsed, isNotNull);
      expect(parsed!.lat, closeTo(14.1, 0.0001));
    });

    test('refuses a node whose secret does not match', () {
      expect(LiveFix.fromData(fix(secret: 'b' * 32), session), isNull);
    });

    test("refuses another Guest's position and another conversation's", () {
      expect(LiveFix.fromData(fix(guest: 'guest-uid-2'), session), isNull);
      expect(LiveFix.fromData(fix(convo: 'convo-9'), session), isNull);
    });

    test('refuses a node dated past the window, and one from the future', () {
      expect(LiveFix.fromData(fix(at: expiresMs + 1000), session), isNull);
      expect(
        LiveFix.fromData(fix(at: now.add(const Duration(minutes: 5)).millisecondsSinceEpoch), session),
        isNull,
      );
    });

    test('refuses a position outside the world, and a node shaped like nothing', () {
      expect(LiveFix.fromData(fix(lat: 91), session), isNull);
      expect(LiveFix.fromData(null, session), isNull);
      expect(LiveFix.fromData(<String, Object?>{'lat': 14.1}, session), isNull);
    });

    test('refuses an expired session even if the node has not been swept', () {
      final closed = LiveLocationSession(
        conversationId: 'convo-1',
        guestUid: 'guest-uid-1',
        streamSecret: 'a' * 32,
        startedAt: now.subtract(const Duration(hours: 1)),
        expiresAt: now.subtract(const Duration(seconds: 1)),
        active: true,
      );
      expect(closed.isLive, isFalse);
      expect(LiveFix.fromData(fix(), closed), isNull);
    });

    test('refuses a session the Guest already stopped', () {
      final stopped = LiveLocationSession(
        conversationId: 'convo-1',
        guestUid: 'guest-uid-1',
        streamSecret: 'a' * 32,
        startedAt: now.subtract(const Duration(minutes: 2)),
        expiresAt: now.add(const Duration(minutes: 28)),
        active: false,
      );
      expect(LiveFix.fromData(fix(), stopped), isNull);
    });

    test("words a fix's age the way the panel shows it", () {
      final fresh = LiveFix.fromData(fix(), session)!;
      expect(fresh.isStale, isFalse);
      final old = LiveFix(lat: 14.1, lng: 121.3, accuracyM: 12, at: now.subtract(const Duration(minutes: 3)), seq: 9);
      expect(old.isStale, isTrue);
      expect(old.ageLabel, '3 minutes ago');
    });

    test('counts a live session down, and never below zero', () {
      expect(session.isLive, isTrue);
      expect(session.remaining.inMinutes, greaterThanOrEqualTo(27));
      final ended = LiveLocationSession(
        conversationId: 'convo-1',
        guestUid: 'guest-uid-1',
        streamSecret: 'a' * 32,
        startedAt: now.subtract(const Duration(hours: 1)),
        expiresAt: now.subtract(const Duration(minutes: 5)),
        active: true,
      );
      expect(ended.countdown, '0:00');
    });
  });
}
