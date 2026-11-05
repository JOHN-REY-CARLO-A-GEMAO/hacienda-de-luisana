import 'package:flutter_test/flutter_test.dart';

import 'package:hacienda_de_luisana/core/constants/app_constants.dart';
import 'package:hacienda_de_luisana/services/guest_conversation_lookup.dart';

GuestConversation thread({
  required String id,
  required String guestUid,
  String? bookingId,
  String category = AppConstants.categoryBooking,
  DateTime? updatedAt,
  bool isLegacy = false,
  String? supersededBy,
}) => GuestConversation(
  id: id,
  guestUid: guestUid,
  guestName: 'Guest',
  bookingId: bookingId,
  category: category,
  updatedAt: updatedAt,
  isLegacy: isLegacy,
  supersededBy: supersededBy,
);

void main() {
  group('selectConversationCandidate', () {
    test('prefers the exact Booking relationship over a newer unrelated thread', () {
      final exact = thread(
        id: 'booking-target',
        guestUid: 'guest-1',
        bookingId: 'target',
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      final other = thread(
        id: 'booking-other',
        guestUid: 'guest-1',
        bookingId: 'other',
        updatedAt: DateTime.utc(2026, 2, 1),
      );

      expect(
        selectConversationCandidate([other, exact], guestUid: 'guest-1', bookingId: 'target'),
        same(exact),
      );
    });

    test('refuses duplicate exact Booking matches instead of guessing', () {
      final first = thread(id: 'thread-a', guestUid: 'guest-1', bookingId: 'target');
      final second = thread(id: 'thread-b', guestUid: 'guest-1', bookingId: 'target');

      expect(
        selectConversationCandidate([first, second], guestUid: 'guest-1', bookingId: 'target'),
        isNull,
      );
    });

    test('filters records owned by another Guest and picks the most recent valid thread', () {
      final recent = thread(
        id: 'newer',
        guestUid: 'guest-1',
        updatedAt: DateTime.utc(2026, 2, 1),
      );
      final older = thread(
        id: 'older',
        guestUid: 'guest-1',
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      final foreign = thread(
        id: 'foreign',
        guestUid: 'guest-2',
        updatedAt: DateTime.utc(2027, 1, 1),
      );

      expect(
        selectConversationCandidate([older, foreign, recent], guestUid: 'guest-1'),
        same(recent),
      );
    });

    test('uses stable document-id ordering for equal or missing timestamps', () {
      final laterId = thread(id: 'z-thread', guestUid: 'guest-1');
      final earlierId = thread(id: 'a-thread', guestUid: 'guest-1');

      expect(
        selectConversationCandidate([laterId, earlierId], guestUid: 'guest-1'),
        same(earlierId),
      );
    });

    test('returns null for an empty Guest identity or no valid candidates', () {
      expect(selectConversationCandidate([], guestUid: 'guest-1'), isNull);
      expect(selectConversationCandidate([thread(id: 'x', guestUid: 'guest-1')], guestUid: ''), isNull);
      expect(selectConversationCandidate([thread(id: '', guestUid: 'guest-1')], guestUid: 'guest-1'), isNull);
    });

    test('retains the legacy booking-topic fallback when no current thread exists', () {
      final booking = thread(
        id: 'inquiry-guest-booking',
        guestUid: 'guest-1',
        category: AppConstants.categoryBooking,
        isLegacy: true,
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      final other = thread(
        id: 'inquiry-guest-general',
        guestUid: 'guest-1',
        category: 'general',
        isLegacy: true,
        updatedAt: DateTime.utc(2026, 2, 1),
      );

      expect(selectConversationCandidate([other, booking], guestUid: 'guest-1'), same(booking));
    });
  });

  // -------------------------------------------------------------------------
  // One conversation per Guest account.
  //
  // The Admin app opens the same document the website writes to. The formula
  // lives in AppConstants and is mirrored by `guestConversationId` in
  // `src/lib/conversationIdentity.ts`; if the two ever drift, a Guest's
  // messages land in a thread the Admin is not reading.
  // -------------------------------------------------------------------------
  group('conversation identity', () {
    test('derives the account conversation id from the uid, not a booking', () {
      expect(AppConstants.guestConversationId('guest-1'), 'guest-guest-1');
      expect(AppConstants.guestConversationId('guest-1'),
          AppConstants.guestConversationId('guest-1'));
      expect(AppConstants.guestConversationId('guest-2'),
          isNot(AppConstants.guestConversationId('guest-1')));
    });

    test('recognises the canonical id and reads the superseded shapes', () {
      expect(AppConstants.isGuestConversationId('guest-guest-1'), isTrue);
      expect(AppConstants.isGuestConversationId('booking-bk_1'), isFalse);
      expect(AppConstants.isGuestConversationId('inquiry-guest-1-general'), isFalse);

      expect(AppConstants.isLegacyBookingConversationId('booking-bk_1'), isTrue);
      expect(AppConstants.isLegacyBookingConversationId('guest-guest-1'), isFalse);
      expect(AppConstants.bookingIdFromConversationId('booking-bk_1'), 'bk_1');
      expect(AppConstants.bookingIdFromConversationId('booking-'), isNull);
      expect(AppConstants.bookingIdFromConversationId('guest-guest-1'), isNull);
    });

    test('a thread is canonical only when it is the account conversation', () {
      final canonical = thread(id: 'guest-guest-1', guestUid: 'guest-1');
      final booking = thread(id: 'booking-bk_1', guestUid: 'guest-1');

      expect(canonical.isCanonical, isTrue);
      expect(booking.isCanonical, isFalse);
    });

    test('marks a thread whose history has been folded in, without deleting it', () {
      final merged = thread(
        id: 'booking-bk_1',
        guestUid: 'guest-1',
        supersededBy: 'guest-guest-1',
      );
      final live = thread(id: 'booking-bk_2', guestUid: 'guest-1');

      expect(merged.isSuperseded, isTrue);
      expect(merged.supersededBy, 'guest-guest-1');
      expect(live.isSuperseded, isFalse);
    });
  });
}
