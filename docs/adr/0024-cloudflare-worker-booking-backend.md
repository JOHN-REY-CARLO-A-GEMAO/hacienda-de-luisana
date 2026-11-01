# Host the browser Booking callables on Cloudflare Workers

**Status**: accepted, 2026-11-02. Implements the server authority assumed by
ADR-0018 and ADR-0019 without making Firebase Blaze a prerequisite for the
browser Booking flow.

## The circumstance

The estate's money and inventory rules were written for a server. A Guest's
browser can display a price, but it must not be the authority for that price;
two Guests can also race for the last unit faster than client-side reads can
settle the claim. `quoteBooking`, `verifyBookingMoney`,
`bookingAvailability`, and `submitBooking` therefore existed as Firebase
callables.

They could not be deployed on the project's Spark plan: Firebase requires
Blaze before it will enable the Cloud Functions, Cloud Build, and Artifact
Registry APIs. Keeping enforcement off and retaining the direct-Firestore
fallback kept the website usable, but it also left authoritative pricing and
transactional inventory as undeployed code.

Cloudflare Workers offers a free HTTP runtime large enough for this estate's
Booking traffic. Firestore and Firebase Auth do not need to move for the
compute to move.

## The decision

**1. The Worker hosts the four browser-facing callables, under their existing
names.** It accepts `POST /bookingAvailability`, `/submitBooking`,
`/quoteBooking`, and `/verifyBookingMoney`, and implements Firebase's callable
request and response protocol. The website uses `httpsCallableFromURL` when
`VITE_WORKER_API_URL` is configured, so Firebase still attaches the caller's ID
token and still decodes the structured callable error.

**2. There is one Booking implementation, not a Firebase copy and a Worker
copy.** Validation, pricing, availability, submit, and persistent rate limits
now live behind platform-neutral seams in `functions/src/*Core.ts`. Firebase's
`quotes.ts` and `availability.ts` are thin Admin SDK bindings over those cores;
the Worker binds the same cores to Firestore REST and Identity Toolkit. The
generated pricing mirror remains the single pricing arithmetic used by both.

**3. The Worker does not pretend the Admin SDK runs in workerd.** It signs a
Google service-account JWT with WebCrypto, exchanges it for an OAuth access
token, and uses Firestore REST for documents, runQuery, commits, and explicit
transactions. A nested `serverTimestamp()` becomes a `REQUEST_TIME` field
transform in the same commit. Transaction retries happen only on Firestore's
`ABORTED` contention signal.

**4. Caller identity is verified in the Worker, never trusted from the body.**
Supplied Firebase ID tokens—including on the otherwise public availability
endpoint—are checked against Google's secure-token JWKS for RS256 signature,
project audience, issuer, subject, and time claims. `verifyBookingMoney`
additionally reproduces the Admin SDK account lookup through Identity Toolkit
so disabled accounts and bootstrap-email verification mean the same thing on
either host.

**5. The service account is deliberately small.** It has Cloud Datastore User
for Firestore application data and Firebase Authentication Viewer for the one
user lookup. Its downloaded JSON is a Cloudflare secret supplied by the
project owner; it is never repository content, a Vite variable, or health
output. Service-account access bypasses Firestore Rules, so the endpoint
authorization and input allowlists in the shared cores are the security
boundary and are not optional decoration.

**6. Cutover is a website build setting, with the old road left standing.**
With `VITE_WORKER_API_URL` unset, the website keeps the Firebase callable path
and the existing Spark fallback. With it set, only the four endpoints move.
The Firestore documents and reply shapes do not change, so rollback is to
remove the variable and redeploy the website—not to migrate data back.

## Why not the alternatives

- **Upgrade to Blaze** remains the simplest hosting answer, but the estate
  asked for a free path and does not need to attach billing merely to prove the
  Booking server works.
- **Leave pricing and inventory to Firestore Rules/client code** would make
  the browser's figures authoritative and cannot perform the same transactional
  last-unit decision.
- **Move the data to another free database** would duplicate identity,
  Booking, rates, and Admin-app data. The expensive part of this system is the
  consistency of those records, not four HTTP handlers.
- **Run `firebase-admin` in the Worker anyway** would depend on Node/gRPC
  behaviour that is not the Firestore client's supported home in workerd. The
  REST boundary is narrower and testable.

## Consequences

- The estate can deploy authoritative quotes and transactional submits while
  Firebase remains on Spark, subject to Cloudflare's changing free limits.
- Firestore composite indexes become a hard deployment prerequisite, because
  REST `runQuery` uses the same overlap index the Admin SDK query used.
- There are now two transports to operate, even though there is one core:
  Firebase credentials/rules and Cloudflare secrets/CORS. Worker health,
  Wrangler logs, and the deployment order in `workers/README.md` are part of
  the feature, not afterthoughts.
- RSA verification and signing happen at the edge. Token/JWKS caching keeps
  them bounded, but production logs must be watched during cutover for CPU or
  upstream failures rather than assuming “free” means “unlimited”.
- CORS is exact-origin. Adding a website domain now also means adding it to
  the Worker's `ALLOWED_ORIGINS`; localhost belongs only in `.dev.vars`.

## What deliberately did not move

Firestore triggers have no Worker equivalent. The Booking/message/access-log
notification triggers, FCM sends, and legacy device-token callables remain a
later phase. Replacing an at-least-once database trigger with a browser call
or an unauthenticated “notify me” endpoint would either lose events or let a
caller invent them. That phase needs authenticated event claims that are
re-fetched from trusted documents, or a scheduled cursor with durable
deduplication, plus the separate FCM role and API.

No Firestore enforcement switch is flipped by this decision. The Worker must
first be deployed, receive its secret, pass authenticated quote/submit/verify
smoke tests, and show clean logs. Only then may `quotes_required` or
`callable_booking_required` be enabled by the Admin.
