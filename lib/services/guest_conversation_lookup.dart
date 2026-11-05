// ----------------------------------------------------------------------------
// Finding the conversation a Guest and the Admin already have.
// ----------------------------------------------------------------------------
// ONE conversation per Guest account (`guest-<uid>`). A Booking is context a
// single message carries, not a thread of its own, so a Guest with five
// reservations has one thread and the Admin sees the whole correspondence in
// one place.
//
// Superseded `booking-<bookingId>` and `inquiry-<uid>-<category>` threads are
// still readable — history is never dropped — and are preferred only when the
// canonical thread does not exist yet, which is the state before the migration
// has run for that Guest (`functions/src/guestConversationMigration.ts`).
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
    this.supersededBy,
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

  /// True when this is the account-wide conversation the Guest always has.
  bool get isCanonical => AppConstants.isGuestConversationId(id);

  /// True when a previous run has already folded this thread into the
  /// account conversation, so its history is there rather than here.
  bool get isSuperseded => supersededBy != null && supersededBy!.trim().isNotEmpty;

  /// Where this thread's history now lives, when it has been folded in.
  final String? supersededBy;

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
    final derivedBookingId = AppConstants.bookingIdFromConversationId(doc.id);
    final rawSuperseded = data['superseded_by'] is String
        ? (data['superseded_by'] as String).trim()
        : '';

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
      isLegacy: !AppConstants.isGuestConversationId(doc.id),
      supersededBy: rawSuperseded.isEmpty ? null : rawSuperseded,
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

/// The conversation a Guest has — the account-wide one, read directly by id.
///
/// Returns `null` when the Guest has never written and nothing exists yet, and
/// when the document at that id is not theirs. Never creates anything: opening a
/// thread is the Guest's side of the app, and the Admin can only read what is
/// already there.
Future<GuestConversation?> threadForGuest(
  String guestUid, {
  String? fallbackGuestName,
  FirebaseFirestore? firestore,
}) async {
  final uid = guestUid.trim();
  if (uid.isEmpty) return null;
  final db = firestore ?? FirebaseFirestore.instance;
  final defaultName = (fallbackGuestName != null && fallbackGuestName.trim().isNotEmpty)
      ? fallbackGuestName.trim()
      : 'Guest';
  try {
    final doc = await db
        .collection(AppConstants.colConversations)
        .doc(AppConstants.guestConversationId(uid))
        .get();
    if (!doc.exists) return null;
    final data = doc.data();
    if (data == null || data['guest_uid'] is! String ||
        (data['guest_uid'] as String).trim() != uid) {
      return null;
    }
    return GuestConversation.fromDoc(doc, fallbackGuestName: defaultName);
  } catch (_) {
    return null;
  }
}

/// Resolves the conversation for a Booking:
/// 1. The account-wide conversation (`guest-<uid>`) — the one a Guest actually
///    writes to, whichever Booking the message is about.
/// 2. Before that thread exists (a Guest whose history the migration has not
///    folded in yet), the superseded booking-scoped document, so old messages
///    stay reachable rather than appearing to have vanished.
/// 3. Recent, server-ordered Guest threads for legacy topic records.
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
    // One account, one thread. When it exists it holds every Booking's
    // correspondence, so there is nothing to look up per reservation.
    final canonical = await threadForGuest(
      uid,
      fallbackGuestName: defaultName,
      firestore: db,
    );
    if (canonical != null) return canonical;

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
