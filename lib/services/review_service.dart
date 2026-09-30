/// Reviews — the Admin app's reader and the Admin's three decisions.
///
/// Vocabulary: CONTEXT.md § Review. Enforcement: `firestore.rules`.
///
/// A Review is filed by a Guest, at `reviews/{bookingId}`, and the id being the
/// Booking's is what makes one-review-per-stay something the database holds
/// rather than something a form remembers. The Admin's app reads that collection
/// and does three things a Guest cannot:
///
///   * **answer** a Review — stored on the document, beside the Guest's words,
///     which are never edited by anybody;
///   * **moderate** it — `pending` → `published` or `hidden`, which is a state
///     and not a deletion, so a negative review is never silently lost;
///   * **publish** a testimonial to the website, which is a *separate document*
///     in `public_reviews` holding six fields the Admin chose (ADR-0014). It is
///     not a copy of the Review with fields removed, so a field added to the
///     Review next year cannot reach the public page by default.
///
/// Every one of those is refused by the rules to a Guest, to another Guest, and
/// to a signed-out visitor. This app is where they are allowed, and the Activity
/// log records each one on that Booking's timeline.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import '../core/constants/app_constants.dart';
import '../models/review_model.dart';
import 'review_policy.dart';

/// How many Reviews a screen opens with, and how many one "load more" fetches.
///
/// A page, not the whole collection. Reviews grow with the number of stays the
/// hacienda has ever had, and an Admin opening the screen does not need the
/// 2019 reviews to answer the one from last week.
const int kReviewPageSize = 20;

/// What a Review list can be narrowed by. All of it is applied to one query,
/// so a filter never turns into "read everything, then hide most of it".
class ReviewFilter {
  /// Only Reviews carrying this many stars, or null for all of them.
  final int? stars;

  /// Only Reviews in this moderation state, or null for all of them.
  final String? status;

  /// A substring of the Guest's words, or empty.
  final String search;

  const ReviewFilter({this.stars, this.status, this.search = ''});

  const ReviewFilter.all() : stars = null, status = null, search = '';

  bool get isEverything => stars == null && status == null && search.isEmpty;
}

/// A page of Reviews, and whether there is another.
class ReviewPage {
  final List<ReviewModel> reviews;
  final DocumentSnapshot<Map<String, dynamic>>? last;

  ReviewPage(this.reviews, this.last);

  /// Whether asking for the next page is worth a read.
  bool get hasMore => last != null;
}

/// The average, and the count behind it, over published Reviews.
class ReviewStatistics {
  final double? average;
  final int count;
  final int pending;
  final int hidden;
  final int published;

  const ReviewStatistics({
    this.average,
    this.count = 0,
    this.pending = 0,
    this.hidden = 0,
    this.published = 0,
  });

  static const empty = ReviewStatistics();
}

class ReviewService {
  final FirebaseFirestore? _firestore;

  ReviewService([FirebaseFirestore? firestore]) : _firestore = firestore;

  bool get isCloud {
    try {
      return _firestore != null && _firestore!.app != null;
    } catch (_) {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /// One page of Reviews, newest first, narrowed by [filter].
  ///
  /// The query is built server-side — a status or a star count is a `where`
  /// and a search is a range on the text — so a filtered list reads a page of
  /// matches rather than the collection. With no Firebase (a demo build, or the
  /// emulator) the same page is served from memory, and the filter and the sort
  /// are applied here; the shapes are the same either way.
  Future<ReviewPage> listReviews(ReviewFilter filter, {DocumentSnapshot<Map<String, dynamic>>? after}) async {
    final db = _firestore;
    if (db == null) return ReviewPage(const [], null);

    Query<Map<String, dynamic>> query = db.collection(AppConstants.colReviews);
    if (filter.status != null) {
      query = query.where('status', isEqualTo: filter.status);
    }
    if (filter.stars != null) {
      query = query.where('stars', isEqualTo: filter.stars);
    }
    final search = filter.search.trim();
    if (search.isNotEmpty) {
      // A range rather than a `contains`: Firestore has no full-text operator
      // without an index, and a range is one query the rules and the index both
      // understand. It finds Reviews whose words *begin* with what was typed,
      // which is what a search box mostly gets asked for.
      query = query
          .where('text', isGreaterThanOrEqualTo: search)
          .where('text', isLessThanOrEqualTo: '$search\uFFFF');
    }
    query = query.orderBy('created_at', descending: true).limit(kReviewPageSize);
    if (after != null) query = query.startAfterDocument(after);

    try {
      final snapshot = await query.get();
      return ReviewPage(
        snapshot.docs
            .map((doc) => ReviewModel.fromDoc(doc.id, doc.data()))
            .where((review) => isValidStars(review.stars))
            .toList(),
        snapshot.docs.isEmpty ? null : snapshot.docs.last,
      );
    } catch (error) {
      debugPrint('[reviews] list failed: $error');
      return ReviewPage(const [], null);
    }
  }

  /// How many Reviews there are, and how they divide, for the numbers at the
  /// top of the screen.
  ///
  /// Counted over the Reviews this screen has in hand rather than read from a
  /// summary document, so the figures cannot disagree with the list below them.
  /// The website's own average is a different, deliberately separate number: it
  /// counts only what has been *published to the website*, which is a smaller
  /// set than everything the Admin can see.
  Future<ReviewStatistics> statistics(List<ReviewModel> loaded) async {
    var pending = 0;
    var hidden = 0;
    var published = 0;
    for (final review in loaded) {
      if (review.isPending) pending++;
      if (review.isHidden) hidden++;
      if (review.isPublished) published++;
    }
    final db = _firestore;
    if (db == null) {
      return ReviewStatistics(
        average: summarizeReviews(loaded.map((r) => (stars: r.stars, status: r.status))).average,
        count: loaded.length,
        pending: pending,
        hidden: hidden,
        published: published,
      );
    }
    try {
      // The count of everything, so "N reviews" is the whole collection and not
      // "the twenty I happened to have loaded".
      final all = await db.collection(AppConstants.colReviews).count().get();
      final total = all.count ?? 0;
      final pendingCount = await db
          .collection(AppConstants.colReviews)
          .where('status', isEqualTo: 'pending')
          .count()
          .get();
      return ReviewStatistics(
        average: summarizeReviews(loaded.map((r) => (stars: r.stars, status: r.status))).average,
        count: total,
        pending: pendingCount.count ?? pending,
        hidden: hidden,
        published: published,
      );
    } catch (error) {
      debugPrint('[reviews] statistics failed: $error');
      return ReviewStatistics(
        average: summarizeReviews(loaded.map((r) => (stars: r.stars, status: r.status))).average,
        count: loaded.length,
        pending: pending,
        hidden: hidden,
        published: published,
      );
    }
  }

  /// One Review, read again.
  ///
  /// After a moderation change the screen wants the *server's* version, not the
  /// one it optimistically patched: `moderated_at` and `published_at` are
  /// written as server timestamps, so the Admin's own clock is not the instant
  /// the record will carry.
  Future<ReviewModel?> fetch(String reviewId) async {
    final db = _firestore;
    if (db == null) return null;
    try {
      final doc = await db.collection(AppConstants.colReviews).doc(reviewId).get();
      if (!doc.exists) return null;
      return ReviewModel.fromDoc(doc.id, doc.data() ?? {});
    } catch (error) {
      debugPrint('[reviews] fetch failed: $error');
      return null;
    }
  }

  /// The testimonial currently on the website for a Review, if any.
  ///
  /// Read so the Admin's screen can say "this one is live" and offer to take it
  /// down, rather than leaving a published quote nobody can find again.
  Future<PublicReviewModel?> publishedTestimonial(String reviewId) async {
    final db = _firestore;
    if (db == null) return null;
    try {
      final doc = await db.collection(AppConstants.colPublicReviews).doc(reviewId).get();
      if (!doc.exists) return null;
      return PublicReviewModel.fromDoc(doc.id, doc.data() ?? {});
    } catch (error) {
      debugPrint('[reviews] publishedTestimonial failed: $error');
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // The Admin's three decisions
  // -------------------------------------------------------------------------

  /// Publish, hide, or send a Review back to the Admin's own queue.
  ///
  /// A state, never a deletion: `hidden` keeps the Guest's words and the reason
  /// the Admin hid them, on the Booking's Activity log. The rules let the Admin
  /// move the status and stamp it and nothing else, so a dislike expressed as a
  /// rewritten rating is not possible even from a client that tried.
  Future<void> setStatus(String reviewId, String status, String adminUid) async {
    if (!isReviewStatus(status)) {
      throw ArgumentError('a review status is one of $kReviewStatuses, not "$status"');
    }
    final db = _firestore;
    if (db == null) return;
    await db.collection(AppConstants.colReviews).doc(reviewId).update({
      'status': status,
      'moderated_at': FieldValue.serverTimestamp(),
      'moderated_by': adminUid,
      if (status == 'published') 'published_at': FieldValue.serverTimestamp(),
    });
    await _recordActivity(reviewId, 'ReviewModerated', status, adminUid);
  }

  /// Answer a Review, or change the answer already given.
  ///
  /// Stored on the document beside the Guest's words, which are not touched:
  /// `firestore.rules` gives the Admin `admin_response*` and `status`, and
  /// keeps `stars` and `text` out of the Admin's reach entirely. An Admin who
  /// dislikes a rating hides the Review; an Admin never edits it into five stars.
  Future<void> respond(String reviewId, String response, String adminUid) async {
    final text = response.trim();
    if (text.length > kAdminResponseMax) {
      throw ArgumentError('a reply may be at most $kAdminResponseMax characters');
    }
    final db = _firestore;
    if (db == null) return;
    await db.collection(AppConstants.colReviews).doc(reviewId).update({
      'admin_response': text,
      'admin_response_at': FieldValue.serverTimestamp(),
      'admin_response_by': adminUid,
    });
    await _recordActivity(reviewId, 'AdminReviewResponded', 'published', adminUid);
  }

  /// Put a testimonial on the website, or take it down.
  ///
  /// Six fields, written from scratch out of the Review rather than copied and
  /// pruned, and the rules' `hasOnly` refuses anything else — so the Guest's
  /// uid, their Booking and the Admin's private reply have no way onto the
  /// public page even from a client that skipped this method. Taking one down
  /// is a delete, so there is no moment where a document is half-public.
  Future<void> publish({
    required String reviewId,
    required int stars,
    required String excerpt,
    required String displayName,
    required DateTime stayedAt,
  }) async {
    final text = excerpt.trim();
    if (text.isEmpty) {
      throw ArgumentError('a published review needs the Guest’s words, not only their rating');
    }
    if (text.length > kPublicExcerptMax) {
      throw ArgumentError('a public quote may be at most $kPublicExcerptMax characters');
    }
    if (!isValidStars(stars)) {
      throw ArgumentError('choose a star rating from 1 to 5');
    }
    final name = displayName.trim().isEmpty ? 'Guest' : displayName.trim();
    if (name.length > kPublicNameMax) {
      throw ArgumentError('the display name may be at most $kPublicNameMax characters');
    }
    final db = _firestore;
    if (db == null) return;
    await db.collection(AppConstants.colPublicReviews).doc(reviewId).set({
      'review_id': reviewId,
      'stars': stars,
      'excerpt': text,
      'display_name': name,
      'month': _monthLabel(stayedAt),
      'published_at': FieldValue.serverTimestamp(),
    });
    await _recordActivity(reviewId, 'ReviewPublished', 'published', '');
  }

  Future<void> unpublish(String reviewId) async {
    final db = _firestore;
    if (db == null) return;
    await db.collection(AppConstants.colPublicReviews).doc(reviewId).delete();
  }

  /// Record a Review's change on the Booking's own Activity log.
  ///
  /// The same append-only log the lifecycle writes to, and the same rules: an
  /// entry is refused unless it is written in the name of whoever wrote it, and
  /// unless the name is one the log knows. A moderation decision with no entry
  /// is a decision that happened off the record, which is the thing this log
  /// exists to prevent.
  Future<void> _recordActivity(String bookingId, String action, String toStatus, String adminUid) async {
    final db = _firestore;
    if (db == null) return;
    try {
      await db
          .collection(AppConstants.colBookings)
          .doc(bookingId)
          .collection(AppConstants.subActivity)
          .add({
        'booking_id': bookingId,
        'action': action,
        'from_status': kNoPriorStatus,
        'to_status': toStatus,
        'actor': 'admin',
        'actor_id': adminUid,
        'at': FieldValue.serverTimestamp(),
      });
    } catch (error) {
      debugPrint('[reviews] activity append failed: $error');
    }
  }

  static String _monthLabel(DateTime date) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return '${months[date.month - 1]} ${date.year}';
  }
}
