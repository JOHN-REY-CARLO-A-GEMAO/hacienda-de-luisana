// ----------------------------------------------------------------------------
// Finding the conversation a Guest and the Admin already have.
// ----------------------------------------------------------------------------
// The Admin app needs to answer one question from a Booking: "has this Guest
// written to us, and if so where?". The Bookings list is where an Admin looks
// when they want to answer something, so the message button on a Booking opens
// that thread directly rather than making them remember which inbox row it is.
//
// The lookup is a `where` query, and that is only possible **here**: the Admin
// is allowed to read every conversation, so Firestore can prove the query is
// safe. The Guest cannot do this — the website derives the id instead (see
// `AppConstants.conversationId`). The two are not redundant: the Admin does not
// know the Guest's category, so it has to look.
// ----------------------------------------------------------------------------

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/constants/app_constants.dart';

/// A conversation the Admin can open, and who it is with.
class GuestConversation {
  const GuestConversation({required this.id, required this.guestUid, required this.category, this.updatedAt});

  final String id;
  final String guestUid;
  final String category;
  final DateTime? updatedAt;

  /// Whether this is the thread a Booking is "about", as opposed to another
  /// topic the same Guest opened.
  bool get isBookingTopic => category == AppConstants.categoryBooking;
}

/// Every open thread this Guest has, newest first.
///
/// Returns empty rather than throwing when there is nothing to find: "this Guest
/// has never written to us" is an answer, not a failure, and the caller turns it
/// into a sentence rather than an error screen.
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

  final threads = snapshot.docs.map((doc) {
    final data = doc.data();
    final updated = data['updated_at'];
    return GuestConversation(
      id: doc.id,
      guestUid: (data['guest_uid'] ?? '').toString(),
      category: (data['category'] ?? AppConstants.categoryBooking).toString(),
      updatedAt: updated is Timestamp ? updated.toDate() : null,
    );
  }).toList();

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

/// The one thread to open for a Booking: the Guest's booking topic if they have
/// one, otherwise the most recent thing they wrote about, otherwise null.
///
/// Prefers the booking topic because that is what a Booking card is about —
/// opening a Guest's "Payment help" thread from their Booking card would be
/// surprising. The most recent fallback is there because many Guests write once
/// and it lands in whatever category they picked.
Future<GuestConversation?> threadForBooking(
  String guestUid, {
  FirebaseFirestore? firestore,
}) async {
  final threads = await conversationsWith(guestUid, firestore: firestore);
  if (threads.isEmpty) return null;
  for (final thread in threads) {
    if (thread.isBookingTopic) return thread;
  }
  return threads.first;
}
