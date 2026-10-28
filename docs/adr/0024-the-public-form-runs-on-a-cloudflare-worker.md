# ADR-0024: The public form runs on a Cloudflare Worker

- **Status:** Accepted
- **Date:** 2026-10-28
- **Supersedes in part:** [ADR-0023](./0023-a-public-form-is-validated-and-paced-on-the-server.md)

## Context

ADR-0023 gave the contact form a real endpoint: an `onRequest` function in
`functions/src/contact.ts` that validated the inquiry, verified a Turnstile token,
paced by IP and email, and stored the result in Firestore. It passed its tests.

Then came the fact that decides this ADR: **the estate's Firebase project is on
the Spark (free) plan.** On Spark, Cloud Functions cannot be deployed at all, and
no outbound network request is possible without enabling billing (a card). So:

- the endpoint never ran, and
- even if it had, it could not have called Cloudflare's siteverify or Resend's
  API — the two outbound calls the design depends on.

The form was back where it started, except now with a convincing-looking
implementation of a thing that would never answer. A dead endpoint in the tree is
worse than no endpoint: the next person reads `functions/src/contact.ts`, sees
tests, and concludes inquiries work.

Constraints for the replacement, from the brief:

- no cost, no card — the free tier of something;
- a **standalone Cloudflare Worker**, not Firebase;
- strict validation, bot mitigation, and rate limiting by **real IP**;
- Turnstile verified **before** the KV counter, so bots cannot spend the 1,000
  free KV writes a day;
- a tripped honeypot answered with a **fake `200`**;
- the honeypot hidden off-screen, never `display:none`, never an obvious name;
- **5 requests / 10 minutes per IP**, `429` + `Retry-After: 600`.

## Decision

1. **The public inquiry endpoint is a Cloudflare Worker**
   (`workers/contact-inquiry/`), deployed with Wrangler on the free plan. It is
   the only part of the product that is not Firebase, and it is deliberately
   small: one `fetch` handler, seven modules, no framework.

2. **The functions endpoint is deleted, not disabled.** `functions/src/contact.ts`,
   its schema mirror, its bot helpers, the sync script and their tests are gone.
   The `inquiries` rule is gone with them; `rate_limits` stays explicitly denied
   because the callables' limiter still writes it.

3. **The order of the handler is the security design**, and is implemented
   verbatim: CORS/`OPTIONS` → `POST` only → configuration guard → body size and
   JSON → **honeypot, answered `200`** → schema (`400` + per-field messages) →
   **Turnstile** (`403`) → **KV counter** (`429`) → **Resend** (`200`). Each step
   refuses before spending anything the next step would cost. The honeypot is
   before Turnstile because it is free and before the counter because a KV write
   is the scarcest resource in the design.

4. **The rate limit is a KV counter keyed by `cf-connecting-ip`.** Not
   `x-forwarded-for` (a caller would choose their own bucket), not the submitted
   email (unverified, attacker-supplied). `5 / 600 s`, `retry_after_seconds` and
   `Retry-After: 600` in the reply, `expirationTtl` on the key so nothing
   accumulates.

5. **The two schemas are a contract with a test, not a hash.** The browser's copy
   (`src/lib/security/contactInquiry.ts`) and the worker's
   (`workers/contact-inquiry/src/schema.ts`) cannot import each other — different
   bundlers, different runtimes, and the worker's copy is stricter than the
   browser needs. `test/web/contact-worker-contract.test.ts` imports the worker's
   real `LIMITS`/`inquirySchema` and feeds the browser's output through the
   worker's `.strict()` parse, so a limit changed on one side fails on the other.
   The `sync-security-forms.mjs` generator and its hash manifest went away with
   the functions mirror.

6. **The form says what actually happened.** A worker reply of `429` disables the
   button and counts down; `400` renders the worker's field messages; a demo build
   says *"Kept in this browser (demo mode)"*; a build with a worker URL but no
   site key says the bot check is not configured and refuses to send. There is no
   path where the form thanks the Guest for an inquiry it did not deliver.

7. **The worker fails open on infrastructure and closed on abuse.** A KV read that
   throws means the inquiry is accepted and the reply is marked
   `X-RateLimit-Degraded: true`. An unreachable Cloudflare means acceptance unless
   `TURNSTILE_FAIL_CLOSED=true`. A **failed** token is a `403`. A **missing**
   secret is a `500 misconfigured` — the one thing the worker never does is
   silently drop an inquiry because it was not set up.

8. **Nothing is stored.** The inquiry becomes a plain-text email through Resend,
   `reply_to` set to the Guest so the Admin can answer it. There is no inquiry
   database, no retention question, and no Firestore read to authorise.

## Consequences

- The contact form works on the plan the estate is actually on, for free. The
  worker's own README records every free-tier number it lives inside.
- A second deployment exists, with its own secrets, its own KV namespace and its
  own upgrade path. That is real operational cost, and it is written down in the
  worker README rather than discovered.
- **The limiter is honest about being weak.** KV has no compare-and-set, so the
  counter can overshoot under concurrency; the window is fixed, so a caller can
  straddle a boundary; a KV outage means no limit. All three are stated in the
  README and in `docs/FORMS_SECURITY.md` § 5, with the Durable Object upgrade
  path named. Turnstile and the schema are the boundaries that do not depend on
  any of it.
- **Resend's free tier is the real ceiling**: 100 emails a day, and
  `onboarding@resend.dev` only delivers to the account owner until a domain is
  verified. Both are prerequisites the README tells the operator to handle.
- The fill-time heuristic from ADR-0023 is gone. It needed a `form_started_at`
  field the brief did not include, and a clock is a poor signal next to a
  server-verified challenge. The honeypot and Turnstile remain.
- Inquiries are no longer a collection, so there is nothing to surface in the
  Admin app and nothing to age out. If the estate ever wants a searchable inbox,
  that is a new decision, not a restoration of this one.

## Not decided here

- A Durable Object limiter, which would make the count exact. Still free at this
  volume; not worth the extra binding today.
- Storing inquiries anywhere (D1, KV, an Admin screen). Email is the delivery
  mechanism; a second store is a privacy decision with its own review.
- Moving anything else off Firebase. The Worker exists because one form must be
  reachable by strangers on a plan that cannot run a function — not as a general
  migration.
