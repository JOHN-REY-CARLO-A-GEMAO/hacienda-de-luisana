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
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/core/constants/app_constants.dart';
import 'package:hacienda_de_luisana/services/chat_attachment_service.dart';
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

    test('derives booking-scoped conversation ids identically to the website', () {
      expect(AppConstants.conversationId('bk_42'), 'booking-bk_42');
      expect(AppConstants.legacyConversationId('u1', 'booking'), 'inquiry-u1-booking');
      expect(
        AppConstants.resortDirectionsUrl,
        'https://www.google.com/maps/dir/?api=1&destination=14.1754304,121.519389',
      );
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

  group('private chat attachment metadata', () {
    test('accepts the same private path, MIME type and size as the website', () {
      final attachment = ChatAttachment.fromMessage({
        'attachment': {
          'path': 'messageAttachments/convo-1/message-1',
          'content_type': 'image/png',
          'size': 1024,
        },
      });
      expect(attachment, isNotNull);
      expect(attachment!.contentType, 'image/png');
      expect(attachment.path, 'messageAttachments/convo-1/message-1');
      expect(kChatImageMaxBytes, 5 * 1024 * 1024);
    });

    test('refuses public paths, unsupported types and oversized metadata', () {
      for (final attachment in [
        {'path': 'gallery/public.png', 'content_type': 'image/png', 'size': 4},
        {'path': 'messageAttachments/convo-1/message-1', 'content_type': 'image/gif', 'size': 4},
        {'path': 'messageAttachments/convo-1/message-1', 'content_type': 'image/png', 'size': kChatImageMaxBytes + 1},
      ]) {
        expect(ChatAttachment.fromMessage({'attachment': attachment}), isNull);
      }
    });
  });

  group('live location consent parsing', () {
    test('reads stream_secret from Firestore and session_secret only from a fix', () {
      final now = DateTime.now();
      final session = LiveLocationSession.fromData('convo-1', {
        'guest_uid': 'guest-uid-1',
        'stream_secret': 'a' * 32,
        'started_at': Timestamp.fromDate(now.subtract(const Duration(minutes: 1))),
        'expires_at': Timestamp.fromDate(now.add(const Duration(minutes: 29))),
        'active': true,
      });
      expect(session, isNotNull);
      expect(session!.streamSecret, 'a' * 32);
      expect(session.conversationId, 'convo-1');
    });

    test('does not mistake the fix field name for the consent field name', () {
      final now = DateTime.now();
      expect(LiveLocationSession.fromData('convo-1', {
        'guest_uid': 'guest-uid-1',
        'session_secret': 'a' * 32,
        'started_at': Timestamp.fromDate(now),
        'expires_at': Timestamp.fromDate(now.add(const Duration(minutes: 30))),
        'active': true,
      }), isNull);
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

  group('a watch ending always has words for the Admin', () {
    test('every stop reason maps to a sentence, not a spinner', () {
      // The panel used to render every failure as "Waiting for the Guest's
      // first position…" forever. Each ending now has its own sentence, and
      // this holds the mapping to one line per reason — no empty strings, no
      // shared fallback that could quietly become a spinner again.
      final messages = {
        for (final reason in LiveLocationStop.values) reason: liveLocationStopMessage(reason),
      };
      expect(messages.values.every((m) => m.trim().isNotEmpty), isTrue);
      expect(messages.values.toSet().length, LiveLocationStop.values.length);
      expect(messages[LiveLocationStop.denied], contains('allowlisted Admin'));
      expect(messages[LiveLocationStop.expired], contains('stopped sharing'));
    });

    test('a view keeps the last position through the ending', () {
      // When a share stops, the map must not vanish with it: the Admin is
      // shown where the Guest last was, labelled as ended.
      final fix = LiveFix(lat: 14.1, lng: 121.3, accuracyM: 12, at: DateTime.now(), seq: 3);
      final view = LiveLocationView(LiveLocationPhase.ended, fix: fix, reason: LiveLocationStop.expired);
      expect(view.fix, same(fix));
      expect(view.reason, LiveLocationStop.expired);
      expect(const LiveLocationView(LiveLocationPhase.waiting).fix, isNull);
    });
  });
}
