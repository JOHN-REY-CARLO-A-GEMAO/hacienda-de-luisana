/// The Review a Guest wrote about a stay, as the Admin app reads it.
///
/// Vocabulary: CONTEXT.md § Review. The stored document is `reviews/{bookingId}`
/// — the id IS the Booking id, which is what makes "one Review per stay" a fact
/// the database enforces rather than a check a form remembers.
///
/// What this model deliberately does not carry is everything the Admin is not
/// owed: no email, no phone number, no payment reference, no stay dates, no
/// messages. A review is about a stay, and the stay's own record is one tap
/// away on the Booking. Copying a Guest's contact details into a list of
/// complaints about them would be a way to lose them that nobody asked for.
library;

import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/review_policy.dart';

/// One Guest's words about one finished stay.
class ReviewModel {
  /// The Booking this is about — and the document's own id.
  final String id;
  final String bookingId;

  /// The Guest who stayed. The Admin never publishes this (ADR-0014).
  final String uid;

  /// The overall rating, 1..5.
  final int stars;

  /// What they wrote, or empty when they only left a rating.
  final String text;

  /// The category ratings, by field name. Absent is not the same as zero.
  final Map<String, int> categories;

  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// `pending` until the Admin publishes it; `hidden` once moderated away.
  final String status;

  /// The Admin's reply, kept beside the review rather than in a thread.
  final String adminResponse;
  final DateTime? adminResponseAt;
  final String? adminResponseBy;

  final DateTime? moderatedAt;
  final String? moderatedBy;
  final DateTime? publishedAt;

  const ReviewModel({
    required this.id,
    required this.bookingId,
    required this.uid,
    required this.stars,
    this.text = '',
    this.categories = const {},
    this.createdAt,
    this.updatedAt,
    this.status = kDefaultReviewStatus,
    this.adminResponse = '',
    this.adminResponseAt,
    this.adminResponseBy,
    this.moderatedAt,
    this.moderatedBy,
    this.publishedAt,
  });

  /// A Firestore document, read the way the website and the rules write it.
  ///
  /// `created_at` is a string and `edit_until` a Timestamp, and both are read
  /// here rather than assumed: the two shapes are what the website's create has
  /// always written, and a document that arrives with neither still reads as a
  /// Review rather than throwing on the Admin's list screen.
  factory ReviewModel.fromDoc(String id, Map<String, dynamic> data) {
    DateTime? date(dynamic value) {
      if (value is Timestamp) return value.toDate();
      if (value is DateTime) return value;
      if (value is String) return DateTime.tryParse(value);
      return null;
    }

    final categories = <String, int>{};
    for (final field in kReviewCategoryFields) {
      final value = data[field];
      if (isCategoryStars(value as int?)) categories[field] = value as int;
    }

    return ReviewModel(
      id: id,
      bookingId: (data['booking_id'] as String?) ?? id,
      uid: (data['uid'] as String?) ?? '',
      stars: (data['stars'] as int?) ?? 0,
      text: (data['text'] as String?)?.trim() ?? '',
      categories: categories,
      createdAt: date(data['created_at']),
      updatedAt: date(data['updated_at']),
      status: isReviewStatus(data['status']) ? data['status'] as String : kDefaultReviewStatus,
      adminResponse: (data['admin_response'] as String?)?.trim() ?? '',
      adminResponseAt: date(data['admin_response_at']),
      adminResponseBy: data['admin_response_by'] as String?,
      moderatedAt: date(data['moderated_at']),
      moderatedBy: data['moderated_by'] as String?,
      publishedAt: date(data['published_at']),
    );
  }

  /// A short reference the Admin can read aloud, matching the Booking's.
  String get reference => bookingId.length > 8
      ? bookingId.substring(0, 8).toUpperCase()
      : bookingId.toUpperCase();

  bool get isPending => status == 'pending';
  bool get isPublished => status == 'published';
  bool get isHidden => status == 'hidden';

  /// Has the Guest replied, and may they still change it?
  bool get hasAdminResponse => adminResponse.isNotEmpty;

  /// The instant the Guest's edit window shut, for the "you can change this for
  /// another N days" line on the detail screen.
  DateTime? get editWindowCloses {
    final created = createdAt;
    if (created == null) return null;
    return editWindowClosesAt(created);
  }

  /// Whether the Review is one the Admin can put on the website right now.
  ///
  /// Two things have to be true: the words are there (a bare rating is not a
  /// testimonial) and there is something to publish under, which is the
  /// Guest's choice of name or none.
  bool get canPublish => text.isNotEmpty && text.length <= kPublicExcerptMax;

  /// Why it cannot, when it cannot — so the screen explains rather than
  /// greying a button.
  String? get publishRefusal {
    if (text.isEmpty) return 'This review has no words, so there is nothing to publish.';
    if (text.length > kPublicExcerptMax) {
      return 'The quote is ${text.length} characters; a public quote may be at most $kPublicExcerptMax.';
    }
    return null;
  }
}

/// A testimonial as it appears on the website, read back out of
/// `public_reviews` (ADR-0014).
///
/// Six fields. There is no uid here, no Booking, and no Admin reply, and the
/// rules refuse the document if anybody tries to add one — this class exists so
/// the Admin app cannot read a private field off a public document either.
class PublicReviewModel {
  final String reviewId;
  final int stars;
  final String excerpt;
  final String displayName;
  final String month;
  final DateTime? publishedAt;

  const PublicReviewModel({
    required this.reviewId,
    required this.stars,
    required this.excerpt,
    required this.displayName,
    required this.month,
    this.publishedAt,
  });

  factory PublicReviewModel.fromDoc(String id, Map<String, dynamic> data) => PublicReviewModel(
        reviewId: (data['review_id'] as String?) ?? id,
        stars: (data['stars'] as int?) ?? 0,
        excerpt: (data['excerpt'] as String?) ?? '',
        displayName: (data['display_name'] as String?) ?? 'Guest',
        month: (data['month'] as String?) ?? '',
        publishedAt: data['published_at'] is Timestamp
            ? (data['published_at'] as Timestamp).toDate()
            : null,
      );
}
