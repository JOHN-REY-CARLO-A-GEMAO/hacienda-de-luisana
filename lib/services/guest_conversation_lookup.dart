// ----------------------------------------------------------------------------
// Finding the conversation a Guest and the Admin already have.
// ----------------------------------------------------------------------------
// One continuous conversation per booking (`booking-<bookingId>`), with full
// non-destructive backward compatibility for earlier `inquiry-<uid>-<category>`
// threads so historical messages remain reachable.
//
// The Admin app answers one question from a Booking: "has this Guest written
// to us, and if so where?". The message button on a Booking opens that thread
// directly rather than making the Admin search the inbox manually.
// ----------------------------------------------------------------------------

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/constants/app_constants.dart';

/// A conversation the Admin can open, and the resolved Guest/Booking metadata
/// attached to it (without exposing raw internal IDs in UI labels).
class GuestConversation {
  const GuestConversation({
    required this.id,
    required this.guestUid,
    required this.guestName,
    this.bookingId,
    this.bookingReference,
    this.propertyName,
    this.category = AppConstants.categoryBooking,
    this.updatedAt,
    this.isLegacy = false,
  });

  final String id;
  final String guestUid;
  final String guestName;
  final String? bookingId;
  final String? bookingReference;
  final String? propertyName;
  final String category;
  final DateTime? updatedAt;
  final bool isLegacy;

  bool get isBookingTopic => category == AppConstants.categoryBooking;

  factory GuestConversation.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc, {
    String fallbackUid = '',
    String fallbackGuestName = 'Guest',
  }) {
    final data = doc.data() ?? const <String, dynamic>{};
    final updated = data['updated_at'];
    final rawName = data['guest_name']?.toString().trim() ?? '';
    final rawRef = data['booking_reference']?.toString().trim() ?? '';
    final rawProp = data['property_name']?.toString().trim() ?? '';
    final rawBookingId = data['booking_id']?.toString().trim() ?? '';
    final derivedBookingId = doc.id.startsWith('booking-')
        ? doc.id.substring('booking-'.length)
        : null;

    return GuestConversation(
      id: doc.id,
      guestUid: (data['guest_uid'] ?? fallbackUid).toString(),
      guestName: rawName.isNotEmpty ? rawName : fallbackGuestName,
      bookingId: rawBookingId.isNotEmpty ? rawBookingId : derivedBookingId,
      bookingReference: rawRef.isNotEmpty ? rawRef : null,
      propertyName: rawProp.isNotEmpty ? rawProp : null,
      category: (data['category'] ?? AppConstants.categoryBooking).toString(),
      updatedAt: updated is Timestamp ? updated.toDate() : null,
      isLegacy: doc.id.startsWith('inquiry-'),
    );
  }
}

/// Every open thread this Guest has, newest first.
///
/// Returns empty rather than throwing when there is nothing to find: "this Guest
/// has never written to us" is an answer, not a failure.
Future<List<GuestConversation>> conversationsWith(
  String guestUid, {
  FirebaseFirestore? firestore,
  int limit = 20,
}) async {
  final db = firestore ?? FirebaseFirestore.instance;
  final snapshot = await db
      .collection(AppConstants.colConversations)
      .where('guest_uid', isEqualTo: guestUid)
      .limit(limit)
      .get();

  final threads = snapshot.docs
      .map((doc) => GuestConversation.fromDoc(doc, fallbackUid: guestUid))
      .toList();

  threads.sort((a, b) {
    final at = a.updatedAt;
    final bt = b.updatedAt;
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return bt.compareTo(at);
  });
  return threads;
}

/// Resolves the conversation for a Booking:
/// 1. Checks the unified booking-scoped document (`booking-<bookingId>`) directly.
/// 2. Falls back to any existing conversation for [guestUid] (preferring a
///    booking-scoped or booking-category thread, then most recent activity) so
///    legacy `inquiry-<uid>-<category>` threads open cleanly without migration.
Future<GuestConversation?> threadForBooking(
  String guestUid, {
  String? bookingId,
  String? fallbackGuestName,
  FirebaseFirestore? firestore,
}) async {
  final db = firestore ?? FirebaseFirestore.instance;
  final defaultName = (fallbackGuestName != null && fallbackGuestName.trim().isNotEmpty)
      ? fallbackGuestName.trim()
      : 'Guest';

  if (bookingId != null && bookingId.isNotEmpty) {
    final doc = await db
        .collection(AppConstants.colConversations)
        .doc(AppConstants.conversationId(bookingId))
        .get();
    if (doc.exists) {
      return GuestConversation.fromDoc(
        doc,
        fallbackUid: guestUid,
        fallbackGuestName: defaultName,
      );
    }
  }

  if (guestUid.isEmpty) return null;

  final threads = await conversationsWith(guestUid, firestore: db);
  if (threads.isEmpty) return null;

  if (bookingId != null && bookingId.isNotEmpty) {
    for (final thread in threads) {
      if (thread.bookingId == bookingId) return thread;
    }
  }
  for (final thread in threads) {
    if (!thread.isLegacy) return thread;
  }
  for (final thread in threads) {
    if (thread.isBookingTopic) return thread;
  }
  return threads.first;
}
