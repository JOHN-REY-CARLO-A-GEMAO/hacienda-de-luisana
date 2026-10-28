# ADR-0023: A public form is validated and paced on the server

- **Status:** **Superseded in part by [ADR-0024](./0024-the-public-form-runs-on-a-cloudflare-worker.md)**
  — points 1, 2 and the `inquiries` half of point 6 described an `onRequest`
  Cloud Function that the estate's Firebase plan cannot deploy. The contact form
  now runs on a Cloudflare Worker. The Firestore sliding-window limiter, the
  callable pacing and `rate_limits` are unchanged and still accepted.
- **Date:** 2026-10-28

## Context

The Guest website's contact form was a dead end. `ContactInquiryForm` ran the
field validators, waited 400 ms, and showed *"Inquiry sent."* — no request left
the browser and nothing was stored. The only reason it went unnoticed is that a
Guest with a question eventually finds the email address.

The repository also had rate limiting that looked stronger than it was.
`MinuteBudget` in `functions/src/pricing.ts` kept a `Map` on one Cloud Functions
instance, in fixed one-minute windows. Cloud Functions runs several instances and
recycles them, so the effective estate-wide limit was "max × instances, reset on
every cold start", and a fixed window lets twice the limit through across a
boundary. `docs/LIMITATIONS.md` already said, correctly, that it must not be
described as security rate limiting.

The brief for this work asked for validation on both sides, a sliding-window or
token-bucket limiter keyed by IP/session, a lightweight anti-bot check, and a
`429 Too Many Requests` with a user-friendly message.

Two facts shape the decision:

- **Firestore Security Rules cannot count requests**, cannot pace anything, and
  cannot answer HTTP status codes. They are a per-document authorization
  language. Pacing needs a place that sees successive requests.
- **A Firebase callable cannot return 429.** `onCall` answers HTTP 200 with an
  error envelope by design; translating `resource-exhausted` into a status is
  not available from the client SDK. A standard 429 needs an `onRequest`
  endpoint.

## Decision

1. **The contact inquiry becomes an `onRequest` HTTPS function**
   (`functions/src/contact.ts`, `asia-southeast1`), and the form posts to it with
   `fetch`. It is the one boundary where a standard `429 + Retry-After` is worth
   having: proxies, CDNs and monitors understand it, and the form can run a real
   countdown.
2. **One zod schema, two runtimes.** `src/lib/security/contactInquiry.ts` is
   authored once and mirrored into `functions/src/security/` by
   `scripts/sync-security-forms.mjs`, with hashes recorded and verified by
   `functions/test/security-sync.test.ts` — the same pattern as the pricing
   module (ADR-0019). The browser validates for UX; the endpoint's copy is what
   decides what is stored.
3. **A sliding-window log in Firestore** (`functions/src/security/rateLimit.ts`)
   replaces `MinuteBudget` at every write boundary. Keys are
   `sha256(salt | scope | identifier)`, windows are trimmed on every write, and
   `expires_at` is written for a TTL policy. A read-only projection
   (`bookingAvailability`) keeps a per-instance window on purpose.
4. **The limiter fails open and says so.** If Firestore is unavailable, the
   per-instance fallback answers, the outcome is marked `degraded`, and the
   response carries `X-RateLimit-Degraded: true`. The estate losing every inquiry
   to a database blip is the failure `firebaseDefaults.ts` exists to prevent.
5. **Bot mitigation is a honeypot, a fill-time heuristic and — when configured —
   server-verified Cloudflare Turnstile.** A tripped trap is answered exactly
   like a success and stored nowhere. A Turnstile token is verified against
   Cloudflare before the write; an unreachable Cloudflare is not a bot verdict.
6. **The two new collections are denied to every client**, explicitly, in
   `firestore.rules`: `inquiries` and `rate_limits` are Admin-SDK-only.
7. **Callables that are paced report the same numbers** in `HttpsError.details`
   (`retryAfterSeconds`, `limit`, `reset_at`), and
   `src/lib/firebaseFailure.ts#rateLimitNotice` turns them into the same sentence
   the HTTP endpoint sends, so the website has one "too many requests" voice.

## Consequences

- A Guest's inquiry now reaches the estate, and a deployment that cannot store it
  says so instead of thanking them.
- Pacing is fleet-wide for the paths that write. A cold start no longer returns
  the allowance, and a minute boundary cannot be stepped over.
- Every allowed request in a paced window costs one Firestore write; every check
  costs one read. That is the price of a limiter without Redis. The availability
  projection is exempt for exactly this reason, and the exemption is written
  down rather than implied.
- Anti-bot is layered and optional: with no Turnstile keys the form still has a
  trap, a timer and a window, and the endpoint logs which checks ran.
- The mirror must be regenerated (`npm run sync:security`) when the schema
  changes, or `npm run test:functions` fails. That is deliberate. *(Removed with
  ADR-0024: the mirror, the script and this check no longer exist.)*
- Chat messages and Reviews remain direct Firestore writes. Their limits are
  enforced by `firestore.rules` because moving them behind callables would break
  the Admin app's contracts for no security gain. Their client cooldowns are UX
  and are labelled as such.
- Sign-in and sign-up are still paced by Firebase Auth, not by this repository.
  Adding a function in front of Auth would be bypassable by calling Auth
  directly, so it was not done.

## Superseded by ADR-0024

Everything above about `functions/src/security/rateLimit.ts` (a hashed,
sliding-window log with a documented fail-open) and about the callables'
`resource-exhausted` contract still holds and is still the code the callables run.

What did not hold is the assumption underneath point 1: that an `onRequest`
function could be deployed. The project runs on the **Spark (free) plan**, where
no function deploys and no outbound call is permitted, so `contactInquiry` would
have compiled, passed its tests and never answered a single request. It has been
deleted rather than left as a second, dead implementation — see ADR-0024 for the
replacement, its own (deliberately stated) limits, and why the honeypot's
fill-time heuristic went with it.

## Not decided here

- Surfacing inquiries in the Admin app, and a retention policy for them. The
  collection is server-only today; an Admin screen is a separate change with its
  own privacy review.
- A Redis/Upstash limiter, which would be cheaper under a sustained flood and is
  not worth a new trust boundary at this volume.
- Spam classification. The defence is shape, pace and a trap; a human still reads
  every inquiry.
