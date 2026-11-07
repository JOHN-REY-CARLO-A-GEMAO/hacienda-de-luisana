// ----------------------------------------------------------------------------
// Chat limits and retention — the two decisions the Admin app shares with the
// website and with `firestore.rules`. They are pure functions of their
// arguments on purpose: a rule about how long a message may be is worth a test
// that needs no emulator, no device and no network. The Firestore rules that
// enforce them are in `firestore.rules`; their suite is `test/rules/`.
//
// NOTE: this file was authored in an environment with no Flutter SDK, so it has
// NOT been executed. Run `flutter test` before relying on it.
// ----------------------------------------------------------------------------
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/core/constants/app_constants.dart';
import 'package:hacienda_de_luisana/services/chat_attachment_service.dart';
import 'package:hacienda_de_luisana/services/chat_retention.dart';

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
    test('guest-wide retention requires every Booking to be closed', () {
      expect(guestConversationRetentionPatch(bookings: []), isNull);
      expect(guestConversationRetentionPatch(bookings: [
        (status: 'Completed', closedAt: closedAt),
        (status: 'Pending', closedAt: null),
      ]), isNull);
      expect(guestConversationRetentionPatch(bookings: [
        (status: 'Completed', closedAt: null),
      ]), isNull);
      final patch = guestConversationRetentionPatch(bookings: [
        (status: 'Cancelled', closedAt: DateTime.utc(2026, 11, 1)),
        (status: 'Completed', closedAt: closedAt),
      ]);
      expect(patch![kRetentionField], DateTime.utc(2027, 1, 30));
    });

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

}
