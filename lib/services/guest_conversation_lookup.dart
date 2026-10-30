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
    final rawName = data['guest_name'] is String ? (data['guest_name'] as String).trim() : '';
    final rawRef = data['booking_reference'] is String
        ? (data['booking_reference'] as String).trim()
        : '';
    final rawProp = data['property_name'] is String
        ? (data['property_name'] as String).trim()
        : '';
    final rawBookingId = data['booking_id'] is String
        ? (data['booking_id'] as String).trim()
        : '';
    final derivedBookingId = doc.id.startsWith('booking-')
        ? doc.id.substring('booking-'.length)
        : null;

    return GuestConversation(
      id: doc.id,
      guestUid: data['guest_uid'] is String ? (data['guest_uid'] as String).trim() : fallbackUid,
      guestName: rawName.isNotEmpty ? rawName : fallbackGuestName,
      bookingId: rawBookingId.isNotEmpty ? rawBookingId : derivedBookingId,
      bookingReference: rawRef.isNotEmpty ? rawRef : null,
      propertyName: rawProp.isNotEmpty ? rawProp : null,
      category: data['category'] is String && (data['category'] as String).trim().isNotEmpty
          ? (data['category'] as String).trim()
          : AppConstants.categoryBooking,
      updatedAt: updated is Timestamp ? updated.toDate() : null,
      isLegacy: doc.id.startsWith('inquiry-'),
    );
  }
}

/// Pick safely from a list already scoped to one Guest. Input ordering is not
/// trusted: exact Booking relations win; remaining choices are deterministic,
/// newest-first, then document id. Multiple exact matches are ambiguous and are
/// deliberately not guessed between.
GuestConversation? selectConversationCandidate(
  Iterable<GuestConversation> threads, {
  required String guestUid,
  String? bookingId,
}) {
  final uid = guestUid.trim();
  if (uid.isEmpty) return null;
  final candidates = threads
      .where((thread) => thread.guestUid == uid && thread.id.trim().isNotEmpty)
      .toList()
    ..sort((a, b) {
      final at = a.updatedAt;
      final bt = b.updatedAt;
      if (at == null && bt != null) return 1;
      if (at != null && bt == null) return -1;
      final byTime = at == null || bt == null ? 0 : bt.compareTo(at);
      return byTime != 0 ? byTime : a.id.compareTo(b.id);
    });
  if (candidates.isEmpty) return null;

  final requestedBooking = bookingId?.trim();
  if (requestedBooking != null && requestedBooking.isNotEmpty) {
    final exact = candidates.where((thread) => thread.bookingId == requestedBooking).toList();
    if (exact.length == 1) return exact.single;
    if (exact.length > 1) return null;
  }

  final currentThreads = candidates.where((thread) => !thread.isLegacy).toList();
  if (currentThreads.isNotEmpty) return currentThreads.first;

  final bookingTopics = candidates.where((thread) => thread.isBookingTopic).toList();
  if (bookingTopics.isNotEmpty) return bookingTopics.first;
  return candidates.first;
}

/// Every open thread this Guest has, newest first.
///
/// Results are ordered on Firestore before the limit is applied. Records with
/// missing or malformed ownership metadata are ignored rather than assigned to
/// the requested Guest by a fallback value. Read failures return an empty list
/// so callers can safely render the "no thread" state.
Future<List<GuestConversation>> conversationsWith(
  String guestUid, {
  FirebaseFirestore? firestore,
  int limit = 20,
}) async {
  final uid = guestUid.trim();
  if (uid.isEmpty || limit <= 0) return const [];
  final db = firestore ?? FirebaseFirestore.instance;
  try {
    final snapshot = await db
        .collection(AppConstants.colConversations)
        .where('guest_uid', isEqualTo: uid)
        .orderBy('updated_at', descending: true)
        .limit(limit)
        .get();

    return snapshot.docs.where((doc) {
      final data = doc.data();
      final owner = data['guest_uid'];
      final category = data['category'];
      return doc.id.trim().isNotEmpty &&
          owner is String &&
          owner.trim() == uid &&
          (category == null || (category is String && category.trim().isNotEmpty));
    }).map((doc) => GuestConversation.fromDoc(doc)).toList();
  } catch (_) {
    return const [];
  }
}

/// Resolves the conversation for a Booking:
/// 1. Checks the unified booking-scoped document (`booking-<bookingId>`) directly.
/// 2. Queries the exact Guest/Booking relationship (without a result cap that
///    could hide it), refusing duplicates rather than opening an ambiguous one.
/// 3. Falls back to recent, server-ordered Guest threads for legacy records.
///
/// Missing records, malformed ownership fields and Firebase read failures are
/// represented as `null`; no conversation belonging to a different Guest is
/// ever returned as a fallback.
Future<GuestConversation?> threadForBooking(
  String guestUid, {
  String? bookingId,
  String? fallbackGuestName,
  FirebaseFirestore? firestore,
}) async {
  final uid = guestUid.trim();
  if (uid.isEmpty) return null;
  final db = firestore ?? FirebaseFirestore.instance;
  final defaultName = (fallbackGuestName != null && fallbackGuestName.trim().isNotEmpty)
      ? fallbackGuestName.trim()
      : 'Guest';
  final requestedBooking = bookingId?.trim();

  try {
    if (requestedBooking != null && requestedBooking.isNotEmpty) {
      final conversations = db.collection(AppConstants.colConversations);
      final direct = await conversations.doc(AppConstants.conversationId(requestedBooking)).get();
      if (direct.exists) {
        final data = direct.data();
        if (data == null || data['guest_uid'] is! String ||
            (data['guest_uid'] as String).trim() != uid) {
          return null;
        }
        final storedBooking = data['booking_id'];
        if (storedBooking != null &&
            (storedBooking is! String || storedBooking.trim() != requestedBooking)) {
          return null;
        }
        return GuestConversation.fromDoc(
          direct,
          fallbackGuestName: defaultName,
        );
      }

      // A legacy/non-deterministic record may still explicitly carry the exact
      // relationship. Two such records are ambiguous: do not pick one at random.
      final exact = await conversations
          .where('guest_uid', isEqualTo: uid)
          .where('booking_id', isEqualTo: requestedBooking)
          .limit(2)
          .get();
      if (exact.docs.length > 1) return null;
      if (exact.docs.length == 1) {
        final doc = exact.docs.single;
        final data = doc.data();
        if (data['guest_uid'] is! String ||
            (data['guest_uid'] as String).trim() != uid ||
            data['booking_id'] is! String ||
            (data['booking_id'] as String).trim() != requestedBooking ||
            doc.id.trim().isEmpty) {
          return null;
        }
        return GuestConversation.fromDoc(doc, fallbackGuestName: defaultName);
      }
    }

    final threads = await conversationsWith(uid, firestore: db);
    return selectConversationCandidate(
      threads,
      guestUid: uid,
      bookingId: requestedBooking,
    );
  } catch (_) {
    return null;
  }
}
