/// Reviews — the policy, mirrored from the website's `src/lib/reviewPolicy.ts`.
///
/// Vocabulary: CONTEXT.md § Review. Enforcement: `firestore.rules`.
///
/// The app cannot reach into the website's TypeScript, and a list of statuses
/// written out twice is a list that drifts. So this is the Dart copy of the
/// same four decisions, each one pinned by `test/review_policy_test.dart`
/// against the same cases the website pins, and the two rules files — which
/// only the emulator can settle — are the final word.
///
/// Nothing here talks to Firestore. The service does; this decides.
library;

/// The Booking statuses a Review can be written from.
///
/// `Checked-Out` as well as `Completed`, because a Guest who has walked out has
/// stayed — making them wait for the Admin to close the Booking is a rule about
/// the Admin's paperwork. A terminal branch is not a stay: there is nothing to
/// review about a Booking that was rejected, cancelled or expired.
const List<String> kReviewableStatuses = ['Checked-Out', 'Completed'];

/// Has this Booking reached the point where a Review of it means something?
bool isReviewableStatus(String? status) =>
    status != null && kReviewableStatuses.contains(status);

/// How long after writing a Review the Guest may still correct it.
///
/// Fourteen days. `firestore.rules` enforces the same fortnight against its own
/// clock, reading the `edit_until` the create stamped — so this number is what
/// the app shows and what the rules refuse, not a second opinion.
const int kReviewEditWindowDays = 14;

/// The instant a Review's edit window shuts.
DateTime editWindowClosesAt(DateTime createdAt) =>
    createdAt.add(Duration(days: kReviewEditWindowDays));

/// May this Review still be edited?
bool canEditReview(DateTime? createdAt, {DateTime? now}) =>
    createdAt != null && editWindowClosesAt(createdAt).isAfter(now ?? DateTime.now());

/// The three things a Review can be in the Admin's hands.
///
/// `pending` is where every Review lands. `hidden` is the moderation state, and
/// it is a state rather than a deletion: a review nobody should read is kept
/// with its reason, and a Guest is never silently lost because a rating was
/// uncomfortable.
const List<String> kReviewStatuses = ['pending', 'published', 'hidden'];

/// The default a stored Review is read with when it predates moderation.
const String kDefaultReviewStatus = 'pending';

/// Is this one of the three, rather than a typo that would hide a Review?
bool isReviewStatus(Object? value) => kReviewStatuses.contains(value);

/// The optional category ratings, in the order the form asks for them.
///
/// All four are optional. A category the Guest skipped is absent, never zero:
/// "did not rate" and "rated it the worst available" are different facts.
const List<({String key, String label})> kReviewCategories = [
  (key: 'cleanliness', label: 'Cleanliness'),
  (key: 'accommodation', label: 'Accommodation'),
  (key: 'communication', label: 'Communication'),
  (key: 'value', label: 'Value for money'),
];

/// The categories a document carries, as Firestore field names.
const List<String> kReviewCategoryFields = [
  'cleanliness',
  'accommodation',
  'communication',
  'value',
];

/// A category rating is 1..5. Zero is what "not answered" is held as in the UI
/// and never written.
bool isCategoryStars(int? value) => value != null && value >= 1 && value <= 5;

/// The overall rating is 1..5, and an integer: a star is a whole thing, and a
/// half-star the rules would refuse is not a half the Guest can give.
bool isValidStars(Object? value) =>
    value is int && value >= 1 && value <= 5;

/// The longest a Review's written part may be.
///
/// The same 1,000 as `MESSAGE_MAX` and as the website's `REVIEW_MAX`, and as
/// `text.size() <= 1000` in `firestore.rules`. There is one content-length
/// policy in this system and a review is not exempt from it.
const int kReviewTextMax = 1000;

/// The longest an Admin reply may be. Bounded like every other text here.
const int kAdminResponseMax = 600;

/// The longest a public testimonial may be: it is a quotation, not a Review.
const int kPublicExcerptMax = 400;

/// The longest a public display name may be.
const int kPublicNameMax = 60;

/// What each star means, in words.
///
/// A row of gold shapes is a colour and a shape and nothing else to a screen
/// reader, and it is unreadable to anybody who cannot tell amber from grey.
const List<String> kStarLabels = [
  'Very poor',
  'Poor',
  'Average',
  'Good',
  'Excellent',
];

/// "3 stars — Average". What a star control announces.
String starLabel(int stars) =>
    isValidStars(stars) ? '${stars == 1 ? '1 star' : '$stars stars'} — ${kStarLabels[stars - 1]}' : 'Not rated';

/// The five names a Review's state changes are recorded under, in the Booking's
/// Activity log. The rules check every entry against that list, so an entry
/// carrying one of them is accepted and one carrying anything else is not.
const List<String> kReviewActivityActions = [
  'ReviewSubmitted',
  'ReviewUpdated',
  'AdminReviewResponded',
  'ReviewModerated',
  'ReviewPublished',
];

/// The status a review entry records when there was no Review before it.
const String kNoPriorStatus = 'none';

/// The average rating, and the count behind it.
///
/// Published reviews only, and `null` rather than zero when there are none: a
/// zero on the website would read as a terrible rating instead of an absence of
/// ratings. A number nobody can see cannot move a number everybody can, which
/// is why `hidden` and `pending` are both excluded.
({double? average, int count}) summarizeReviews(Iterable<({int stars, String status})> reviews) {
  var total = 0;
  var count = 0;
  for (final review in reviews) {
    if (review.status != 'published' || !isValidStars(review.stars)) continue;
    total += review.stars;
    count++;
  }
  if (count == 0) return (average: null, count: 0);
  return (average: (total / count * 10).round() / 10, count: count);
}
