# Verification — Hacienda de LuisAna

What was **executed**, on which machine, and what the results were. Written to be
read against `docs/LIMITATIONS.md`: nothing here is marked Verified that was not
run, and everything that could not run says so and says why.

Reproduce everything on this page:

```bash
npm test           # web suite (vitest, jsdom)          → 21 files / 344 tests
npm run test:rules # rules (in-repo evaluator)           → 3 files / 135 tests
npm run test:e2e   # the 37-step scenario + its record   → 39 tests
npm run build      # tsc -b && vite build                → dist/ built
npm run test:emulator   # canonical rules check — NEEDS Java + network (see §3)
```

---

## 1. Environment

| Thing | What this machine has | Consequence |
| --- | --- | --- |
| Node | v22.22.3 | web suite, rules suite, E2E scenario all ran |
| npm | 10.9.8 | dependencies installed from `package-lock.json` |
| Vitest | 3.2.7 | the three suites above |
| Vite / TypeScript | 5.4.21 / `tsc -b` | production build ran |
| firebase-tools | 15.31.0 (npx) | CLI present, **emulator JAR unobtainable** (§3) |
| Java runtime | **absent** | the Emulator Suite cannot start at all here |
| Flutter / Dart SDK | **absent** | `flutter analyze`, `flutter test`, `flutter build apk` were **not run** |
| Python | 3.11.2 + `tree-sitter` + `tree-sitter-dart` (repo-external venv) | used to parse all 44 Dart files: no syntax errors |
| Network | npm registry, github.com, pypi reachable; `storage.googleapis.com` not | emulator download fails; GitHub workflow-file pushes rejected |

**Flutter is not verified.** The Admin app's Dart was deleted-from/edited and
parsed (`lib/**` — 44 files, 0 parse errors), but nothing was compiled, analysed
or run. Every Admin-app claim in this document is either lifecycle logic executed
through the web modules or rule text executed by the in-repo evaluator.

## 2. Tests

| Suite | Command | Result |
| --- | --- | --- |
| Rules engine semantics | `npm run test:rules` | 28 / 28 |
| Firestore rules (rule text executed) | `npm run test:rules` | 86 / 86 |
| Storage rules (rule text executed) | `npm run test:rules` | 21 / 21 |
| **Rules total** | | **135 / 135** |
| Web unit + component + integration | `npm test` | 21 files / **344 / 344** |
| End-to-end scenario (this document, §4) | `npm run test:e2e` | **39 / 39** (37 steps + reset + record printer) |
| Production build | `npm run build` | `dist/` built, 133 modules, no type errors |
| Flutter analyze / test / APK | `flutter …` | **not run — no SDK** (🔴 Blocked) |
| Firebase Emulator rules suite | `npm run test:emulator` | **not run — no Java, JAR unreachable** (🔴 Blocked) |

Baseline note: the web suite includes text-assertion rules tests from before the
evaluator existed; they are kept (they pin the *file's* text) but the executed
checks in §3 are the ones with authority.

## 3. P1 — Firestore / Storage rules verification

### 3.1 The Emulator could not run

Three attempts, in order, none of them retried after this:

```
$ npx firebase --project demo-hacienda emulators:exec --only firestore "echo HELLO"
Error: Could not spawn `java -version`. Please make sure Java is installed and on your system PATH.

$ npx firebase setup:emulators:firestore
Error: Failed to make request to https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar

$ curl -sS https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar -o /tmp/x.jar
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to storage.googleapis.com:443
```

So: **no rule in this repository is emulator-verified.** Every rule result below
is *rule text executed by the in-repo evaluator* (`test/rules/engine.ts` parses
the real `firestore.rules` / `storage.rules` with the `@firebase/rules-unit-testing`
ANTLR grammar and evaluates the request against them). The canonical check
already exists in `test/emulator/rules.emulator.test.ts` (auth, bookings,
activity, payments/references, chat, reviews, smart lock, tracker, storage — plus
four `console.info` probes for the open questions); it runs with
`npm run test:emulator` on a machine that has Java and can reach
`storage.googleapis.com`. Run it before treating any ⚠️ below as settled.

| Checked how | Count |
| --- | --- |
| Emulator-verified | **0** |
| Rule-text-executed (in-repo evaluator, real rules file) | 107 rule assertions + 16 recorded findings/semantics cases |
| Executed application code (website modules, offline adapters) | 20 of the 37 E2E steps |

### 3.2 What each required area shows

| Area | Required | Actual result (rule text) |
| --- | --- | --- |
| **Auth** | guest/client identity works | ✅ signed-out visitor may create a Booking with its own uid; anonymous Guest may read own Booking |
| | unauthorized denied | ✅ another Guest's Booking denied; promoted non-allowlisted Admin denied the Admin-only paths |
| | unauthenticated denied | ✅ signed-out read of a Booking denied; unauthenticated Admin write denied |
| | admin works | ✅ allowlisted Admin reads any Booking, approves, verifies, deletes |
| **Bookings** | own read | ✅ |
| | other-user denial | ✅ (get + list) |
| | protected-field denial | ✅ status → Approved/Reserved, `uid` re-point, `amount_verified`, `payment_verified_by`, refund fields, `guests` all denied |
| | admin ops | ✅ approve/reject/verify/delete, terminal-status guard holds, no status skip |
| **Payments** | guest submits proof | ✅ proof keys accepted on own `Payment Pending` Booking |
| | cannot set verified | ❌ **Finding 1** — see below |
| | cannot touch verification fields | ✅ `amount_verified`, `payment_verified_at`, `payment_verified_by` denied |
| | admin verify/reject | ✅ |
| | duplicate reference rejected | ⚠️ Partial — catalogue is Admin-only (guest read/write denied), `matchPaymentReference` flags a used reference (`duplicate: true`, `status: 'rejected'`) and is unit-tested + exercised in step 19, but **no screen consumes it yet** (the Flutter app never queries `payment_references`) |
| **Reviews** | eligible create | ✅ own-uid, 1–5 stars, fixed keys accepted |
| | ineligible denied | ⚠️ app-level only (Finding 5) |
| | another user's booking denied | ⚠️ app-level only (Finding 5) |
| | duplicate rejected | ⚠️ app-level only (Finding 5) |
| **Chat** | own conversation only | ✅ messages readable only by the conversation's `guest_uid` or the Admin |
| | admin access | ✅ read + reply |
| | sender identity not spoofable | ✅ `sender_uid == request.auth.uid` enforced — but see Finding 4 and Finding 6 |
| **Smart Lock** | authorized allowed | ✅ contract replay: Reserved/Staying booking on valid dates → granted; the `access_logs` row the contract writes (`uid`, `ref_id`, `result`, `reason`, `timestamp`) is accepted |
| | unauthorized denied | ✅ revoked credential, wrong dates, unapproved stay all deny, and the denial row is accepted |
| | logs per canonical contract | ✅ signed-in create only; `result in ['granted','denied']`; uid must be the writer's; update/delete refused to Guests (audit integrity) |
| **Tracker** | create/read/update denied | ✅ denied to every caller — the Guest **and** the Admin allowlist; Admin `delete` remains so an orphan can be erased |
| | no legitimate access-log function broken | ✅ `access_logs` writes/reads unaffected; `bookings/{id}/activity` untouched; tests still green after the removal |

### 3.3 Findings (rules allow what the policy means to forbid)

Recorded as executable `FINDING:` tests so a fix is visible as a red test;
documented here rather than silently patched, because changing the rules is a
policy decision.

1. **High — a Guest can set their own `payment_status` to `verified`.** The
   self-serve key list checks key *names*, not values, and `payment_status` is on
   it. The Admin-only fields around it are protected, so the Booking still shows
   unverified money in the app, but the database accepts the status.
2. **Medium — `Reserved` is reachable from `Payment Pending` with
   `payment_status` still `pending`.** The gate reads the previous status; it does
   not require the money to be verified in the same write.
3. **Medium — Activity entries: `actor` must be the writer's role, `actor_id` is
   never compared with the writer's uid.** A Guest can file an entry naming
   another Guest as the actor.
4. **Low/Medium — a signed-in stranger can post into a conversation they do not
   own.** The message rule checks the sender, not the conversation. They cannot
   read it back (reads do check `guest_uid`), but the inbox will show it.
5. **Medium — Reviews have no rule-level eligibility, ownership or duplicate
   check.** `src/lib/reviewsCloud.ts` does all three; a console skips the app.
6. **Low — `sender_role` is not checked against the writer's real role.** A Guest
   can label their own message as an Admin's (display spoofing; `sender_uid`
   stays honest).

**One open semantics question (needs the Emulator):** `role()` for an anonymous
Guest reads `request.auth.token.email`. Under the strict reading of
`request.resource.data` key access, the `activity` create clause refuses an
anonymous Guest, so a Guest's audit trail would never fill in production; under
the null-for-missing-key reading it is allowed. The offline suite asserts **both**
branches (`SEMANTICS:` test) and the emulator suite carries the same case. This is
the single place where a rule's real-world effect is not settled here.

### 3.4 Emulator-verified vs not — one line

**Emulator-verified: nothing.** Rule-text-executed: all 135 rules tests, all 16
findings/semantics cases, §3.2, steps 18, 19, 22, 24–27, 30, 31, 34–37 of the E2E
record. Application-executed (website modules, offline adapters): steps 1–17,
20, 21, 23, 28, 29, 32, 33.

## 4. P8 — the 37-step end-to-end scenario

`test/e2e/final-scenario.e2e.test.ts`, run by `npm run test:e2e`. Each step
asserts its own outcome and prints a line; `executed` = real website modules on
their documented offline adapters, `rule-text` = the real rules file through the
evaluator, `contract` = the ESP32 contract in `docs/SMART_LOCK.md` (no lock
firmware exists in this repository) replayed against the rules.

```
=== final end-to-end scenario: 37 steps ===
 1 | Guest registers (email + password) and the session resolves guest                              | executed  | role=guest, status=signed-in, uid=f3614dae…
 2 | Registration cannot mint an Admin; the guest permission set holds no verify/approve power      | executed  | guest permissions=4, cannot verify payments
 3 | No admin route exists on the website; an Admin session is sent home, not to a dashboard        | executed  | guest→/account allowed, admin→/account refused
 4 | Sign-out clears the session, sign-in restores the same identity                                | executed  | uid stable=true
 5 | Availability quote for the requested dates                                                     | executed  | available=true, conflicts=0
 6 | Booking created                                                                                | executed  | status=Pending, hold=24.00h, ref=HDL-5420
 7 | Submit logged; the Booking is visible to its owner and to nobody else                          | executed  | activity=Submit, other guest sees 0
 8 | Double-booking the held dates is refused by the availability re-check                          | executed  | conflicts=1
 9 | Terms acceptance carries the current version and a timestamp                                   | executed  | version=2026-09-24, re-acceptance required on version change=true
10 | KYC file contract (5 MB, image only, own-uid path)                                             | executed  | oversized refused, PDF refused, 2 MB JPEG accepted
11 | KYC uploaded                                                                                   | executed  | status=KYC Submitted, kyc_status=submitted
12 | Admin refuses a blurred ID; the Guest resubmits and the Booking returns to KYC Submitted       | executed  | rejected → resubmitted
13 | Admin approves after the availability re-check                                                 | executed  | status=Approved, re-checked against 2 stored Booking(s)
14 | Payment plan chosen; policy version stamped on the Booking                                     | executed  | status=Payment Pending, due=4500, policy=2026-09-24
15 | Proof file contract and object path                                                            | executed  | path=payments/{uid}/HDL1/proof.png, limit=5MB
16 | Receipt text extraction fills reference + amount for confirmation only                         | executed  | clean receipt → ref=1234567890123, amount=4500.00, confidence=high; prose receipt captured "RECEIPT" (misread — text extraction is best-effort); autoVerify=false
17 | Proof submitted                                                                                | executed  | payment_status=pending, verified_at=unset
18 | Guest-issued verification fields are refused by firestore.rules                                | rule-text | payment_status=verified → denied; amount_verified → denied
19 | Payment-reference catalogue is Admin-only, so a used reference cannot be re-listed by a client | rule-text | guest write denied, guest read denied, admin write allowed
20 | Rejected proof → resubmission                                                                  | executed  | rejected (rejected) → after resubmit pending, status still Payment Pending
21 | Admin verification                                                                             | executed  | underpayment (6000) refused, 6500 verified → Reserved
22 | Collection reads are Admin-only; a Booking is readable only by its owner or the Admin          | rule-text | admin list allowed, guest list denied, other guest get denied
23 | Check-in → Staying                                                                             | executed  | status=Staying
24 | Authorized unlock                                                                              | contract  | decision=granted; access_logs create accepted by rule text
25 | Unknown credential                                                                             | contract  | decision=denied (unknown credential); denied row accepted by rule text
26 | Revoked credential, wrong dates, unapproved stay                                               | contract  | all denied: credential revoked; outside the stay dates; booking is Approved
27 | Access-log tampering                                                                           | rule-text | update denied, delete denied, forged writer denied, invalid result denied
28 | Check-out → Completed, with the whole stay on the Activity log                                 | executed  | status=Completed, activity entries=14
29 | Guest conversation and message                                                                 | executed  | convo=local:f3614dae-25c1-40a0-9b9e-430039e4b289, message delivered to the guest view
30 | Sender identity and conversation ownership                                                     | rule-text | own sender allowed; spoofed sender denied; FINDING: a stranger may post into a conversation they do not own
31 | Admin reply                                                                                    | rule-text | admin read allowed, admin message accepted
32 | Review eligibility                                                                             | executed  | before check-out refused, after Completed accepted
33 | Duplicate Review                                                                               | executed  | refused with "You already reviewed this stay."
34 | Review shape                                                                                   | rule-text | own uid + 5 stars allowed; 6 stars denied; another uid denied
35 | Privilege escalation through the Booking document                                              | rule-text | Approve denied, identity swap denied, delete of another guest’s booking denied
36 | Tracker collection and KYC storage slot                                                        | rule-text | tracking_sessions read/create denied for guest and Admin; uploading into another guest’s KYC slot denied
37 | Cross-user document access                                                                     | rule-text | other guest’s KYC read denied, Admin read allowed, guest rates write denied, own payment proof write allowed
```

Reading the record honestly: `executed` steps ran the shipped modules, but on the
offline adapters (localStorage) — the Firestore documents they would write in
production were not written, because there are no credentials and no emulator in
this environment. Step 30 records a **finding** rather than a pass-only result.
Steps 24–26 are the ESP32 contract; the lock's own behaviour is firmware, out of
this repository.

## 5. End-to-end workflow table

| Workflow | Status | Evidence |
| --- | --- | --- |
| Registration | ⚠️ Partial | Steps 1–4 executed on the local adapter; Firebase Auth path not executed (no credentials/emulator); no role can be minted but guest |
| Booking | ⚠️ Partial | Steps 5–8, 11–13, 20, 21, 23, 28 executed end-to-end locally (Pending → KYC → Approved → Payment → Reserved → Staying → Completed, 14 Activity entries); cloud writes unexecuted |
| Terms | ⚠️ Partial | Versioned text + acceptance helpers verified (step 9); the checkbox is UI-only — acceptance is **not persisted** and `terms_version` / `terms_accepted_at` are never written |
| Payment | ⚠️ Partial | Steps 14–17, 20, 21 executed; verification fields protected by rule text; **Finding 1** lets a Guest forge `payment_status` |
| OCR | ❌ Missing (as a pipeline) / ✅ never auto-verifies | Regex text extraction only (step 16 — and it mis-captures on prose); no image→text engine; `canAutoVerifyFromOcr()` returns `false` |
| Admin verification | ⚠️ Partial | Lifecycle rules for verify/reject/approve executed (steps 12, 13, 20, 21); Flutter screens not run |
| Chat | ⚠️ Partial | Steps 29–31 executed locally + rule text; Findings 4 and 6 |
| Rating | ⚠️ Partial | Steps 32–34 executed (eligibility, duplicate, shape); rule-level eligibility is app-only (Finding 5) |
| Smart Lock | ⚠️ Partial | Steps 23–28: contract replayed and Access-log rules verified; no lock driver or Flutter run |
| Security | ⚠️ Partial | Steps 18, 19, 22, 27, 35–37 executed against rule text: no privilege escalation, no cross-user reads, tracker closed. Emulator unrun (🔴) |

## 6. P4 — OCR / payment extraction

Kept as-is, documented, **not** marked complete:

- What exists: `src/lib/payments/ocr.ts` — regex extraction of a reference and an
  amount from **text** (`extractReceiptFields`), a filename fallback, and
  `matchPaymentReference` for the duplicate/amount check. The upload screen runs
  it on text files only and pre-fills fields the Guest must confirm.
- What does not exist: any image→text engine, any cloud OCR call, any sidecar
  upload. Step 16 shows the extraction mis-capturing "RECEIPT" as a reference on
  prose — exactly why the output is a hint.
- Hard rule intact: `canAutoVerifyFromOcr()` returns `false`; extraction can
  never set `payment_status`. Admin verification is the only path to `verified`.
- If a real OCR engine is added, the required pipeline is: receipt image →
  **server-side function** (never the browser bundle) → OCR engine → extracted
  text → reference + amount → **Guest confirmation** → payment submission →
  Admin verification. The API key lives in the function's environment/secret
  store — never in web JS, the Flutter APK, public config, or Git. There is no
  `functions/` directory in this repository, so none of that exists yet.

## 7. P5 — server-side rate limiting

**Determination: not possible in the current architecture; documented as a
limitation rather than built.** The reasons, checked in the repository:

- There are no Cloud Functions and no callables (`functions/` does not exist), so
  there is no server-side place to count requests.
- Clients write Firestore directly. Firestore rules are stateless per request:
  they cannot count events in a window. A counter document could be written in
  the same write, but a client that simply omits the counter write bypasses it —
  which is not enforcement.
- App Check is not initialised anywhere in the web app or the Flutter app, so
  requests are not attested either.
- What does exist: `src/lib/rateLimit.ts` — **client UX cooldowns** (login 5/60 s,
  reset 3/60 s, booking 4/60 s, payment 5/60 s, OCR 8/60 s, chat 8/10 s, review
  3/60 s, lock command 5/10 s, with escalating locks). They can be bypassed by
  reloading the page or calling the SDK directly, so they are **not** security
  rate limiting and must not be described as such.
- Real limits that do apply today are outside this repository: Firebase Auth's own
  brute-force protection and Firestore/Storage quotas and billing caps. They were
  not tested here.

Enforcing this properly requires new infrastructure (Cloud Functions callables
plus App Check, or a proxy) — a scope decision, not a refactor.

## 8. P6 — pagination

Reviewed; **not migrated**, with the reasoning recorded:

- `src/lib/pagination.ts` paginates **in memory** after the data is loaded
  (`paginate` slicing an array; `MAX_PAGE_SIZE = 50`, `DEFAULT_PAGE_SIZE = 10`,
  page sizes 5/10/25/50). Used by the Guest's `/account` list, the chat list and
  the `Pager` component.
- The Admin app streams the whole Bookings collection (`streamBookings`) and the
  Flutter screens scroll it; there is no cursor paging there either.
- Search/sort/filter currently work on the **whole loaded set**
  (`caseInsensitiveIncludes`, `sortBy`), which is what keeps them compatible
  today. A cursor migration moves search/sort to the server and must keep that
  behaviour (index-backed `orderBy` + `where`, no Algolia).
- Why not migrate now: the only client with large collections is the Flutter app,
  whose toolchain is unavailable here — rewriting its data path uncompiled and
  untested would trade a documented bound for an unverified change. The trigger
  and the shape of the change are documented instead: when the Admin collection
  passes a few thousand documents (or list memory becomes a problem), switch the
  Admin list to `orderBy('created_at','desc').limit(pageSize)` + `startAfter`
  with an infinite-scroll adapter, and keep the guest lists as they are (they are
  uid-scoped and small).

## 9. P7 — cache and cookies

| Mechanism | What it is | Expiry / invalidation | Sensitive? |
| --- | --- | --- | --- |
| Hosting `Cache-Control: max-age=31536000, immutable` on `**/*.js`, `**/*.css` | Vite emits content-hashed filenames, so an immutable year is safe: a new deploy references new filenames | New hash = new file; `index.html` is not immutably cached, so a deploy is picked up on reload | No |
| No service worker | The PWA shell is not cached; there is no offline app cache to go stale | — | — |
| Cookie `hdl_tutorial_done` (the only cookie the site sets) | Tour finished/dismissed | 180 days, `SameSite=Lax`, `Secure` on HTTPS, **not HttpOnly** (JS must read it); `clearCookie` available | No — a UI flag. No auth or payment data |
| Firebase Auth persistence (IndexedDB) | The SDK's session: ID token (≈1 h) + refresh token | Managed by the SDK; sign-out clears it | **Yes — it is the session.** Standard SDK behaviour; readable by any script on the origin, which is why the site ships no third-party scripts. There is no CSP header (a hardening gap, not a leak) |
| `localStorage` (`hdl:bookings`, `hdl:activity`, `hdl:rates`, `hdl:chat`, `hdl:review:{bookingId}`, local auth store) | Demo/offline fallback used **only when `VITE_FIREBASE_*` is unset**; with Firebase configured, bookings/rates/chat/reviews come from Firestore | Cleared by the browser/`localStorage.clear()`; not a security boundary locally | No payment credentials, no card data, no API keys. The offline auth store keeps a password *hash* (documented as not a secret-keeper in `authLocal.ts`) |

Staleness, stated plainly: with Firebase configured, a page load re-reads from
Firestore (guest bookings via a uid-scoped subscription), so a stale cache cannot
reserve dates or verify money — availability and payment decisions are enforced
server-side (rules) and admin-side (verification). With Firebase **unconfigured**
the site is a demo on local data: two browsers can disagree, and nothing here
should be treated as the booking system of record. No payment or auth secret is
stored in browser storage; payment references are Admin-side data, and no secret
key exists in the bundle (checked: no `payments/` server keys, no `.env` secrets
in Git).

## 10. Remaining limitations (genuine only)

1. **No emulator verification** — Java absent, emulator JAR unreachable; rules are
   verified by executing their text with the in-repo evaluator only (§3).
2. **No Flutter verification** — no SDK: `flutter analyze`, `flutter test`,
   `flutter build apk` and the Admin UI flows were not run. Dart parses cleanly.
3. **Firestore/Storage writes were never executed against the real services** —
   the E2E scenario ran the shipped modules on their offline adapters.
4. **Six rule findings + one open semantics question** (§3.3).
5. **Terms acceptance is not persisted** (UI checkbox only).
6. **OCR is regex text extraction**; no image pipeline, no server function (§6).
7. **No server-side rate limiting** (§7).
8. **Duplicate payment-reference detection is a function + Admin-only catalogue,
   not wired into a screen** (§3.2, Payments).
9. **In-memory pagination** with a documented migration trigger (§8).
10. **No CSP header** on the hosting config (session tokens live in IndexedDB as
    the SDK intends; a CSP would narrow XSS reach).
11. **Guest-facing mobile app** does not exist (ADR-0007: Guest = web).

## 11. Requirement matrix

| # | Requirement | Status | Basis |
| --- | --- | --- | --- |
| 1 | Guest registration, roles, no self-promotion | ⚠️ Partial | steps 1–4 executed (local adapter); Firebase Auth path unexecuted |
| 2 | Booking lifecycle with logged transitions | ⚠️ Partial | executed locally: Pending → KYC → Approved → Payment Pending → Reserved → Staying → Completed, 14 entries; cloud writes unexecuted |
| 3 | Terms accepted and recorded | ⚠️ Partial | versioning helpers verified; acceptance not persisted |
| 4 | Payment submission and verification | ⚠️ Partial | steps 14–17, 20, 21; Finding 1 |
| 5 | OCR integration | ❌ Missing | regex text extraction only; no engine, no server pipeline |
| 6 | OCR can never auto-verify payment | ✅ Verified | `canAutoVerifyFromOcr() === false`, asserted in `npm test` and step 16 |
| 7 | Admin workflows (approve, verify, reject, refund path) | ⚠️ Partial | lifecycle + rules executed; Flutter screens unrun (🔴) |
| 8 | Chat | ⚠️ Partial | steps 29–31; Findings 4, 6 |
| 9 | Ratings/reviews | ⚠️ Partial | steps 32–34; Finding 5 (rule-level eligibility absent) |
| 10 | Smart Lock contract and Access log | ⚠️ Partial | contract + rules executed; firmware out of repo |
| 11 | Security rules enforcement | ⚠️ Partial | rule text executed: no escalation, cross-user reads denied, tracker closed; **emulator 🔴 Blocked** |
| 12 | Live location tracking removed | ✅ Verified | no tracker code in `lib/`/`src/`/`test/`; `tracking_sessions` denied read/create/update to everyone; 135/135 and 344/344 green after removal; Dart parses clean |
| 13 | Server-side rate limiting | ❌ Missing | documented limitation (§7); client cooldowns are UX only |
| 14 | Pagination for large collections | ⚠️ Partial | in-memory pagination works and is bounded (`MAX_PAGE_SIZE 50`); cursor migration documented, not performed |
| 15 | Cache/cookie documentation | ✅ Verified | §9, verified against `firebase.json`, `cookies.ts`, `authFirebase.ts`, storage keys |
| 16 | 37-step end-to-end scenario documented | ✅ Verified | §4, every step's actual result |
| 17 | Flutter compile/analyze/test/APK | 🔴 Blocked | no SDK in this environment |
| 18 | Real Firebase rules behaviour (emulator) | 🔴 Blocked | Java absent; JAR host unreachable |

---

## 12. Buod (Tagalog)

**Ano ang nasubukan at paano.** Tatlong suite ang tumakbo: `npm test` (21 file,
344 pumasa), `npm run test:rules` (135 pumasa — 28 engine, 86 Firestore rules, 21
Storage rules), at `npm run test:e2e` (39 pumasa — 37 hakbang na end-to-end na may
nakalimbag na resulta). Bumuild din ang production bundle (`npm run build`, 133
modules, walang type error).

**Emulator: hindi tumakbo.** Walang Java sa makina at hindi maabot ang
`storage.googleapis.com` para sa emulator JAR, kaya **walang isang rule na
na-verify sa emulator**. Ang lahat ng resulta ng rules ay **rule text na pinatakbo
ng evaluator sa loob ng repo** (tunay na `firestore.rules`/`storage.rules`).
Nasubukan: guest/client at admin na pag-access, pagtanggi sa hindi awtorisado at
sa walang naka-sign in, sariling Booking lang ang nababasa, protektadong fields
(verify, refund, uid, status) na tinatanggihan, pag-verify/pag-reject ng Admin,
chat na sariling usapan lang at hindi maipagpalit ang sender, Access log ng Smart
Lock (granted/denied, append-mostly), at ang tracker: `tracking_sessions`
tinatanggihan ang read/create/update kahit sa Admin, habang buhay pa ang
`access_logs`.

**Anim na nakitang butas (findings) at isang dapat sagutin ng emulator.**
(1) Maaaring isulat ng Guest ang sarili niyang `payment_status` bilang `verified`
— pangalan ng key ang sinusuri, hindi ang halaga. (2) Puwedeng maging `Reserved`
mula `Payment Pending` kahit `pending` pa ang bayad. (3) Hindi kinukumpara ang
`actor_id` sa tunay na uid ng sumulat. (4) Puwedeng mag-post ang estranghero sa
usapang hindi niya pag-aari (sender lang ang sinusuri). (5) Walang rule-level na
pag-check sa Reviews (nasa app lang). (6) Puwedeng lagyan ng `sender_role:
'admin'` ang sariling mensahe. Bukod dito, hindi pa malinaw kung ang anonymous
Guest ay pinapayagan ng `activity` clause — kailangan ang emulator para dito.

**P4 OCR.** Hindi kumpleto at hindi dapat tawaging kumpleto: regex text
extraction lang (`extractReceiptFields`), walang image→text engine, walang
server function. Hindi kailanman awtomatikong nagve-verify (`
canAutoVerifyFromOcr()` ay `false`); ang Admin pa rin ang nag-verify. Kung
lalagyan ng tunay na OCR: imahe → backend function → OCR → text → reference at
amount → kumpirmasyon ng Guest → pagsusumite → beripikasyon ng Admin, at ang API
key ay nasa secret store ng function — hindi sa web, APK, public config, o Git.

**P5 rate limiting.** Hindi posible sa kasalukuyang arkitektura: walang Cloud
Functions/callables, at ang Firestore rules ay walang kakayahang magbilang ng
request sa isang window. Ang `src/lib/rateLimit.ts` ay **client UX cooldown
lamang** — hindi ito security rate limiting. Naidokumento bilang limitasyon
kaysa magtayo ng bagong imprastraktura.

**P6 pagination.** In-memory pa rin (`MAX_PAGE_SIZE 50`, `paginate`), ginagamit ng
`/account`, chat at `Pager`; ang Admin app ay buong koleksyon ang binabasa.
Naidokumento ang plano (orderBy + limit + startAfter, walang Algolia) at ang
kondisyon kung kailan ito gagawin; hindi isinagawa dahil walang Flutter SDK para
mag-compile at mag-test.

**P7 cache at cookies.** Isang cookie lang: `hdl_tutorial_done` (180 araw,
`SameSite=Lax`, `Secure` sa HTTPS, hindi HttpOnly — UI flag lamang, walang
sekreto). Ang session ay nasa IndexedDB ng Firebase Auth (normala ito; walang CSP
header — isang hardening gap). Ang localStorage ay demo fallback lamang kapag
walang Firebase config; walang payment o auth secret na nakatago doon.

**Hindi pa beripikado:** ang Flutter Admin app (walang SDK kaya walang `analyze`,
`test`, `build apk`), ang tunay na Firestore/Storage writes, at ang emulator.
Ang 37-hakbang na senaryo ay tumakbo sa tunay na mga module ng website sa
kanilang offline adapter — hindi sa live na Firebase.
