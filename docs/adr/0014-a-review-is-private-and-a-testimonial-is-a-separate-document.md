# A Review is private; a testimonial is a separate document

**Status**: accepted, 2026-09-29. **Extends** the partial Review system that was already in `firestore.rules`, `src/lib/reviewsCloud.ts` and `src/components/ReviewForm.tsx`. **Does not** replace any of it — the document id, the eligibility list and the one-review-per-stay contract are the ones that were already there, kept because they were right.

## The problem this settles

The obvious way to put a Guest's review on the website is to open the `reviews` collection to the world and filter on a `status` field:

```
allow read: if resource.data.status == 'published';
```

It was rejected. A stored Review is `reviews/{bookingId}` and carries `booking_id` and `uid`. Publishing that document means publishing both:

- **`booking_id`** is the identifier of a Booking, and a Booking holds a guest name, an email address, a phone number, dates and a payment reference. The document itself would stay unreadable — but a stable, public identifier for it is not something a review wall needs to hand out.
- **`uid`** is the Guest's identity, and the identity a Booking is keyed to. Publishing it makes a public review attributable to a specific stay in a specific account, which is a join the website has no business making on a Guest's behalf.

Neither of those is a field a rule can hide once the document is readable. `resource.data` inside an `allow read` is the whole document, not a projection.

So the public review is a **different document**, in a different collection, with a different author.

## What is decided

### 1. `reviews/{bookingId}` stays private

Unchanged from what was there, and tightened:

- **Read** — the Admin, and the Guest who wrote it. Never a signed-out visitor. Amended 2026-10-06: also the owner of the Booking the document id names, *when no Review is there*. `submitReview` asks whether one exists before it writes one, and that ask arrives at an id with no `resource` behind it — so the authorship test had nothing to compare against, refused, and the Guest was told Firestore refused a write that had never been attempted. There is no document to read in that case, and a Review that does exist is still reachable only by its author or the Admin, so the absence discloses nothing.
- **Create** — signed in, the id is the Booking, the Booking is the author's, the Booking is `Checked-Out` or `Completed`, the stars are an integer 1–5, the written part is at most 1,000 characters and is not blank, any category is 1–5 or absent, the status arrives as `pending`, and `edit_until` is recomputed by the rule from its own clock.
- **Update** — two doors:
  - the owning Guest, inside the fortnight, moving only `stars`, `text`, the four category ratings and `updated_at`;
  - the Admin, moving only `status`, `published_at`, `moderated_at`, `moderated_by`, `admin_response`, `admin_response_at` and `admin_response_by`.
- **Delete** — the Admin only. A Guest does not get to take a rating back by deleting it.

The Admin's door deliberately excludes `stars` and `text`. An Admin who dislikes a rating hides the Review, which is a state the Activity log records; an Admin cannot rewrite a two-star review into a five-star one. That was `allow update: if false` before, and the reason it was false is still true — it just has a narrower door now.

### 2. `public_reviews/{reviewId}` is what a visitor reads

Six fields, written from scratch by the Admin out of a Review:

```
review_id, stars, excerpt, display_name, month, published_at
```

`firestore.rules` holds it to that list with `hasOnly`. The document is therefore sanitized **by construction** rather than by pruning: a field added to a Review next year cannot reach the public page by default, because it has to be named here to be published.

**Presence is publication.** There is no `status` on a public review. The Admin withdraws a testimonial by deleting it, so:

- a signed-out visitor can list the whole collection without asking whether any given document is meant to be seen — everything in it is;
- there is no window in which a document is half-public;
- there is no state a stale client can leave a review stranded in.

### 3. The Admin chooses what is published

Publication is a decision, and it is a human one: which words go out, and under whose name. `sanitizePublicReview` refuses a bare rating (a testimonial needs the Guest's words), an excerpt over 400 characters, a display name over 60, and stars outside 1–5 — and the rules refuse the same shapes, so a client that skipped it is rejected rather than served.

### 4. The average counts only what is published

`summarize` counts `status == 'published'` and reports `null` rather than `0.0` when there are none — a zero on a website reads as a terrible rating instead of an absence of ratings. The website reads a published aggregate at `site_config/review_summary` (Admin-written, already public-read) rather than counting the collection on every page load; the Admin app's own header deliberately shows a *different*, larger number, because "every Review you can moderate" and "what the website says" are not the same question.

## The public testimonial list, and the one thing this ADR does not change

`src/config/site.ts` holds a curated `REVIEWS` list transcribed verbatim from the hacienda's Airbnb listing, and says in as many words: *"Add reviews only from the listing itself; never write one."* That list is **untouched**. On-site reviews appear in their own block, headed *"Stayed with us — rated here, by Guests who stayed"*, with a footnote saying they were written by Guests after their stay and are published only after the Admin has read them.

Mixing them would have been cheaper and wrong: the Airbnb quotes are attributed to real first names on someone else's platform under an editorial rule this repository does not control, and putting app-generated text among them would present words the Admin chose to publish as though a guest had published them somewhere else.

## What this does not change

Booking, availability, payment, payment proof, cancellation, KYC (removed), the chat, live location, the smart lock, the tutorial, the Access log, and every existing rule outside `reviews`, `public_reviews` and the Activity log's action list. The website still has no management screens; the Admin app is still the only management surface.
