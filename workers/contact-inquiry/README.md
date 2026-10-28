# contact-inquiry-worker

The website's public contact form endpoint, on Cloudflare's free tier.

The Firebase project runs on the **Spark (free) plan**, which cannot deploy Cloud
Functions — so this one feature, which genuinely needs a server (validate, verify
a Turnstile token, count by IP, send an email), lives here instead. It costs
nothing at this volume and needs no credit card.

```
browser ──POST──▶ Worker ──▶ Turnstile siteverify   (is this a person?)
                    │
                    ├────────▶ KV  rate:<ip>        (is this the 6th in 10 min?)
                    │
                    └────────▶ Resend /emails       (tell the Hacienda)
```

Read [`docs/FORMS_SECURITY.md`](../../docs/FORMS_SECURITY.md) for how this fits
with the rest of the site's forms, and
[ADR-0024](../../docs/adr/0024-the-public-form-runs-on-a-cloudflare-worker.md)
for why it is here rather than in `functions/`.

---

## 1. What it accepts and what it answers

`POST /` with `Content-Type: application/json`:

```json
{
  "name": "Ana Reyes",
  "email": "ana@example.com",
  "subject": "Wedding photoshoot inquiry",
  "phone": "09171234567",
  "message": "We would like to ask about a weekend shoot for twelve people.",
  "turnstileToken": "0.abc…",
  "hdl_extra": ""
}
```

`subject` and `phone` are **optional additions** to the brief's five fields; the
schema is `.strict()`, so a key it does not know is a `400`. `hdl_extra` is the
honeypot and must be empty.

Every reply is one envelope:

| Status | When | Body |
| --- | --- | --- |
| `200` | sent — **or** a tripped honeypot (a deliberate fake success) | `{ "success": true, "id": "<resend id>" }` |
| `400` | the body failed the schema | `{ "success": false, "error": { "code": "invalid_input", "message": "…", "fields": { "email": "…" } } }` |
| `403` | Turnstile refused the token, or the `Origin` is not allowed | `{ …, "error": { "code": "bot_check_failed" \| "origin_not_allowed" } }` |
| `405` | not `POST` | `Allow: POST, OPTIONS` |
| `413` / `415` / `400` | body over 8 KB, not JSON, or unparseable | `payload_too_large`, `unsupported_media_type`, `invalid_json`, `empty_body` |
| `429` | more than 5 in 10 minutes from one IP | `{ …, "error": { "code": "rate_limited", "retry_after_seconds": 600 } }` + `Retry-After: 600` |
| `500` | a binding or secret is missing | `{ …, "error": { "code": "misconfigured" } }` — logged with the missing name |
| `502` / `503` | Resend refused, or could not be reached | `{ …, "error": { "code": "send_failed" } }` |

A `429` also carries `RateLimit-Limit`, `RateLimit-Remaining` and
`RateLimit-Reset`, and `X-RateLimit-Degraded: true` when KV could not be read and
the limiter stood down (see § 6).

---

## 2. First deploy, in order

### a. Log in and create the KV namespace

```bash
cd workers/contact-inquiry
npx wrangler login
npx wrangler kv namespace create RATE_LIMIT_KV
```

The command prints something like:

```
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
```

Paste that `id` into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

### b. Get a Turnstile key pair

Cloudflare dashboard → **Turnstile** → *Add site* → add the production domain
(and `localhost` if you want to test the real widget locally).

- **Site key** → the browser: `VITE_TURNSTILE_SITE_KEY`
- **Secret key** → the worker: `TURNSTILE_SECRET_KEY` (§ c)

The token the widget produces is worthless until the worker verifies it against
Cloudflare with the *secret*, which never leaves the worker. That verification is
the bot defence; the widget alone is decoration.

### c. Set the secrets

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY   # from the Turnstile dashboard
npx wrangler secret put RESEND_API_KEY         # from https://resend.com/api-keys
npx wrangler secret put NOTIFICATION_EMAIL     # where inquiries should arrive
```

`wrangler secret put` prompts for the value and stores it encrypted; it is never
written to `wrangler.toml`, which is committed. Re-running it replaces the value.

### d. Point the website at it

```bash
# .env.local (or the hosting dashboard's environment)
VITE_CONTACT_WORKER_URL=https://contact-inquiry-worker.<your-subdomain>.workers.dev
VITE_TURNSTILE_SITE_KEY=<the site key>
```

Both are `VITE_*`, i.e. **public** — which is correct for a site key and a
worker URL, and is why the secret is a worker secret instead.

`wrangler deploy` prints the exact `workers.dev` URL. A custom domain
(e.g. `inquiries.haciendadeluisana.com`) works too, via the dashboard's *Custom
Domains* tab, and is nicer in logs.

### e. Deploy

```bash
npx wrangler deploy
```

### f. Prove it works

```bash
# A real send, from the site's own origin (the CORS allowlist):
curl -i -X POST "$VITE_CONTACT_WORKER_URL" \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3000' \
  -d '{"name":"Ana Reyes","email":"ana@example.com","message":"A ten-character-plus message.","turnstileToken":"<a real token>"}'
```

Then send six in a row from the page: the sixth must be `429` with
`Retry-After: 600`. Watch the live log with `npx wrangler tail`.

---

## 3. Resend's free tier, honestly

- **`onboarding@resend.dev` only delivers to the Resend account owner's own
  address.** Until a domain is verified in Resend, `NOTIFICATION_EMAIL` must be
  that address or Resend answers `403`. This is Resend's rule, not the worker's.
- **Verify the estate's domain** (Resend → Domains → add `haciendadeluisana.com`,
  add the DNS records), then set `FROM_EMAIL` in `wrangler.toml` to
  `"Website Inquiry <inquiries@haciendadeluisana.com>"`. Now the notification can
  go to any address, and the email looks like the estate rather than a test
  sender.
- **100 emails a day** on the free tier. The 5-per-10-minutes limit per IP is
  what keeps a flood from eating it.
- The worker sends **plain text only** (`text`), deliberately: no HTML template
  means nothing to escape, and an inquiry is a message, not a brochure.

---

## 4. Configuration reference

`wrangler.toml` `[vars]` — public, committed, per-environment:

| Var | Default | Meaning |
| --- | --- | --- |
| `ENVIRONMENT` | `production` | `development` unlocks `TURNSTILE_SKIP_VERIFY`; a deploy cannot inherit it |
| `ALLOWED_ORIGIN` | `https://haciendadeluisana.com`, the `www` host, and the two dev ports | Comma-separated CORS allowlist. Add any preview domain, or the browser is refused |
| `NOTIFICATION_EMAIL` | *(empty)* | Where inquiries go; also settable as a secret |
| `FROM_EMAIL` | `Website Inquiry <onboarding@resend.dev>` | Resend sender |

Secrets — `wrangler secret put`:

| Secret | Required | Meaning |
| --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | yes | Verifies the token. Missing ⇒ the worker answers 500 rather than skipping the check |
| `RESEND_API_KEY` | yes | Sends the email. Missing ⇒ 500 |
| `NOTIFICATION_EMAIL` | yes (here or in `[vars]`) | The recipient |

Optional:

| Var | Meaning |
| --- | --- |
| `TURNSTILE_FAIL_CLOSED` | `true` makes an unreachable Cloudflare a `503` instead of accepting the inquiry |

### Local development

```bash
cp .dev.vars.example .dev.vars   # fill it in; gitignored
npx wrangler dev                 # http://localhost:8787
```

`.dev.vars` sets `ENVIRONMENT = "development"`, which is what allows
`TURNSTILE_SKIP_VERIFY` — so a local run needs no real token. That bypass is
refused in production by construction, and the worker logs
`turnstile_skipped` every time it is used. Point the site at the dev worker by
setting `VITE_CONTACT_WORKER_URL=http://localhost:8787` and adding
`http://localhost:3000` to `ALLOWED_ORIGIN` (it is there by default).

---

## 5. Why the steps are in that order

1. **CORS, method, config, body size, JSON** — refuse before parsing.
2. **Honeypot** — before anything that costs money or quota. A filled trap gets
   `200 { "success": true }` and nothing happens: no Turnstile call, no KV write,
   no email. A `400` naming the field would teach the next script which one to
   leave empty.
3. **Schema** — normalise, then measure; refuse, never truncate; `.strict()`.
4. **Turnstile** — before the rate limit, as the brief specifies: a bot with a bad
   token must not be able to burn the 1,000 free KV writes a day.
5. **Rate limit** — before Resend, because the free tier is 100 emails a day.
6. **Resend** — one plain-text email, `reply_to` the Guest so the Admin can just
   answer.

---

## 6. The limits of KV rate limiting (read this before trusting it)

The counter is a plain KV value, `rate:<ip>` = `{ count, resetAt }`, written with
`expirationTtl` so it deletes itself. That buys the whole design for free, and it
also means three caveats that are **not** bugs to fix but properties to accept:

- **The read-modify-write is not atomic.** KV has no compare-and-set. Two
  simultaneous requests from one IP can both read `4` and both write `5`. The
  overshoot is bounded by concurrency, and Cloudflare limits writes to roughly one
  per second per key, which absorbs most bursts. *Exact* enforcement needs a
  Durable Object keyed by IP (one instance, serialised increments) — that is the
  upgrade path, and it is still on the free plan.
- **The window is fixed, not sliding.** It starts at the first request and is
  stored, so the reset is exact (the TTL is housekeeping). A caller can still send
  five at 09:59 and five at 10:00. `Retry-After` reports the whole 600 seconds, as
  the brief specifies.
- **It fails open.** If KV cannot be read, the inquiry is accepted and the reply
  carries `X-RateLimit-Degraded: true`. Losing a real inquiry because a binding
  broke is the worse failure.

The boundary that does not depend on any of this is Turnstile plus the schema.

---

## 7. Tests

```bash
npm install
npx tsc --noEmit     # the worker compiles
npx vitest run       # 36 cases, no network, no Cloudflare
```

The suite runs the **real handler** with a fake KV namespace and a stubbed global
`fetch`, so it exercises the CORS branch, the trap, the schema, the Turnstile
request, the counter and the email payload as the worker actually runs them.
It covers, among others:

- preflight from an allowed origin; refusal of an unknown one, with no `fetch`
  and no KV write spent;
- the honeypot answering `200` and spending nothing;
- `403` on a bad or reused token, with **zero** KV reads and writes (the
  brief's ordering, asserted);
- `TURNSTILE_SKIP_VERIFY` refused in production and honoured in development;
- `429` on the sixth request, with `Retry-After: 600`, and no Resend call;
- two IPs not sharing an allowance; a spoofed `X-Forwarded-For` ignored;
- KV failure degrading to `200` with the degraded header;
- Resend's payload, its 422, an unreachable Resend, and a `200` with no `id`;
- the log never containing the Guest's address or words;
- the **committed** `wrangler.toml` allowing the site's real origin
  (`SITE_ORIGIN` in `src/config/site.ts`) and not shipping a secret — a worker
  deployed with a localhost-only allowlist refuses every Guest, and the failure
  looks like a console error nobody reads.

There is no automated test against a **deployed** worker, and no emulator for KV:
the first run of § 2f is part of the verification, not a formality.

---

## 8. Operating it

```bash
npx wrangler tail                 # live logs (JSON lines, one per request)
npx wrangler deployments list     # what is live
npx wrangler rollback             # back to the previous deployment
```

Logs are structured and deliberately exclude the Guest's name, email and message —
`inquiry_sent` carries the Resend id and the IP only. If an inquiry needs to be
traced, the Resend dashboard has the email.

To change a limit, edit `RATE_LIMIT` in `src/kvRateLimit.ts` and redeploy; the
numbers are also printed in `Retry-After`, `RateLimit-Limit` and the JSON body, so
nothing drifts.

---

## 9. Free-plan limits to stay inside

| Resource | Free allowance | What it means here |
| --- | --- | --- |
| Worker requests | 100,000 / day | years of inquiries |
| Worker CPU | 10 ms / request | this handler is a few `fetch` calls — well inside |
| KV reads | 100,000 / day | one per allowed request |
| KV writes | **1,000 / day** | one per allowed request — hence Turnstile *before* the counter |
| KV storage | 1 GB | a few hundred bytes per key |
| Turnstile | free, unlimited | — |
| Resend | 100 emails / day | one per inquiry |

The 1,000 KV writes a day is the tightest number in the design. If it ever
becomes the limit, the fix is a Durable Object (billed per request, still free at
this volume) rather than trusting KV harder.
