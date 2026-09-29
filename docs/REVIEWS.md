# Reviews

A Guest's words about a stay they finished, and the three things only the Admin can do about one. Vocabulary: [CONTEXT.md](../CONTEXT.md) § Review. Decisions: [ADR-0014](./adr/0014-a-review-is-private-and-a-testimonial-is-a-separate-document.md). Enforcement: `firestore.rules`, run by `test/rules/firestore-rules.test.ts` and — canonically — `test/emulator/rules.emulator.test.ts`.

## What was already there, and was kept

A partial review system existed before this work and was **extended, not replaced**:

| Already there | Kept because |
| --- | --- |
| `reviews/{bookingId}` — the document id **is** the Booking id | "One Review per stay" is a fact of the data model, not a check a form remembers. It is also what lets the rule read the Booking a Review claims to be about. |
| Eligibility at `Checked-Out` or `Completed` | A Guest who has walked out has stayed. Waiting for the Admin to close the Booking is a rule about the Admin's paperwork. |
| `validateStarRating`, `REVIEW_MAX = 1000` | One content-length policy in this system; a review is not exempt from it. |
| `src/components/ReviewForm.tsx` at `/account` | The entry point was already where a Guest looks for it. |
| The curated Airbnb `REVIEWS` list in `src/config/site.ts` | Transcribed verbatim from the listing, under a rule that says *"Add reviews only from the listing itself; never write one."* Untouched — see below. |

## The data model

```
reviews/{bookingId}                         Firestore   private: the Admin and the Guest who wrote it
├── booking_id          string  == the document id
├── uid                 string  the Guest who stayed — never published
├── stars               int     1..5, the overall rating, the answer
├── text                string? ≤ 1,000 chars, trimmed; absent when there are no words
├── cleanliness         int?    1..5, optional
├── accommodation       int?    1..5, optional
├── communication       int?    1..5, optional
├── value               int?    1..5, optional
├── created_at          string  ISO, written by the app
├── updated_at          string? ISO, set when the Guest corrects it
├── status              string  pending | published | hidden
├── edit_until          Timestamp  recomputed by the rules from their clock
├── admin_response      string? ≤ 600 chars
├── admin_response_at   Timestamp?
├── admin_response_by   string?
├── moderated_at        Timestamp?
├── moderated_by        string?
└── published_at        Timestamp?

public_reviews/{reviewId}                  Firestore   public: six fields, nothing else
├── review_id          string
├── stars              int     1..5
├── excerpt            string  1..400 chars — the Guest's own words
├── display_name       string  1..60 chars — the name the Admin chose
├── month              string  "October 2026"
└── published_at       Timestamp

site_config/review_summary                 Firestore   the public average; Admin-written, public-read
```

**What is not stored:** no email, no phone number, no payment reference, no dates, no messages, no stay details. A review is about a stay, and the stay's own record is one tap away on the Booking. Copying a Guest's contact details into a list of complaints about them would be a way to lose them nobody asked for.

**Categories are optional and absent, never zero.** "Did not rate" and "rated it the worst available" are different facts, and only one of them is a rating.

## Eligibility

A Review is about a stay that happened.

| Status | Reviewable |
| --- | --- |
| Pending, Payment Pending, Approved, Reserved, Checked-In, Staying | no — the stay has not happened |
| **Checked-Out, Completed** | **yes** |
| Rejected, Cancelled, Expired | no — a terminal branch is a request that ended, not a stay |

`isReviewableStatus` in `src/lib/reviewPolicy.ts`, mirrored in `lib/services/review_policy.dart`, and `firestore.rules` reads the Booking rather than trusting a client to have checked. The rules suite pins the TypeScript list against the rules text so the three cannot drift.

## One review per stay

Four layers, because three of them are conveniences and one is the rule:

1. **The form** offers nothing once a Review exists, and says "Thank you — your review is with the Admin."
2. **The app** reads the document by id first and refuses a second.
3. **The database** — a second write at that id is an *update*, and the only update a Guest gets is the correction window below.
4. **The rules** require `booking_id == reviewId`, so a second document under another id is refused.

## The edit window

**Fourteen days** from the instant the Review was written. Inside it the owning Guest may change `stars`, `text`, the category ratings and `updated_at`. Nothing else: not the status, not the Admin's reply, not the deadline.

The deadline is a `Timestamp` the **create rule recomputes** from `request.time` and compares against what the client sent. A Guest cannot stamp a window that runs until next year, and cannot move their own deadline afterwards. Editing does not buy another fortnight — the window is measured from `created_at`, which is pinned.

After it closes the Review says what it said on the day, and only the Admin can remove it.

## Moderation

`pending` → `published` or `hidden`, and back. A Review lands `pending` — the website has always told the Guest it is "saved for Admin review" — because a Guest cannot put their own words in front of strangers.

`hidden` is a **state, not a deletion**. The document stays, the reason stays, and the decision is on the Booking's Activity log. A Guest is never silently lost because a rating was uncomfortable.

The Admin's door does not include `stars` or `text`. Dislike a rating? Hide the Review. You cannot rewrite it to five stars, and the rules refuse you.

## The Activity log

Review changes are recorded on the **Booking's own timeline** (`bookings/{id}/activity`), because the Booking is the thing the entry is about and the timeline is where that Booking's history already is.

```
ReviewSubmitted         the Guest wrote it
ReviewUpdated           the Guest corrected it, inside the window
AdminReviewResponded    the Admin answered
ReviewModerated         published, hidden, or sent back to waiting
ReviewPublished         a testimonial went to the website
```

`firestore.rules` now checks every Activity entry's `action` against the full list of names the system has. This closed a real gap: a Guest could already file an entry into their own Booking reading *"Payment proof verified — Booking Reserved"* in their own name, which is a lie in the one log the Admin reads.

## The public page

Two separate blocks, deliberately:

- **The Airbnb quotes** — transcribed verbatim from the listing, attributed by first name and month. Untouched. `src/config/site.ts`: *"Add reviews only from the listing itself; never write one."*
- **"Stayed with us"** — Reviews written here, published by the Admin, under a heading that says where they came from, with a footnote that they are published only after the Admin has read them.

Mixing them would have been cheaper and wrong: the Airbnb quotes are attributed to real first names on someone else's platform, and app-generated text among them would present words the Admin chose as though a guest had published them somewhere else.

### Why a separate collection (ADR-0014)

The stored Review carries `uid` and `booking_id`. A public read of `reviews` would publish both — and a stable public identifier for a Booking that holds a name, an email and a phone number is not something a review wall needs to hand out. `resource.data` inside an `allow read` is the whole document; a rule cannot project.

So `public_reviews` holds six fields written from scratch and `hasOnly` holds it to exactly those. Sanitized by construction, not by pruning: the next field somebody adds to a Review cannot reach the public page by default.

**Presence is publication.** There is no `status` on a public review. Withdrawing is a delete, so a visitor listing the collection is never handed something meant to be private, and there is no half-public state in between.

### The average

`summarize` counts **published reviews only** — a hidden Review and one still waiting for the Admin are both excluded, so the number on the website cannot be moved by a Review that is not on the website. With nothing published there is no average rather than a `0.0`.

The website reads a published aggregate at `site_config/review_summary` (one read, Admin-written) instead of counting on every page load. The Admin app's header shows a **different, larger** number on purpose: "every Review you can moderate" and "what the website says" are not the same question, and pretending otherwise would be the easiest lie in the app.

## Security

| | Guest (author) | Guest (other) | Admin | Signed out |
| --- | --- | --- | --- | --- |
| Read a Review | ✅ | ❌ | ✅ | ❌ |
| Create one | ✅ own finished stay only | ❌ | — | ❌ |
| Correct one | ✅ 14 days, own words only | ❌ | — | ❌ |
| Delete one | ❌ | ❌ | ✅ | ❌ |
| Publish / hide | ❌ | ❌ | ✅ | ❌ |
| Write an Admin reply | ❌ | ❌ | ✅ | ❌ |
| **Read a testimonial** | ✅ | ✅ | ✅ | ✅ |
| **Publish a testimonial** | ❌ | ❌ | ✅ | ❌ |
| Change the public average | ❌ | ❌ | ✅ | ❌ |

A Guest cannot review an unfinished or cancelled Booking, cannot write a second one, cannot sign another Guest's name, cannot reach the Admin's fields, cannot delete a review to take a rating back, and cannot modify the aggregate. A signed-out visitor can read only `public_reviews`, whose documents cannot contain a uid, a Booking or a private reply.

## Tests

| Where | What | Run here |
| --- | --- | --- |
| `test/web/review-policy.test.ts` | eligibility, window, public shape, average, labels | ✅ 35 |
| `test/web/reviews-cloud.test.ts` | the real module on its offline branch: eligibility, duplicate, edit, categories, publish/unpublish, summary | ✅ 42 |
| `test/web/review-form.test.tsx` | the star radiogroup, double submission, not losing the text, the limit | ✅ 10 |
| `test/rules/firestore-rules.test.ts` | every rule above, against the real rules file | ✅ 25 review cases |
| `test/emulator/rules.emulator.test.ts` | the same, against a real Firestore | ❌ no Java |
| `test/review_policy_test.dart` | the Dart copy of the policy, and `ReviewModel` | ❌ no Flutter SDK |
| `test/e2e/final-scenario.e2e.test.ts` | steps 38–42, end to end | ✅ |

## Known limitations

- **The emulator suites are not run here** (no Java). `npm run test:emulator` is the canonical check.
- **The Dart is not compiled here** (no Flutter SDK). `flutter test && flutter analyze` is the canonical check.
- **No push notification.** The "How was your stay?" prompt is the `/account` entry point; there is no FCM infrastructure to deliver it, and none was added for this.
- **The public average is published by the Admin.** In demo mode it is computed from what is published; in the cloud it reads `site_config/review_summary`, which an Admin must write for the number to appear. There is no Cloud Function computing it, and inventing one was out of scope.
- **The Admin's list search is a prefix match**, not full text: Firestore has no `contains` without an index. Reviews whose words *begin* with the query are found.
- **Reviews are not deleted.** `hidden` keeps them, as a Guest's words should be kept; there is no purge, and a Firestore TTL policy for reviews is not deployed.
- **The curated Airbnb list and the on-site block have separate numbers.** That is honest, and it is also two things to keep in step by hand.
