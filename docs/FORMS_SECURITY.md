# Forms: validation, rate limiting and bots

How every form on the Guest website is validated, paced and protected from
scripted abuse — and, just as importantly, which parts of that answer are
enforced by a server and which are only a courtesy.

Read with [`docs/LIMITATIONS.md`](./LIMITATIONS.md) § *Rate limiting* and
*Forms*, [`workers/contact-inquiry/README.md`](../workers/contact-inquiry/README.md)
for the Worker's deploy steps, and ADR-0024 (the Worker) with ADR-0023 (the
Firestore limiter the callables still use).

---

## 1. What changed, and why

Three problems, in the order they were found.

**The contact form was theatre.** `ContactInquiryForm` validated its fields, ran
`setTimeout(400)` and showed *"Inquiry sent."* Nothing left the browser. A Guest
who needed the Hacienda had no way to know their question went nowhere, which is
the one failure `src/lib/firebaseDefaults.ts` says this project cannot have.

**Rate limits lived in one process.** `MinuteBudget` in
`functions/src/pricing.ts` counted requests in a `Map` on a single Cloud
Functions instance, in fixed one-minute windows. Cloud Functions runs several
instances and recycles them, so the estate-wide limit was effectively
"limit × instances, reset whenever a cold start happens" — and a fixed window
lets twice the limit through across a minute boundary. It was a useful brake on
one warm instance and not a security control.

**The fix could not live in Cloud Functions.** The estate's Firebase project is
on the **Spark (free) plan**, which cannot deploy functions at all — and no
outbound network call (Turnstile's siteverify, Resend's send) is possible without
enabling billing. An `onRequest` endpoint in `functions/` would compile, pass its
tests and never run. So the public form moved to a **Cloudflare Worker** (free
tier, no card), and the functions-based endpoint was removed rather than left in
the tree looking deployable. ADR-0024 records that decision; ADR-0023 is
superseded for the contact form and still authoritative for the callables.

---

## 2. The layers, in the order they run

```
browser                    │  Cloudflare Worker               │  where it lands
───────────────────────────┼──────────────────────────────────┼────────────────
zod schema (UX)            │  honeypot → zod (authority)      │  Resend email
client cooldown (UX)       │  Turnstile siteverify            │  (nothing stored)
Turnstile widget           │  KV counter, 5 / 10 min per IP   │
                           │  CORS allowlist                  │
```

Each layer refuses earlier and cheaper than the next, and no layer trusts the one
before it. The browser's schema and the worker's schema are two files with **one
contract**, and the contract itself is tested: `test/web/contact-worker-contract.test.ts`
imports the worker's real `LIMITS`/`inquirySchema` and feeds the browser's output
through the worker's `.strict()` parse. A limit cannot drift on one side without
a red test on the other (§ 9).

---

## 3. Every form, and who enforces what

| Form | Where | Client validation | Server-side enforcement | Pacing |
| --- | --- | --- | --- | --- |
| **Contact inquiry** | `src/components/ContactInquiryForm.tsx` | zod (`src/lib/security/contactInquiry.ts`) | the same contract in the Worker (`workers/contact-inquiry/src/schema.ts`); honeypot; Turnstile | **5 / 10 min per IP** in KV, `429` + `Retry-After: 600` |
| **Sign in** | `Auth/LoginFormOnly.tsx` | `validateEmail`, cooldown | Firebase Auth (brute-force protection, managed outside this repo) | client cooldown only; Auth's own `auth/too-many-requests` surfaced |
| **Password reset** | `Auth/ResetPasswordForm.tsx` | `validateEmail`, cooldown | Firebase Auth | client cooldown only; Auth's quota surfaced |
| **Create account** | `Auth/RegisterForm.tsx` | full field validation | Firebase Auth + `firestore.rules` for the Profile | Auth's own protection (no added cooldown — a shared device must not lock the next person out) |
| **Booking** | `src/pages/BookingPage.tsx`, `DownpaymentPage.tsx` | `src/lib/booking`, `src/lib/validation.ts` | `submitBooking` callable: shape check, lead time, price attestation, availability transaction; `firestore.rules` | 8/min per caller (shared window) |
| **Price quote** | `src/lib/quotesApi.ts` | — | `quoteBooking` callable + `parseQuoteRequest` | 12/min per uid, `QUOTE_RATE_LIMIT_PER_MINUTE` |
| **Availability** | `src/lib/availabilityApi.ts` | — | `bookingAvailability` callable, bounded range | 40/min per caller, per instance (deliberate — § 5) |
| **Payment proof claim** | `Booking/PaymentStep.tsx` | `validateAmount`, `validateReference`, file type/size | `firestore.rules` (proof path, amount, plan); Storage rules for the image | client cooldown; Supabase bucket policy |
| **Chat message** | `chat/MessageComposer.tsx` → `src/lib/chatCloud.ts` | length, attachment type/size | `firestore.rules` (`text` ≤ 1,000), Storage rules | client cooldown (8/10 s) |
| **Review** | `src/components/ReviewForm.tsx` → `reviewsCloud.ts` | rating 1–5, 1,000 chars | `firestore.rules`: author, finished stay, edit window, one per Booking | client cooldown (3/min) |
| **Late checkout / stay requests** | `Booking/LateCheckoutRequest.tsx` | typed fields | `firestore.rules` / Admin decision | client cooldown on the parent Booking flow |

Two rows are deliberately *not* server functions: chat and reviews are direct
Firestore writes, and their limits are enforced by `firestore.rules` because
moving them behind a callable would break the Admin app's existing contracts for
no security gain — the rules already refuse a long message, a foreign author and
a second review for the same stay. Pacing there is a UX cooldown, and the rules
are the boundary.

The callable rows are written as they are *designed* to run. On the Spark plan
none of them can deploy, so in the current deployment only the Firestore- and
Storage-rules rows are actually live. That is a plan limitation, not a defect in
the design, and it is the reason the one form a stranger must be able to use —
the contact form — was moved somewhere that does run (§ 1).

---

## 4. One contract, two runtimes

The inquiry's limits and shape exist twice, on purpose, because the two files run
in different places and neither can import the other:

- `src/lib/security/contactInquiry.ts` — the browser's copy, bundled by Vite.
- `workers/contact-inquiry/src/schema.ts` — the worker's copy, bundled by
  Wrangler.

They are not generated from each other. A code generator plus a hash manifest was
the first design, and it was removed with the functions endpoint: the worker's
schema is not a mirror of the browser's, it is *stricter* than the browser has any
need to be (it also drops nothing, normalises faster and is the one that decides).
A hash cannot express "stricter", so the guarantee is a test instead:

```
test/web/contact-worker-contract.test.ts
  → imports LIMITS, inquirySchema, RATE_LIMIT from workers/contact-inquiry/src/
  → asserts CONTACT_LIMITS deep-equals LIMITS
  → asserts the browser's payload parses under the worker's .strict() schema
  → asserts the worker refuses what the browser refuses (same field names)
```

Change one number without the other and that file goes red. That is a stronger
statement than a hash, because it fails for the reason that matters: the two sides
disagree.

What the schema does:

- **Normalise before measuring** — NFC, control characters out, whitespace
  collapsed, then trimmed. `"  Ana  "` is a 3-character name, not a 7-character
  one.
- **Refuse, never truncate** — a 2,001-character message is an error under the
  field, not a 2,000-character message pretending to be complete.
- **Refuse markup** — `<` and `>` are refused in free text. Defence in depth, not
  the XSS fix: React escapes everything it renders, and the email is plain text.
  It means a payload that reaches a log or a future HTML view is not shaped like
  markup.
- **Refuse unknown keys** (`.strict()`) — the worker builds its email from named
  fields, so a caller sending `to` or `subject_line` is trying to choose a
  header, not making a typo.

---

## 5. Rate limiting

Two limiters, for two different reasons, in two different places.

### The contact form: a KV counter in the Worker

`workers/contact-inquiry/src/kvRateLimit.ts`. Key `rate:<cf-connecting-ip>`,
value `{ count, resetAt }`, `expirationTtl` equal to the window:

```
allowed  ⇔  count < 5, or the window has expired
retryAfter = 600, or the seconds left in the window
```

| Budget | Window | Max | Key |
| --- | --- | --- | --- |
| contact inquiries | 600 s | 5 | `cf-connecting-ip` (the real client address) |

The client address is `cf-connecting-ip` **only**. Cloudflare sets that header at
the edge; trusting `x-forwarded-for` would let a caller pick their own bucket, and
a missing/unparseable address falls into a single `unknown` bucket rather than
escaping the limit.

Three properties, stated plainly:

- **It is not atomic.** KV has no compare-and-set, so two simultaneous requests
  can both read `4` and both write `5`. Cloudflare's ~1 write/s/key ceiling
  absorbs most bursts, and the result is a bounded overshoot, not an open door.
  A Durable Object keyed by IP would give serialised increments and is the upgrade
  path — still free at this volume.
- **It is a fixed window**, not a log. It starts at the first request, so the
  reset is exact rather than approximate, but a caller can still send five at the
  end of one window and five at the start of the next. The brief fixes the
  semantics and `Retry-After: 600`.
- **It fails open.** If KV cannot be read, the inquiry is accepted and the reply
  carries `X-RateLimit-Degraded: true`. Losing a real inquiry to a broken binding
  is the worse failure.

The order is the point: **Turnstile runs before the counter** (§ 6), so a bot with
a bad token costs zero of the 1,000 free KV writes a day.

### The callables: a sliding-window log in Firestore

`functions/src/security/rateLimit.ts`. A sliding window log, per key:

```
hits = [t1, t2, …]                      ms timestamps, oldest first
allowed  ⇔  |{ t : t > now − windowMs }| < max
retryAfter = oldest + windowMs − now
```

Why a log rather than a counter: a counter is a fixed window, and a fixed window
lets a caller spend the whole budget at 12:00:59 and the whole budget again at
12:01:00. A log has no boundary to step over. It costs one document read and —
only when the request is allowed — one write, which is why it is used on the
boundaries where abuse is expensive.

| Budget | Window | Max | Key |
| --- | --- | --- | --- |
| `booking:submit:1m` | 60 s | 8 | uid (or IP when signed out) |
| `booking:quote:1m` | 60 s | 12 (`QUOTE_RATE_LIMIT_PER_MINUTE`) | uid |
| `booking:verify:1m` | 60 s | 30 | Admin uid |
| `booking:availability:1m` | 60 s | 40 | uid (or IP), **in memory** |

Three decisions worth stating:

- **Keys are hashed.** `rate_limits/{id}` is
  `sha256(RATE_LIMIT_SALT | scope | value)` truncated to 32 hex characters.
  Reading the collection does not produce a log of who tried to contact the
  Hacienda. Set `RATE_LIMIT_SALT` per deployment.
- **It fails open, loudly.** If Firestore is unavailable, the limiter falls back
  to the per-instance window, marks the outcome `degraded`, logs it, and the
  callable reports `degraded` in `details`.
- **The availability projection stays in memory.** It is read-only, a Guest's
  calendar re-renders as they move through the form, and charging a Firestore
  read *and* write per render to police a projection costs more than the abuse it
  prevents. This is documented rather than hidden.

Nothing grows without bound: the stored log is trimmed to the window on every
write, `expires_at` is written for a Firestore TTL policy, and the in-memory
fallback evicts stale keys.

### A 429, in full

From the worker (the browser-facing one):

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json; charset=utf-8
Retry-After: 600
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 600
Access-Control-Allow-Origin: https://haciendadeluisana.com

{
  "success": false,
  "error": {
    "code": "rate_limited",
    "message": "You've submitted too many times. Please wait a few minutes before trying again.",
    "retry_after_seconds": 600,
    "limit": 5
  }
}
```

The form reads `Retry-After` first and the JSON second, disables the button and
counts down (`You can send another in` / `Try again in 599s`). Callables cannot
return a 429 — their transport is always HTTP 200 with an error envelope — so
`submitBooking`, `quoteBooking` and `bookingAvailability` throw
`resource-exhausted` with the same numbers in `details`, and
`src/lib/firebaseFailure.ts#rateLimitNotice` reads them, which is what keeps every
surface speaking the same sentence.

---

## 6. Bots

The worker's checks, cheapest first
(`workers/contact-inquiry/src/index.ts`):

1. **Honeypot** — an input named `hdl_extra`, positioned off-screen (not
   `display:none`, which some fillers skip), `aria-hidden`, `tabIndex={-1}`,
   `autocomplete="off"`. Deliberately *not* named `website` or `company`: those
   are autofilled by password managers, and a false positive loses a Guest's
   inquiry. The browser sends the field and never blocks on it; the worker decides.
2. **Cloudflare Turnstile** — required in production. The token is verified
   **server-side** against
   `https://challenges.cloudflare.com/turnstile/v0/siteverify` (5 s timeout,
   `remoteip` sent). A token minted in the browser is worth nothing until
   Cloudflare confirms it, and a token can only be spent once.

A tripped honeypot is answered **exactly like a success** — `200`,
`{"success": true}`, no id — and logged as `honeypot_tripped`. Nothing else runs:
no siteverify call, no KV write, no email. Telling the sender which field was the
trap teaches the next script to avoid it, and a `400` would spend bandwidth on the
very traffic the trap exists to drop.

A *failed* Turnstile is the one refusal a human sees, because a real person's
challenge may simply have expired:

```json
{ "success": false, "error": { "code": "bot_check_failed",
  "message": "The bot check could not be completed. Please refresh the page and try again." } }
```

If Cloudflare itself is unreachable, the inquiry is **accepted** and the
degradation is logged — unless `TURNSTILE_FAIL_CLOSED=true`, which a deployment
may choose. The default is deliberate: a challenge outage must not close the only
public channel to the estate. Turnstile being *unconfigured* is different and is a
`500 misconfigured`: the Worker will not quietly drop the check in production.

`TURNSTILE_SKIP_VERIFY` exists for local development only and is honoured only
when `ENVIRONMENT=development`; the worker logs `turnstile_skipped` each time.

---

## 7. Configuration

**Worker** (Cloudflare, secrets via `wrangler secret put`, vars in
`wrangler.toml`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | *required* | Verifies the token; missing ⇒ `500` |
| `RESEND_API_KEY` | *required* | Sends the email; missing ⇒ `500` |
| `NOTIFICATION_EMAIL` | *required* | Where inquiries go |
| `FROM_EMAIL` | `Website Inquiry <onboarding@resend.dev>` | Resend sender |
| `ALLOWED_ORIGIN` | the live site, its `www` host, and the two dev ports | CORS allowlist; a preview domain must be added or it is refused |
| `ENVIRONMENT` | `production` | `development` is what unlocks `TURNSTILE_SKIP_VERIFY` |
| `TURNSTILE_FAIL_CLOSED` | `false` | Fail the inquiry if Cloudflare is unreachable |

**Browser** (Vite, `VITE_*` is public — never a secret):

| Variable | Meaning |
| --- | --- |
| `VITE_CONTACT_WORKER_URL` | The deployed worker URL, e.g. `https://contact-inquiry-worker.<sub>.workers.dev` |
| `VITE_TURNSTILE_SITE_KEY` | Renders the Turnstile widget |

Both are read **at call time**, not at import, so a test (or a runtime config)
can supply them. In demo mode — no worker URL and no Firebase project — the form
says the inquiry was kept in this browser rather than claiming it was sent; with a
worker URL but no site key it says the bot check is not configured and refuses to
pretend.

---

## 8. Deploying it

The Worker is a separate deployment from the site, with its own steps and its own
README: [`workers/contact-inquiry/README.md`](../workers/contact-inquiry/README.md)
§ 2. In short:

1. `npx wrangler kv namespace create RATE_LIMIT_KV`, then paste the id into
   `wrangler.toml`.
2. `npx wrangler secret put TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`,
   `NOTIFICATION_EMAIL`.
3. Add any preview origin to `ALLOWED_ORIGIN` (the live site is already listed).
4. `npx wrangler deploy`, then put the printed URL in `VITE_CONTACT_WORKER_URL`
   and the Turnstile site key in `VITE_TURNSTILE_SITE_KEY`, and redeploy the site.
5. Verify from the live site: one real inquiry arrives by email, and a sixth
   submission within ten minutes is `429` with `Retry-After: 600`.

The **Firestore rules** deployment is unchanged and independent:
`firebase deploy --only firestore:rules`. `rate_limits` stays explicitly denied to
every client, and there is no `inquiries` collection at all — the form writes
nothing to Firestore.

If the estate ever verifies a Resend domain, change `FROM_EMAIL`; until then
`onboarding@resend.dev` only delivers to the Resend account owner's address,
which is a Resend rule the worker cannot work around.

---

## 9. Tests

```bash
# the worker, on its own
cd workers/contact-inquiry && npx tsc --noEmit && npx vitest run     # 36 cases

# the website's side of the contract
npx vitest run --config vitest.local.config.ts \
  test/web/contact-schema.test.ts test/web/contact-worker-contract.test.ts \
  test/web/inquiry-api.test.ts test/web/contact-inquiry.test.tsx \
  test/web/contact-inquiry-guard.test.tsx test/web/rate-limit.test.ts

npm run test:functions        # window arithmetic, bot checks, CORS (callables)
npm run test:rules            # rate_limits deny (needs the phase-0 launcher)
```

What is covered: on the worker side, every branch of the handler with a fake KV
and a stubbed `fetch` — CORS preflight and refusal, the method gate, body size,
the honeypot answering `200` while spending nothing, schema refusal with
`fields`, Turnstile pass/fail/skip/unreachable/fail-closed, the sixth request
being `429` with `Retry-After: 600`, two IPs not sharing an allowance, a spoofed
`X-Forwarded-For` being ignored, KV failure degrading to `200`, Resend's exact
payload and each way it can fail, and the log never carrying the Guest's words or
address. On the website side: the schema's acceptance and refusal, the payload
the form builds, `429`/`400`/`403`/network handling and the countdown, the demo
label, and the widget-less state.

**What the tests do not do:** there is no emulator for KV and no automated test
against a deployed worker. The handler is exercised directly (not over HTTP), so
the first live check in § 8.5 is part of the verification, not a formality.

---

## 10. What this does not do

- **Client cooldowns are not security.** `src/lib/rateLimit.ts` is deletable from
  a console. It exists so a double-tap gets an instant countdown instead of a
  wasted request; the server's window is the enforcement.
- **KV is not a lock.** No compare-and-set, so the counter can overshoot under
  concurrency, and the window is fixed rather than sliding. Both are properties of
  the free tier, not oversights; the Durable Object upgrade path is written down
  in the worker's README § 6.
- **One bucket per IP, not per email.** The worker does not read the submitted
  address into a key — an address is Guest-supplied and unverified, and hashing it
  into a counter would key the limit on whatever the attacker types. The Resend
  free tier (100/day) plus Turnstile is the backstop.
- **Sign-in and sign-up are paced by Firebase Auth, not by this repository.**
  Auth's brute-force protection is real and managed outside the code; its
  `auth/too-many-requests` is surfaced. No additional server-side limiter was
  added in front of Auth because a function that only wraps a public Auth
  endpoint is bypassable — the attacker calls Auth directly.
- **Chat and reviews are rules-bound, not callable-throttled.** Their lengths,
  authors and edit windows are enforced by `firestore.rules`; their pacing is UX.
- **The callables cannot deploy on the Spark plan.** Everything in § 3 that names
  a callable describes the design, not the current live behaviour. The contact
  form is the one path that had to work regardless, which is why it moved.
- **Spam content is not classified.** No ML, no blocklist, no Akismet. The
  defences are shape, pace, a trap and a challenge; a human still reads every
  inquiry.
- **The two schemas are a contract, not a compiler.** The contract test proves the
  sides agree on limits and on what parses; it does not prove either is *correct*.
  The rest of § 9 is what does that.
- **An IP behind a proxy is only as good as the header.** `cf-connecting-ip` is
  the edge's word; a caller who reaches the worker directly still gets whatever
  Cloudflare fronted them with, not a header they chose. That is the best an IP
  limit can be.
