# Hacienda Booking Worker

This Cloudflare Worker is the free-tier host for the four browser-facing
Booking endpoints that previously required Firebase Cloud Functions:

- `POST /bookingAvailability`
- `POST /submitBooking`
- `POST /quoteBooking`
- `POST /verifyBookingMoney`

It speaks Firebase's HTTPS callable protocol, so the website still uses the
Firebase client SDK to attach the caller's ID token and decode structured
errors. Firebase Auth and Firestore remain the systems of record. The Worker
verifies Firebase ID tokens against Google's secure-token JWKS, obtains a
Google OAuth token from a dedicated service account, and calls the Firestore
REST and Identity Toolkit APIs. All price, availability, rate-limit, and
transaction decisions are shared with the Firebase implementation through the
platform-neutral cores in `../functions/src`.

Firestore-triggered Admin notifications, FCM delivery, and the legacy
device-token callables are intentionally **not** part of this phase. They have
no direct Firestore-trigger equivalent in a Worker and need a separate,
idempotency-safe design.

## Safety rules

- Never commit, paste into chat, screenshot, or upload the service-account JSON
  key. Keep the downloaded file outside this repository.
- `VITE_WORKER_API_URL` is only the Worker's public `https://...` base URL. It
  is not a secret, but it must never be confused with the service-account key.
- Do not turn on `site_config/booking.quotes_required` or
  `site_config/booking.callable_booking_required` until the Worker and website
  cutover have been smoke-tested together.
- If the private key is ever exposed, delete that key in Google Cloud IAM,
  create a replacement, and update the Cloudflare secret.

## Google Cloud prerequisites

Use a dedicated service account for this Worker. It needs only:

- **Cloud Datastore User** (`roles/datastore.user`) — Firestore reads, writes,
  queries, and transactions.
- **Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) — the
  Identity Toolkit lookup used to reproduce the Admin account checks for
  `verifyBookingMoney`.

Do not grant Owner, Editor, Firebase Admin, or service-account token-creator
roles for this phase. FCM permissions are deferred.

In Google Cloud Console, confirm these APIs are enabled for the Firebase
project:

- Cloud Firestore API (`firestore.googleapis.com`)
- Identity Toolkit API (`identitytoolkit.googleapis.com`)

The expected Firestore database ID is `(default)`. If the project uses a named
database, update `FIREBASE_DATABASE_ID` in `wrangler.jsonc` before deploying.

## Configuration

Non-secret production defaults live in `wrangler.jsonc`:

| Variable | Production value / purpose |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `hacienda-de-luisana` |
| `FIREBASE_DATABASE_ID` | `(default)` |
| `BOOKING_QUOTES_ENABLED` | `true` |
| `QUOTE_TTL_MINUTES` | `30` |
| `QUOTE_RATE_LIMIT_PER_MINUTE` | `12` |
| `VERIFY_RATE_LIMIT_PER_MINUTE` | `30` |
| `SUBMIT_RATE_LIMIT_PER_MINUTE` | `8` |
| `ALLOWED_ORIGINS` | the production website origins, exact-matched for CORS |

The credential is a Cloudflare secret, not a Wrangler variable:

- Preferred: `FIREBASE_SERVICE_ACCOUNT_JSON`, containing the complete JSON key.
- Alternative: `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and optionally
  `FIREBASE_PRIVATE_KEY_ID`.

## Local development

From the repository root:

```powershell
npm --prefix workers install
Copy-Item workers\.dev.vars.example workers\.dev.vars
```

Replace the example JSON in `workers/.dev.vars` with the real one-line JSON
from the key kept outside the repository. `.dev.vars` is ignored by Git; still
check `git status` before committing anything. Then run:

```powershell
npm run worker:dev
```

Wrangler serves the Worker at `http://localhost:8787` by default. For the
website's local `.env`, use:

```dotenv
VITE_WORKER_API_URL=http://localhost:8787
```

Production builds reject non-HTTPS Worker URLs except for this local
development case.

## Deployment order

### 1. Deploy and finish the Firestore indexes

The overlap query used by availability and submit needs the composite index
already declared in the repository root's `firestore.indexes.json`:

```powershell
firebase deploy --only firestore:indexes
```

Wait in Firebase Console → Firestore Database → Indexes until the relevant
indexes show **Enabled**, not Building. A Worker call made too early can fail
with Firestore `FAILED_PRECONDITION`.

### 2. Log in and deploy the Worker shell

```powershell
cd workers
npm install
npx wrangler login
npm test
npx wrangler deploy --dry-run
npm run deploy
```

If Wrangler asks you to register a `workers.dev` subdomain, choose the account
subdomain you want; it becomes part of the Worker's public URL. Note the
deployed `https://hacienda-de-luisana-api.<subdomain>.workers.dev` URL.
Before its secret is set, `/health` should return HTTP 503 with
`configured: false`; that is expected and proves the Worker is not pretending
to have Google credentials.

### 3. Add the service-account secret without printing it

Keeping the key file outside the repository, pipe it to Wrangler in
PowerShell. Replace the path with that outside-repo location:

```powershell
Get-Content -Raw "C:\path\outside\repo\service-account-key.json" |
  npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
```

Do not use `echo`, do not paste the JSON as a command argument, and do not save
it under `workers/`.

### 4. Verify health

```powershell
Invoke-RestMethod "https://hacienda-de-luisana-api.<subdomain>.workers.dev/health"
```

Expected result: HTTP 200, `ok: true`, `configured: true`, and all four
endpoint names. Health proves configuration parsing only; it does not call
Google or prove IAM/index readiness.

### 5. Smoke-test availability before changing the website

Use an exact published accommodation name from `site_config/rates`:

```powershell
$worker = "https://hacienda-de-luisana-api.<subdomain>.workers.dev"
$body = @{
  data = @{
    accommodation = "<exact published accommodation>"
    from = "2027-01-01"
    to = "2027-01-03"
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post `
  -Uri "$worker/bookingAvailability" `
  -ContentType "application/json" `
  -Body $body
```

The response must be `{ "result": { ... "days": [...] } }`, with no Booking or
Guest details. Test authenticated quote/submit through the real website, where
Firebase supplies the ID token, rather than by copying a token into a shell.

### 6. Point a website build at the Worker

Set this in the website host's environment (or local `.env` for a test build):

```dotenv
VITE_WORKER_API_URL=https://hacienda-de-luisana-api.<subdomain>.workers.dev
```

Vite values are baked into the website at build time, so rebuild and redeploy
the website after changing it. With the variable unset, the website preserves
the Firebase callable path and the existing Spark/direct-Firestore fallback;
that is also the rollback: remove the variable and redeploy the website.

### 7. Production cutover checks

Before enabling any Firestore Admin enforcement switch, verify:

1. Signed-in/anonymous Guest quote succeeds and writes a client-unreadable
   `booking_quotes/{quoteId}` document.
2. Guest submit creates exactly one Booking and its first `activity/0` entry.
3. A second overlapping submit cannot take the last unit.
4. `verifyBookingMoney` accepts an authorized Admin and refuses a Guest.
5. Cloudflare logs show no repeated `UNAUTHENTICATED`, `PERMISSION_DENIED`, or
   `FAILED_PRECONDITION` errors.

Watch logs with:

```powershell
cd workers
npx wrangler tail
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `/health` returns 503 | Secret missing, malformed, or for a different project. |
| Endpoint returns `UNAUTHENTICATED` | Firebase project mismatch, malformed `Authorization`, or expired/invalid ID token. |
| Firestore `PERMISSION_DENIED` | Service-account role missing or the Firestore/Identity Toolkit API is disabled. |
| Firestore `FAILED_PRECONDITION` on availability/submit | Composite index missing or still building. |
| Browser CORS error | The exact website origin is absent from `ALLOWED_ORIGINS`. |
| Quote returns service-disabled | `BOOKING_QUOTES_ENABLED` is not `true` in the deployed Worker. |
| Website still calls Firebase | `VITE_WORKER_API_URL` was not present during the website build, or emulator mode is active. |

## Tests

From the repository root:

```powershell
npm run test:worker
npm run test:functions
```

The Worker suite covers configuration parsing, service-account JWT signing,
Firebase ID-token verification, Firestore REST encoding/queries/transactions,
Identity Toolkit lookup, callable envelopes/errors, and CORS. The Functions
suite remains the authority for the shared Booking core's pricing,
availability, submit, and rate-limit behaviour.
