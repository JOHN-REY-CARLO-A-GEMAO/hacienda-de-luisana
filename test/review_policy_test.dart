// ----------------------------------------------------------------------------
// Reviews: the policy, and the shape a Review is read back as.
//
// The same cases `test/web/review-policy.test.ts` pins on the website, against
// the Dart copy — because a list of statuses written out twice is a list that
// drifts, and the drift would be invisible until a Guest could not leave a
// review for a stay they had finished, or could leave one for a stay they had
// not.
//
// The rules are the enforcement, and `test/emulator/rules.emulator.test.ts` is
// what runs them against a real Firestore. Nothing here claims to be that.
//
// NOT RUN: this file needs the Flutter/Dart SDK, which this environment does
// not have. It is written and reviewed, not executed — see docs/VERIFICATION.md.
// ----------------------------------------------------------------------------
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/review_model.dart';
import 'package:hacienda_de_luisana/services/review_policy.dart';
import 'package:hacienda_de_luisana/services/review_service.dart';

void main() {
  group('eligibility follows the stay, not the Guest', () {
    test('opens once the stay is over', () {
      expect(isReviewableStatus('Completed'), isTrue);
      expect(isReviewableStatus('Checked-Out'), isTrue);
    });

    test('refuses every status before the stay happened', () {
      for (final status in ['Pending', 'Payment Pending', 'Approved', 'Reserved', 'Checked-In', 'Staying']) {
        expect(isReviewableStatus(status), isFalse, reason: status);
      }
    });

    test('refuses a terminal branch — a request that ended is not a stay', () {
      for (final status in ['Rejected', 'Cancelled', 'Expired']) {
        expect(isReviewableStatus(status), isFalse, reason: status);
      }
    });

    test('refuses nothing at all', () {
      expect(isReviewableStatus(null), isFalse);
      expect(isReviewableStatus(''), isFalse);
      expect(isReviewableStatus('completed'), isFalse);
    });

    test('is the same list the rules accept', () {
      expect(kReviewableStatuses, ['Checked-Out', 'Completed']);
    });
  });

  group('the edit window', () {
    final created = DateTime.utc(2026, 10, 5, 2);

    test('is a fortnight', () {
      expect(kReviewEditWindowDays, 14);
    });

    test('closes on the day, at the same hour, two weeks later', () {
      expect(editWindowClosesAt(created), DateTime.utc(2026, 10, 19, 2));
      expect(canEditReview(created, now: DateTime.utc(2026, 10, 19, 1, 59, 59)), isTrue);
      expect(canEditReview(created, now: DateTime.utc(2026, 10, 19, 2)), isFalse);
    });

    test('never reopens, and a Review with no date cannot be edited', () {
      expect(canEditReview(created, now: DateTime.utc(2027)), isFalse);
      expect(canEditReview(null), isFalse);
    });
  });

  group('the star rating', () {
    test('accepts one through five', () {
      for (var n = 1; n <= 5; n++) {
        expect(isValidStars(n), isTrue, reason: '$n');
      }
    });

    test('refuses zero, six, and everything outside', () {
      for (final value in [0, 6, -1, 999, 4.5, null]) {
        expect(isValidStars(value), isFalse, reason: '$value');
      }
    });

    test('a category is 1..5, and absent is not zero', () {
      expect(isCategoryStars(1), isTrue);
      expect(isCategoryStars(5), isTrue);
      expect(isCategoryStars(0), isFalse);
      expect(isCategoryStars(6), isFalse);
      expect(isCategoryStars(null), isFalse);
    });
  });

  group('what a screen reader is told', () {
    test('names the value, not just the count of shapes', () {
      expect(starLabel(1), '1 star — Very poor');
      expect(starLabel(5), '5 stars — Excellent');
      expect(starLabel(3), '3 stars — Average');
    });

    test('still says something for a rating that is not one', () {
      expect(starLabel(0), 'Not rated');
      expect(starLabel(9), 'Not rated');
    });
  });

  group('the moderation statuses', () {
    test('are the three the Admin picks between', () {
      expect(kReviewStatuses, ['pending', 'published', 'hidden']);
    });

    test('a status nobody has heard of is not a status', () {
      expect(isReviewStatus('published'), isTrue);
      expect(isReviewStatus('deleted'), isFalse);
      expect(isReviewStatus('Published'), isFalse);
    });
  });

  group('reading a stored Review', () {
    final doc = <String, dynamic>{
      'booking_id': 'booking-1',
      'uid': 'guest-uid-1',
      'stars': 5,
      'text': '  Lovely stay.  ',
      'created_at': '2026-10-05T02:00:00.000Z',
      'status': 'published',
      'cleanliness': 4,
      'value': 0,
      'admin_response': 'Thank you for staying with us!',
    };

    test('reads the fields the website writes, and trims the words', () {
      final review = ReviewModel.fromDoc('booking-1', doc);
      expect(review.bookingId, 'booking-1');
      expect(review.stars, 5);
      expect(review.text, 'Lovely stay.');
      expect(review.isPublished, isTrue);
      expect(review.hasAdminResponse, isTrue);
      expect(review.createdAt, DateTime.utc(2026, 10, 5, 2));
    });

    test('keeps a category that was answered and drops one that was not', () {
      final review = ReviewModel.fromDoc('booking-1', doc);
      expect(review.categories['cleanliness'], 4);
      // A stored 0 is a category rated as the worst possible value, which the
      // rules refuse — so it is not shown as a rating at all.
      expect(review.categories.containsKey('value'), isFalse);
      expect(review.categories.containsKey('accommodation'), isFalse);
    });

    test('a document with no status reads as waiting, not as published', () {
      final review = ReviewModel.fromDoc('booking-1', {...doc}..remove('status'));
      expect(review.isPending, isTrue);
    });

    test('a document that cannot be read is still a Review, not a crash', () {
      final review = ReviewModel.fromDoc('booking-1', {'uid': 'guest-uid-1'});
      expect(review.bookingId, 'booking-1');
      expect(review.text, isEmpty);
      expect(review.isPending, isTrue);
    });

    test('a review with no words cannot be published, and says why', () {
      final review = ReviewModel.fromDoc('booking-1', {'stars': 4, 'status': 'published'});
      expect(review.canPublish, isFalse);
      expect(review.publishRefusal, contains('no words'));
    });

    test('a review whose words are too long for the website says so', () {
      final review = ReviewModel.fromDoc('booking-1', {
        'stars': 4,
        'status': 'published',
        'text': 'x' * (kPublicExcerptMax + 1),
      });
      expect(review.canPublish, isFalse);
      expect(review.publishRefusal, contains('$kPublicExcerptMax'));
    });
  });

  group('the average', () {
    test('counts published reviews only', () {
      final summary = summarizeReviews([
        (stars: 5, status: 'published'),
        (stars: 4, status: 'published'),
        (stars: 1, status: 'hidden'),
        (stars: 1, status: 'pending'),
      ]);
      expect(summary.count, 2);
      expect(summary.average, 4.5);
    });

    test('reports no average rather than a flattering zero', () {
      final summary = summarizeReviews(const []);
      expect(summary.count, 0);
      expect(summary.average, isNull);
    });

    test('rounds to one decimal, the way the site prints it', () {
      expect(
        summarizeReviews([
          (stars: 5, status: 'published'),
          (stars: 4, status: 'published'),
          (stars: 4, status: 'published'),
        ]).average,
        4.3,
      );
    });
  });

  group('the list is narrowed by the query, not by hiding what was loaded', () {
    test('a filter with nothing set is everything', () {
      expect(const ReviewFilter.all().isEverything, isTrue);
      expect(const ReviewFilter(stars: 5).isEverything, isFalse);
      expect(const ReviewFilter(status: 'hidden').isEverything, isFalse);
      expect(const ReviewFilter(search: 'quiet').isEverything, isFalse);
    });
  });
}
