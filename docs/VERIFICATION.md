# Verification — Hacienda de LuisAna

> **2026-09-29 (later) update — Guest Reviews and the public testimonial.**
> The partial review system that was already in `firestore.rules`,
> `src/lib/reviewsCloud.ts` and `src/components/ReviewForm.tsx` was **extended,
> not replaced**: the document id is still the Booking id, the eligibility list
> is still `Checked-Out` / `Completed`. What was added is the edit window, the
> optional category ratings, the Admin's reply and moderation, the statistics,
> the Admin Flutter screens, and a **separate** `public_reviews` collection that
> is what the website publishes (ADR-0014, `docs/REVIEWS.md`). What that pass
> ran:
>
> ```
> npm run lint        (tsc -b)          → clean                     ✅
> npm test            → 39 files / 602 tests  ✅ (was 36 / 514)
> npm run test:rules  → 3 files / 191 tests  ✅ (was 3 / 166; 25 review cases)
> npm run build       → dist/ built           ✅
> npm run test:e2e    → 44 tests              ⚠️ 42 pass, 2 fail — the **same two** as
>                                                     before this work (step 15, payment-proof
>                                                     storage contract, and the record printer
>                                                     it throws into); steps 38–42, the new
>                                                     review flow, all pass
> npm run test:emulator → not run             🔴 Blocked (no Java; JAR host unreachable)
> flutter test / analyze → not run            🔴 Blocked (no Flutter SDK) — so
>                                                     `test/review_policy_test.dart` and the new
>                                                     Dart files are **written and reviewed,
>                                                     not compiled**
> ```
>
> New this pass: `test/web/review-policy.test.ts` (35),
> `test/web/reviews-cloud.test.ts` (42), `test/web/review-form.test.tsx` (10), the
> `reviews`, `public_reviews` and Activity-action-list suites in
> `test/rules/firestore-rules.test.ts`, the matching cases in
> `test/emulator/rules.emulator.test.ts`, `test/review_policy_test.dart`, and
> steps 38–42 of the end-to-end scenario.
>
> Two changes were made to the **rules evaluator** itself, and both are
> behaviour, not fixtures:
>
> - `compileRules()` — a parsed rules file can be reused across a case. The
>   suite was spending 173 s re-parsing the same 900-line file per question; it
>   now runs in **7 s** for 191 cases. `evaluate()` still re-parses, for a suite
>   that rewrites the rules between cases.
> - String-literal escapes are now read. A rule written
>   `text.matches('\s*')` to refuse whitespace was handing RE2 a doubled
>   backslash — a literal backslash, not a whitespace class — so the pattern
>   matched nothing and the rule allowed exactly what it was written to refuse.
>   The `reviews` text check depends on it, so it is pinned in
>   `engine.test.ts` rather than discovered there.
>
> One gap closed while extending the Activity log: it now checks every entry's
> `action` against the list of names the system has. A Guest could already file
> an entry into their own Booking reading *"Payment proof verified — Booking
> Reserved"* in their own name — a lie in the one log the Admin reads.

> **2026-09-29 update — messaging limits, pagination, retention, live location.**
> The Guest ↔ Admin conversation now has a 1,000-character limit enforced by
> `firestore.rules`, cursor pagination on both apps, a retention policy with an
> Admin-only expiry stamp, and opt-in live location as an ephemeral Realtime
> Database stream (ADR-0013, `docs/MESSAGING.md`). What that pass ran:
>
> ```
> npm test           → 36 files / 514 tests      ✅
> npm run test:rules → 3 files / 166 tests       ✅ (engine 34, firestore 117, storage 15)
> npm run build      → dist/ built               ✅ (tsc -b clean; the Realtime Database is a
>                                                 lazy chunk, not in the initial bundle)
> npm run test:e2e   → 39 tests                  ⚠️ 37 pass, 2 fail — **the same two fail on
>                                                 a clean checkout of the parent commit**
>                                                 (step 15, payment-proof storage contract,
>                                                 and the record printer it throws into)
> npm run test:emulator → not run                🔴 Blocked (no Java; JAR host unreachable)
> flutter test / analyze  → not run              🔴 Blocked (no Flutter SDK) — so
>                                                 `test/chat_limits_test.dart` and the four new
>                                                 Dart files are **written and reviewed, not
>                                                 compiled**
> ```
>
> New this pass: `test/web/chat-messaging.test.ts`, `test/web/live-location.test.ts`,
> `test/web/messages-page.test.tsx`, `test/web/realtime-database-rules.test.ts`
> (web, 66 tests); the `location_sessions`, message-length and retention-stamp
> suites in `test/rules/firestore-rules.test.ts`; the clock/timestamp/`hasAny`
> semantics in `test/rules/engine.test.ts`; `test/emulator/realtime-rules.emulator.test.ts`
> and the matching Firestore cases in `test/emulator/rules.emulator.test.ts`
> (**written, not executed**).
>
> The `test/rules/engine.ts` evaluator gained `request.time`, the `timestamp` type,
> `timestamp + int`, `timestamp - timestamp` and `keys().hasAny()` — constructs
> `location_sessions` needs, each pinned in `engine.test.ts`. That is added
> coverage of the real rules language, not a relaxation of an existing verdict.
>
> Everything below is the record of the earlier passes and is left as it happened.

> **2026-09-27 update.** Government ID KYC was removed, payment-proof storage
> moved to Supabase (ADR-0011) and client-side OCR (tesseract.js) was added.
> §2's counts, §4's record, §5's workflow rows and §6 describe a re-run after
> those changes; §3.3 and §12 keep the 2026-09-24 remediation pass exactly as
> it happened (including its lifecycle diagram and findings).

What was **executed**, on which machine, and what the results were. Written to be
read against `docs/LIMITATIONS.md`: nothing here is marked Verified that was not
run, and everything that could not run says so and says why.

Reproduce everything on this page:

```bash
npm test           # web suite (vitest, jsdom)          → 22 files / 360 tests
npm run test:rules # rules (in-repo evaluator)          → 3 files / 151 tests
npm run test:e2e   # the 37-step scenario + its record  → 39 tests
npm run build      # tsc -b && vite build               → dist/ built
npm run test:emulator   # canonical rules check — NEEDS Java + network (see §3)
```

Two verdicts appear throughout, and they are not interchangeable:

| Level | What ran it | Where |
| --- | --- | --- |
| **Supplemental** | the in-repo evaluator (`test/rules/engine.ts`), executing the real rules text | `npm run test:rules` |
| **Canonical** | the Firebase Emulator Suite — Google's implementation | `npm run test:emulator` (blocked here, §3.1) |

Nothing in this document reports a supplemental verdict as emulator-verified.

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
| Firestore rules (rule text executed) | `npm run test:rules` | 96 / 96 |
| Storage rules (rule text executed) | `npm run test:rules` | 21 / 21 |
| **Rules total** | | **145 / 145** |
| Web unit + component + integration | `npm test` | 24 files / **367 / 367** |
| End-to-end scenario (this document, §4) | `npm run test:e2e` | **39 / 39** (37 steps + reset + record printer) |
| Production build | `npm run build` | `dist/` built, 227 modules, no type errors |
| Flutter analyze / test / APK | `flutter …` | **not run — no SDK** (🔴 Blocked) |
| Firebase Emulator rules suite | `npm run test:emulator` | **not run — no Java, JAR unreachable** (🔴 Blocked) |

Baseline note: the web suite includes text-assertion rules tests from before the
evaluator existed; they are kept (they pin the *file's* text, updated to the text
that is there now) but the executed checks in §3 are the ones with authority.

### 2.1 The two verification levels

| Level | What it is | Where it runs | Trust |
| --- | --- | --- | --- |
| **Supplemental** | `test/rules/engine.ts` — the real rules text parsed with Firebase's own ANTLR grammar and evaluated in-process | `npm run test:rules`, every CI run, no Java or network | Fast, catches regressions, executes the real file — but it is *not* Google's engine |
| **Canonical** | The Firebase Emulator Suite — Google's implementation, the only thing that settles the rules' real semantics | `npm run test:emulator` (Java + a one-time ~200 MB download) | **Blocked in this environment** (§3.1); never claim it ran |

Known differences between them, i.e. why a green offline suite is not a substitute:

1. **Truthiness at the edges.** This evaluator follows the documented rules
   language (`0` and `''` are falsy); the emulator's Ruby/CEL implementation is the
   authority where the two differ.
2. **A missing map key.** The evaluator's default is the strict reading (an error,
   `Semantics.missingKeys: 'error'`); the emulator decides what actually happens.
   The one place this mattered — an anonymous Guest's `role()` — is now settled by
   rule *shape* rather than by a reading (§3.3).
3. **Effects are modelled, not executed.** `get()`/`exists()` read the `store` the
   test passes; a `list` request is modelled as an empty result set, which is the
   only thing a query has to be safe against. Real query behaviour (index errors,
   per-document evaluation, `request.query`) is not modelled.
4. **Out of scope entirely**: resource limits and timeouts, Storage metadata and
   content-type edge cases beyond what `storage.rules` reads, and anything that
   needs a running Auth emulator (custom claims propagation, token refresh).
5. **Ordering across the two numeric types.** The evaluator models `int` and
   `float` as the runtime does (§15.2) — truncating `int / int`, promoting mixed
   arithmetic, comparing a scalar by value and a List or Map element by type —
   with one deliberate exception: it *refuses* `int > float` and its three
   siblings. The runtime's own message for a mixed comparison names `int > int,
   float > float` and no mixed pair, but that message has been observed to omit
   combinations that do work (`int + float` promotes, and the same message lists
   no such pair), so it is not proof either way and no capture has settled it.
   The strict reading is modelled on purpose: a rule that passes here passes
   under both readings, and `firestore.rules` now converts every figure to
   integer centavos so that no gate depends on the answer.

The evaluator is **never modified to make a failing case pass**: a case it gets
wrong is a case to take to the emulator, not a case to loosen. It has been
corrected once, in §15.2, where a pin of its own contradicted the deployed
runtime — `7 / 2` was pinned as `3.5`, which is JS division and not the rules
language's — and the correction is recorded there with the evidence.

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
activity, payments/references, chat, reviews, smart lock, tracker, storage — 40
cases, the former probes now asserting the fixed behaviour); it runs with
`npm run test:emulator` on a machine that has Java and can reach
`storage.googleapis.com`. Run it before treating any ⚠️ below as settled.

| Checked how | Count |
| --- | --- |
| Emulator-verified | **0** |
| Rule-text-executed (in-repo evaluator, real rules file) | 151 assertions — including the 16 cases that used to record findings, now asserted refusals |
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
| | protected-field denial | ✅ status → Approved/Reserved, `uid` re-point, `amount_verified`, `payment_verified_by`, `payment_verified_at` all denied; a refund may be recorded only up to the verified amount, and `refunded` is the Admin's |
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

### 3.3 Findings of the first pass — all six resolved

The first pass recorded six things the rules allowed that the policy means to
forbid. They were recorded as executable `FINDING:` tests rather than silently
patched, because changing the rules is a policy decision. **That decision was
taken on 2026-09-24** (`docs/adr/0010-…-rule-layer.md`); every `FINDING:` test is
now an asserted refusal, and the application half of each one has its own
regression test in `test/web/authorization-regressions.test.ts`.

| # | Finding | Root cause | Security impact | Fix | Regression test | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Guest can set their own `payment_status` to `verified` | The self-serve rule checked *which keys* a Guest touched, never the values written into them | High — the money flag the Admin's gate reads was forgeable from a console | Guest branch constrains the value: `payment_status` ∈ {`unpaid`, `pending`} or unchanged; a `verified` document must carry `amount_verified > 0`, a `payment_verified_at` and `payment_verified_by == auth.uid` | `rules`: "refuses a Guest who sets their own payment_status to verified", "refuses a Guest who files a verification, in any of its spellings"; `web`: "never lets a guest-run action set payment_status to verified" | ✅ Resolved |
| 2 | `Reserved` reachable from `Payment Pending` with the money still `pending` | The gate read the *previous* status, not the money | Medium — a Booking could be reserved without verifiable payment | `reservedIsPaidFor()` is the first clause of the update rule and binds every writer; approved-needed-KYC and no-terminal-exit stay as they were | `rules`: "refuses Reserved while the money is still unverified, whoever asks", "accepts Reserved from Payment Pending once the money is verified"; `web`: "is reached by VerifyPayment, and by that action only" | ✅ Resolved |
| 3 | Activity `actor_id` never compared with the writer's uid | The rule checked `actor == role()` only | Medium — an entry could name another person as the actor | Both role and uid checked; the `system` entry (ADR-0002) is the Admin's, and the unauthenticated submission entry is limited to `Submit` | `rules`: "refuses an entry a Guest files in another Guest's name", "lets the Admin record the system's own act, and nobody else"; `web`: "signs every entry with the identity making the write" | ✅ Resolved |
| 4 | A signed-in stranger can post into a conversation they do not own | The message rule checked the sender, not the conversation | Medium — knowing an id was enough to inject into someone's inbox | `isConversationMember()` reads the conversation's own `guest_uid` (or the Admin role) for create *and* read; a missing conversation is refused | `rules`: "refuses a stranger posting into a conversation they are not part of"; `web`: `test/web/chat-authorization.test.ts` (unchanged contract) | ✅ Resolved |
| 5 | Reviews had no rule-level eligibility, ownership or duplicate check | All three lived in `src/lib/reviewsCloud.ts`, which a console does not load | Medium — a review could be written for a stay that never happened, or twice | Document id is the Booking id; the rule reads the Booking (`exists`, author, status ∈ {`Checked-Out`, `Completed`}); updates are closed, so the taken id *is* the duplicate check; the app writes with `setDoc(reviewDocId(bookingId))` | `rules`: reviews suite (7 cases); `web`: "a Review is stored at the Booking it is about" | ✅ Resolved |
| 6 | `sender_role` can be mislabelled by its own sender | The label was free text; `sender_uid` stayed honest | Low — display spoofing in the Admin inbox | The label must match what the writer is: `guest` ⇔ membership, `admin` ⇔ the Admin role | `rules`: "refuses a Guest labelling their message as the Admin's"; `e2e` step 30 | ✅ Resolved |

**Two things the audit found that were not on the list of six.**

- **The refund settlement was unreachable for Guests.** Withdrawing a *paid*
  Reservation produces `refund_status`/`refund_total`/`refund_breakdown` (computed
  once, in the shared money module), and no such key was on the self-serve list —
  so the write was refused and a Guest could not withdraw online at all. The keys
  are allowed now, bounded: `refund_status` ∈ {`none`, `initiated`},
  `refund_total ≤ amount_verified`, the breakdown must agree with the total, and
  `refunded` remains the Admin's to write.
- **A Booking created with a claimed payment state.** `create` accepted
  `payment_status: 'verified'` (and `kyc_status: 'approved'`) on a brand-new
  document. `create` now accepts only the states a new Booking can be in.

**The semantics question is settled by shape, not by reading.** The first pass
could not tell whether the `activity` clause left an anonymous Guest's own entry
allowed or refused: `role()` reads `request.auth.token.email`, which an anonymous
token does not carry, and the two readings of a missing claim disagree. The Guest
branch no longer reads a role — it compares `actor_id` with `request.auth.uid`,
which every signed-in identity has. The offline suite asserts the same case under
**both** readings and the emulator suite carries it too, so neither level depends
on the answer any more.

### 3.4 Emulator-verified vs not — one line

**Emulator-verified: nothing.** Rule-text-executed (supplemental): all 145 rules
tests — including the 16 cases that used to record findings, now asserted
refusals — §3.2, and steps 18, 19, 22, 24–27, 30, 31, 34–37 of the E2E record.
Application-executed (website modules, offline adapters): steps 1–17, 20, 21, 23,
28, 29, 32, 33. The canonical suite exists and is written
(`test/emulator/rules.emulator.test.ts`, 40 cases) but has never run here.

## 4. P8 — the 37-step end-to-end scenario

`test/e2e/final-scenario.e2e.test.ts`, run by `npm run test:e2e` (record below
re-run 2026-09-27, after the KYC removal). Each step
asserts its own outcome and prints a line; `executed` = real website modules on
their documented offline adapters, `rule-text` = the real rules file through the
evaluator, `contract` = the ESP32 contract in `docs/SMART_LOCK.md` (no lock
firmware exists in this repository) replayed against the rules.

```
=== final end-to-end scenario: 37 steps ===
 1 | Guest registers (email + password) and the session resolves guest                              | executed  | role=guest, status=signed-in, uid=65477933…
 2 | Registration cannot mint an Admin; the guest permission set holds no verify/approve power      | executed  | guest permissions=3, cannot verify payments
 3 | No admin route exists on the website; an Admin session is sent home, not to a dashboard        | executed  | guest→/account allowed, admin→/account refused
 4 | Sign-out clears the session, sign-in restores the same identity                                | executed  | uid stable=true
 5 | Availability quote for the requested dates                                                     | executed  | available=true, conflicts=0
 6 | Booking created                                                                                | executed  | status=Pending, hold=24.00h, ref=HDL-3027
 7 | Submit logged; the Booking is visible to its owner and to nobody else                          | executed  | activity=Submit, other guest sees 0
 8 | Double-booking the held dates is refused by the availability re-check                          | executed  | conflicts=1
 9 | Terms acceptance carries the current version and a timestamp                                   | executed  | version=2026-09-27, re-acceptance required on version change=true
10 | Guest cannot self-approve — review is the Admin’s alone                                        | executed  | refused by the actor table; status still Pending
11 | Retired statuses migrate on read                                                               | executed  | KYC Submitted→Pending, Approved→Payment Pending, Confirmed→Reserved
12 | Review needs a reason, and the Guest cannot be the reviewer                                    | executed  | both refusals leave the Booking Pending
13 | Admin approves after the availability re-check                                                 | executed  | status=Payment Pending, hold stopped, re-checked against 2 stored Booking(s)
14 | Payment plan chosen; policy version stamped on the Booking                                     | executed  | status=Payment Pending, due=4500, policy=2026-09-24
15 | Proof file contract and object path                                                            | executed  | path=payments/65477933-a54b-45a1-8d9d-41c320e23f05/HDL-1/proof.png, limit=5MB
16 | Receipt text extraction fills reference + amount for confirmation only                         | executed  | clean receipt → ref=1234567890123, amount=4500.00, confidence=high; prose receipt captured "RECEIPT" (misread — text extraction is best-effort); autoVerify=false
17 | Proof submitted                                                                                | executed  | payment_status=pending, verified_at=unset
18 | Guest-issued verification fields are refused by firestore.rules                                | rule-text | payment_status=verified → denied (the value, not just the key); amount_verified → denied
19 | Payment-reference catalogue is Admin-only, so a used reference cannot be re-listed by a client | rule-text | guest write denied, guest read denied, admin write allowed; duplicate-reference check returns rejected, own resubmission stays admissible
20 | Rejected proof → resubmission                                                                  | executed  | rejected (rejected) → after resubmit pending, status still Payment Pending
21 | Admin verification                                                                             | executed  | underpayment (6000) refused, 6500 verified → Reserved
22 | Collection reads are Admin-only; a Booking is readable only by its owner or the Admin          | rule-text | admin list allowed, guest list denied, other guest get denied
23 | Check-in → Staying                                                                             | executed  | status=Staying
24 | Authorized unlock                                                                              | contract  | decision=granted; access_logs create accepted by rule text
25 | Unknown credential                                                                             | contract  | decision=denied (unknown credential); denied row accepted by rule text
26 | Revoked credential, wrong dates, stay not Reserved                                             | contract  | all denied: credential revoked; outside the stay dates; booking is Payment Pending
27 | Access-log tampering                                                                           | rule-text | update denied, delete denied, forged writer denied, invalid result denied
28 | Check-out → Completed, with the whole stay on the Activity log                                 | executed  | status=Completed, activity entries=11
29 | Guest conversation and message                                                                 | executed  | convo=local:65477933-a54b-45a1-8d9d-41c320e23f05, message delivered to the guest view
30 | Sender identity, conversation membership and the role label                                    | rule-text | own sender allowed; spoofed sender denied; a stranger posting into an unowned conversation denied; a Guest labelling a message as the Admin's denied
31 | Admin reply                                                                                    | rule-text | admin read allowed, admin message accepted
32 | Review eligibility                                                                             | executed  | before check-out refused, after Completed accepted
33 | Duplicate Review                                                                               | executed  | refused with "You already reviewed this stay."
34 | Review eligibility, ownership, shape and one-per-stay                                          | rule-text | own finished Booking + 5 stars allowed; 6 stars, another author, another Guest’s stay, an unfinished stay and a second Review all denied
35 | Privilege escalation through the Booking document                                              | rule-text | Approve denied, identity swap denied, delete of another guest’s booking denied
36 | Tracker collection and the retired KYC storage slot                                            | rule-text | tracking_sessions read/create denied for guest and Admin; the /kyc slot refuses uploads for everyone
37 | Cross-user document access                                                                     | rule-text | ID reads denied for guests and Admin alike (slot removed), guest rates write denied, own payment proof write allowed
```

The Booking reference, the uid and the conversation id are generated per run.

Reading the record honestly: `executed` steps ran the shipped modules, but on the
offline adapters (localStorage) — the Firestore documents they would write in
production were not written, because there are no credentials and no emulator in
this environment. Step 30 used to record a **finding**; it now asserts the refusal
(membership is read from the conversation, and the role label has to match the
writer). Steps 24–26 are the ESP32 contract; the lock's own behaviour is firmware,
out of this repository.

## 5. End-to-end workflow table

| Workflow | Status | Evidence |
| --- | --- | --- |
| Registration | ⚠️ Partial | Steps 1–4 executed on the local adapter; Firebase Auth path not executed (no credentials/emulator); no role can be minted but guest |
| Booking | ⚠️ Partial | Steps 5–8, 10–14, 20, 21, 23, 28 executed end-to-end locally (Pending → review → Payment Pending → Reserved → Staying → Completed, 11 Activity entries); cloud writes unexecuted |
| Terms | ⚠️ Partial | Versioned text + acceptance helpers verified (step 9); the checkbox is UI-only — acceptance is **not persisted** and `terms_version` / `terms_accepted_at` are never written |
| Payment | ⚠️ Partial | Steps 14–17, 20, 21 executed; verification fields protected by rule text; **Finding 1** lets a Guest forge `payment_status` |
| OCR | ⚠️ Partial / ✅ never auto-verifies | Client-side image OCR (tesseract.js) pre-fills an editable reference from the chosen screenshot; regex extraction behind it (step 16 — and it mis-captures on prose); `canAutoVerifyFromOcr()` returns `false` |
| Admin verification | ⚠️ Partial | Lifecycle rules for verify/reject/approve executed (steps 12, 13, 20, 21); Flutter screens not run |
| Chat | ⚠️ Partial | Steps 29–31 executed locally + rule text; Findings 4 and 6 |
| Rating | ⚠️ Partial | Steps 32–34 executed (eligibility, duplicate, shape); rule-level eligibility is app-only (Finding 5) |
| Smart Lock | ⚠️ Partial | Steps 23–28: contract replayed and Access-log rules verified; no lock driver or Flutter run |
| Security | ⚠️ Partial | Steps 18, 19, 22, 27, 35–37 executed against rule text: no privilege escalation, no cross-user reads, tracker closed. Emulator unrun (🔴) |

## 6. P4 — OCR / payment extraction

Implemented as a client-side pipeline (2026-09-27), documented, and still
**a hint only**:

- What exists: `src/lib/payments/ocr.ts` — `runReceiptOcr` runs tesseract.js in
  the browser when the Guest picks the screenshot (busy indicator shown, worker
  fetched on first use), `extractReferenceNumber` pulls the 10–13 digit GCash /
  Maya / bank reference (14–16 digit card numbers refused) and pre-fills the
  editable reference input, `extractReceiptFields` keeps the regex path for text
  files (step 16), and `matchPaymentReference` does the duplicate/amount check.
  The chosen reference travels to the Booking as `extractedRefNumber` next to
  `paymentProofUrl`.
- What does not exist: any cloud OCR call or sidecar upload — the engine and its
  language data load in the Guest's browser, and nothing is sent anywhere.
- Step 16 still shows the extraction mis-capturing "RECEIPT" as a reference on
  prose — exactly why the output is a hint the Guest can (and must be able to)
  edit.
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
| `localStorage` (`hdl:bookings`, `hdl:activity`, `hdl:rates`, `hdl:chat`, `hdl:review:{bookingId}`, local auth store) | Demo/offline fallback: local development with no keys (`src/lib/firebaseConfig.ts` § source 3), and the landing place when a cloud write is *refused* — in which case the Booking carries `storage: 'local'` and the success screen says it was not sent. With Firebase configured, bookings/rates/chat/reviews come from Firestore | Cleared by the browser/`localStorage.clear()`; not a security boundary locally | No payment credentials, no card data, no API keys. The offline auth store keeps a password *hash* (documented as not a secret-keeper in `authLocal.ts`) |

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
4. **The rules are verified by their text, not by the emulator** — the in-repo
   evaluator is *supplemental*; the Emulator Suite is canonical and blocked (§3.1).
   The six findings of the first pass are fixed and regression-tested (§3.3), but
   "fixed" here means "the rule text refuses it and the module refuses it", not
   "Google's engine confirmed it".
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
| 2 | Booking lifecycle with logged transitions | ⚠️ Partial | executed locally: Pending → review → Payment Pending → Reserved → Staying → Completed, 11 entries; cloud writes unexecuted |
| 3 | Terms accepted and recorded | ⚠️ Partial | versioning helpers verified; acceptance not persisted |
| 4 | Payment submission and verification | ⚠️ Partial | steps 14–17, 20, 21; §3.3 #1, #2 and the two audit extras fixed and regression-tested; rules still supplemental-only, not emulator-verified |
| 5 | OCR integration | ❌ Missing | regex text extraction only; no engine, no server pipeline |
| 6 | OCR can never auto-verify payment | ✅ Verified | `canAutoVerifyFromOcr() === false`, asserted in `npm test` and step 16 |
| 7 | Admin workflows (approve, verify, reject, refund path) | ⚠️ Partial | lifecycle + rules executed; the Admin's verify now writes the marker the rules require; Flutter screens unrun (🔴) |
| 8 | Chat | ⚠️ Partial | steps 29–31; §3.3 #4, #6 fixed (membership + truthful label); the Admin UI's own write path is unrun (🔴 Flutter) |
| 9 | Ratings/reviews | ⚠️ Partial | steps 32–34; §3.3 #5 fixed — the rule reads the Booking (author, finished, id = Booking); no live write observed |
| 10 | Smart Lock contract and Access log | ⚠️ Partial | contract + rules executed; firmware out of repo |
| 11 | Security rules enforcement | ⚠️ Partial | rule text executed: no escalation, cross-user reads denied, no forged verification, no impersonation, tracker closed; **emulator 🔴 Blocked** |
| 12 | Live location tracking removed | ✅ Verified | no tracker code in `lib/`/`src/`/`test/`; `tracking_sessions` denied read/create/update to everyone; 151/151 and 360/360 green after the remediation pass; Dart parses clean |
| 13 | Server-side rate limiting | ❌ Missing | documented limitation (§7); client cooldowns are UX only |
| 14 | Pagination for large collections | ⚠️ Partial | in-memory pagination works and is bounded (`MAX_PAGE_SIZE 50`); cursor migration documented, not performed |
| 15 | Cache/cookie documentation | ✅ Verified | §9, verified against `firebase.json`, `cookies.ts`, `authFirebase.ts`, storage keys |
| 16 | 37-step end-to-end scenario documented | ✅ Verified | §4, every step's actual result |
| 17 | Flutter compile/analyze/test/APK | 🔴 Blocked | no SDK in this environment |
| 18 | Real Firebase rules behaviour (emulator) | 🔴 Blocked | Java absent; JAR host unreachable |

---

## 12. The remediation pass (2026-09-24)

Scope: the six findings of §3.3, and nothing else. No new feature, no new
provider, no new collection. The pass is the *decision* that §3.3 deferred — that
the layer a malicious client cannot bypass is the one that has to hold these
invariants — recorded in `docs/adr/0010-money-and-audit-invariants-in-the-rule-layer.md`.

### 12.1 What changed

| File | Change |
| --- | --- |
| `firestore.rules` | `hasVerificationMarker()` + `reservedIsPaidFor()`; the update rule's first clause is the money invariant; the Guest branch constrains *values* (`payment_status`, `kyc_status`, refund bounds) and refuses to clear an Admin's note without a fresh document; `create` refuses a claimed payment/review state; `activity` compares `actor_id` with the writer and narrows the unauthenticated entry to `Submit`; `messages` requires membership plus a truthful role label; `reviews` reads the Booking (author, finished, id = Booking, no update); `payment_references` may be voided but not rewritten or deleted once used; `conversations` cannot be re-pointed at another Guest. |
| `src/lib/booking/actions.ts` | `VerifyPayment` writes `payment_verified_at` and `payment_verified_by` — the same four fields the app writes, so neither side can drift into a write the rules refuse. |
| `lib/services/booking_lifecycle.dart` | Same four fields on the Dart side. (No lifecycle transition was moved, duplicated or re-ordered.) |
| `src/lib/firestoreBookings.ts` | The submission entry is signed with the uid the Booking belongs to; `signActivityEntries()` signs an entry with the identity actually connected, because the rule binds `actor_id` to the writer. |
| `src/lib/reviewsCloud.ts` | A Review is written with `setDoc(reviewDocId(bookingId))` and read with one `getDoc`; `reviewDocId`/`reviewRecordFor` are exported so the app and the rule agree on the id. |
| Tests | The six `FINDING:` cases became asserted refusals; `test/web/authorization-regressions.test.ts` (15 cases) covers the application half of every finding; the emulator suite carries the same cases for the canonical run. |

### 12.2 The canonical lifecycle, read out of the existing code

The state machine was **inspected, not assumed**. `src/lib/booking/actions.ts`
(`ACTION_RULES`) and `lib/services/booking_lifecycle.dart` (`_Rule`) agree:

```
Pending ──KYC──▶ KYC Submitted ──Approve──▶ Approved ──ChoosePaymentPlan──▶ Payment Pending
                                                                                  │
                                                              VerifyPayment ──────┴──▶ Reserved
                                                                                  │
Reserved ──CheckIn──▶ Staying ──BeginStay/CheckOut──▶ Checked-Out ──Complete──▶ Completed
Pending/KYC Submitted/Approved/Payment Pending/Reserved ──Cancel──▶ Cancelled
Pending/KYC Submitted ──(date hold)──▶ Expired
```

`VerifyPayment` is the **only** action that reaches `Reserved`, and it requires a
proof and an amount covering `amount_due + security_deposit`. So the canonical
rule is: *unverified money cannot become Reserved* — asserted here against the
shared module ("is reached by VerifyPayment, and by that action only") and, in the
rules, against every writer (`reservedIsPaidFor()`). The transition table itself is
still written once, in the two lifecycle modules; the rules carry invariants, not
a second copy of the table.

### 12.3 What a malicious client can no longer do

Each line is a case in one of the three suites (rules = executed rule text,
supplemental; web = the module the client would have to use).

| Attempt | Answer |
| --- | --- |
| Guest writes `payment_status: 'verified'` (from pending, from rejected, from unpaid, or on a new Booking) | refused — rules |
| Guest writes `amount_verified` / `payment_verified_at` / `payment_verified_by` / `verification_status` / `verified_by` / `verified_at` / `admin_decision` | refused — rules (not on the self-serve list) |
| Guest moves a verified Booking back to `pending` / a rejected one to `approved` | refused — rules |
| Guest files a verification in another Admin's name, or without the marker | refused — rules |
| Anybody takes a Booking to `Reserved` with the money unverified | refused — rules (all writers) |
| Guest claims a refund larger than the verified amount, or says it was returned | refused — rules |
| Guest files an activity entry naming another Guest, or an Admin files one as a Guest | refused — rules |
| A stranger posts into, or reads, a conversation they are not part of | refused — rules |
| A Guest labels a message as the Admin's (or the Admin as a Guest) | refused — rules |
| A second Review for the same stay, a Review of somebody else's stay, or of an unfinished one | refused — rules |
| An Admin rewrites or deletes a used payment reference | refused — rules (voiding is allowed) |
| Any of the above by a signed-out client | refused — rules |

The admin side is preserved throughout: an Admin may verify with their own uid
recorded, reply in any conversation, delete a Review, void a used reference,
record the `system` expiry entry, and still run the whole lifecycle.

### 12.4 Verified by this pass

```
npm test           → 22 files / 360 tests      ✅
npm run test:rules → 3 files / 151 tests       ✅ (engine 28, firestore 102, storage 21)
npm run test:e2e   → 39 tests                  ✅ (37 steps + reset + record printer)
npm run build      → dist/ built               ✅
npm run test:emulator → not run                🔴 Blocked (no Java; JAR host unreachable — §3.1)
Flutter analyze/test/build → not run           🔴 Blocked (no SDK)
```

**Not proven by this pass**, stated plainly:

- No rule was confirmed by the Firebase Emulator. Everything above is the real
  rules *text* executed by the supplemental evaluator (§2.1, §3.1).
- No Firestore/Storage write was executed against the real services; the E2E
  scenario ran the shipped modules on their offline adapters.
- Flutter was not compiled. The Dart change (`payment_verified_at` /
  `payment_verified_by` in the `VerifyPayment` patch) is verified by reading and by
  the shared-contract test, not by a build.
- The refund bound is a rule-level invariant that matches what the shared money
  module already computes; a *live* Firestore write of a Guest cancellation has not
  been observed end to end.

---

## 13. Buod (Tagalog)

**Ano ang nasubukan at paano.** Tatlong suite ang tumakbo: `npm test` (22 file,
360 pumasa), `npm run test:rules` (151 pumasa — 28 engine, 102 Firestore rules, 21
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

**Ang remediation pass (2026-09-24).** Naresolba ang anim na findings sa §3.3,
lahat may regression test: (1) hindi na maisusulat ng Guest ang `verified` — halaga
na ang sinusuri, hindi pangalan ng key, at kailangang may `amount_verified`,
`payment_verified_at` at `payment_verified_by` na sariling uid ng nag-verify;
(2) ang `Reserved` ay hindi na maaabot kahit kanino habang hindi verified ang
pera; (3) ang bawat entry ng Activity log ay naka-sign sa tunay na uid ng sumulat
(ang `system` na entry ng Admin at ang submission entry lang ang eksepsyon);
(4) ang chat ay para lang sa may-ari ng usapan at sa Admin, at totoo na ang
`sender_role`; (5) ang Review ay nasa dokumento ng Booking — sariling tapos na
stay lang, isang beses; (6) hindi na malalagyan ng `admin` ang sariling mensahe.
Dalawang dagdag na nakita ng audit: ang refund settlement ng Guest ay
pinapayagan na pero may hangganan (`refund_total ≤ amount_verified`, `initiated`
lang, at `refunded` ay Admin pa rin), at ang bagong Booking ay hindi na maaaring
mag-angkin ng `verified` o `approved`. Nasa
`docs/adr/0010-money-and-audit-invariants-in-the-rule-layer.md` ang desisyon:
nasa rules ang mga invariant ng pera at pagkakakilanlan, pero nasa lifecycle
module pa rin ang talahanayan ng mga transition — isang beses lang nakasulat.

**Dalawang antas ng verification.** Ang in-repo evaluator ay **supplemental**
lamang (mabilis, tumatakbo sa CI, tunay na rules text ang pinapatakbo); ang
**canonical** ay ang Firebase Emulator Suite, at hindi pa ito tumatakbo dito.
Hindi kailanman ire-report ang supplemental na resulta bilang emulator-verified.

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

## 14. ADR-0016 pass — the forgotten-Security-PIN reset (2026-10-06)

A later pass, recorded separately from §1–§13 above so those numbers keep meaning
what they meant. It added one rule door, one collection, one sheet and one gate
affordance.

### 14.1 What actually ran

| Check | Command | Result |
| --- | --- | --- |
| Dart policy + widget suites | `flutter test` on `pin_policy_test.dart`, `pin_gate_screen_test.dart`, `pin_sheet_widget_test.dart`, `pin_layout_test.dart`, `security_gate_test.dart` | **80 / 80** before the change, **93 / 93** after — 13 new (6 policy, 7 widget) |
| Dart static analysis | `flutter analyze lib/` plus the two touched test files | **0 errors, 0 warnings**, 59 `info` (pre-existing `withOpacity` deprecations against a newer SDK) |
| Rules file parses | `@firebase/eslint-plugin-security-rules` parser | **PASS** |
| ADR-0016 rule behaviour | `test/rules/engine.ts` driven directly, 25 assertions | **25 / 25** |
| TypeScript typecheck | `npx tsc --noEmit --strict` on `test/rules/firestore-rules.test.ts` | the additions contribute **0** errors; 9 pre-existing errors elsewhere in the file |

### 14.2 What did NOT run, and why

| Check | Why |
| --- | --- |
| `npm run test:rules` | **Blocked twice over.** `scripts/phase0/boundary.mjs` refuses any non-`.example` dotenv file and `.env.local` is present; then `assertIsolatedProcess()` refuses any platform that is not Linux, with the words *"Linux network namespace required; no weaker fallback is permitted"*. Not runnable on Windows. |
| `npm run test:emulator` | not attempted. The §3 blocker (emulator JAR host unreachable) still stands; a Java runtime is now present, which removes one of two blockers but not the other. |
| `npm test`, `npm run test:e2e` | not run. Both go through the same Linux launcher as `test:rules`. |
| `flutter build apk`, any device run | no device or emulator available. |
| The new rules under the Emulator | `test/emulator/rules.emulator.test.ts` has **no `admin_security` block at all**, an ADR-0015 gap that is inherited here. The new delete door therefore has no emulator case. |

### 14.3 How the rules were verified anyway, precisely

`test/rules/engine.ts` is a pure evaluator: it parses the repository's real
`firestore.rules` and decides requests against in-memory stores, with no Firebase
SDK import and no network. It was driven directly from a throwaway harness (since
deleted) using the repository's own fixtures from `test/rules/context.ts`, asserting
the 24-hour boundary, every refusal, and the `admin_security_events` shape.

**This is not the documented suite.** It is the same evaluator the documented suite
uses, so it exercises the same rule text, but it ran without the network-namespace
isolation `boundary.mjs` insists on, and it must never be reported as
`npm run test:rules`.

Two real defects surfaced this way rather than by reading:

1. **`duration(hours: 24)` does not parse.** The first `duration()` in this
   repository's rules, written the prettier way, made `firestore.rules`
   **unparseable by the very parser `engine.ts` uses**, which would have failed
   `npm run test:rules` for everyone on Linux with no obvious cause. The working
   form is `duration.value(24, 'h')`, documented at `engine.ts:121`.
2. **The boundary is strict.** `>`, not `>=`: a reset is refused at exactly 24 h
   and permitted 1 ms later. The first draft of ADR-0016 said "once 24 h have
   passed" and the first tests said "allowed at exactly 24 h". Both were wrong and
   are corrected.

### 14.4 A pre-existing failure, not caused by this pass — fixed in §15

`adminSecurityDoc()` in `test/rules/context.ts` carried a 36-character `pin_hash`
while `isAdminSecurityShape()` requires `size() >= 40`, and its own comment claimed
44. The suite's existing `admin_security` **create** case therefore failed on the
unmodified repository. Confirmed by evaluating `HEAD`'s rules with the unmodified
fixture: `create` denied; padding the hash to 47 characters allowed. Left unfixed
at the time because it predates ADR-0016 and belongs to the ADR-0015 doors.

**Fixed on 2026-10-06** (§15.4): the fixture now carries the base64 of 32 bytes,
44 characters, which is the shape a SHA-256 PIN hash has and what the app writes.
Five cases turned green. A sixth then changed meaning rather than colour, and is
recorded there too.

---

## 15. Guest downpayment refusal pass — money as two numeric types (2026-10-06)

A Guest reported that submitting a booking at `/book/pay` (step 2 of 3) failed. The
page showed a correct quote — ₱6,000 for one 22-hour standard stay for two on a
Saturday, ₱3,000 due now, a ₱2,000 refundable deposit listed separately, ₱3,000 at
check-in, `v1-guest-v3` rates — the screenshot uploaded, the OCR read a reference off
it, and the write came back as a bare `permission-denied` with nothing to explain it.
No Booking was created.

### 15.1 What the evidence ruled out, and what it left

Read off the live project over REST (`site_config/rates` is publicly readable, which
is how the website quotes a price to a signed-out visitor): the published figures were
whole pesos, `holiday_dates` was empty, the policy version and effective date the page
echoed matched the document, the 30-day lead-time default applied on both sides, and
the document passed the repository's own `validatePublishedRates`. The offline suite,
run against that exact document and that exact payload, said **allow**. The client's
mirror said **ok**. So the refusal was not the money, not the dates, not the identity,
not the proof upload, and not the availability check — it was either something the
offline evaluator could not see, or a ruleset that is not the one in this repository.

Both are addressed below. Neither is claimed as proven: the emulator that could settle
it is still blocked (§3.1), and the deployed ruleset cannot be read from here.

### 15.2 The finding: `int` and `float` are two types, and equality is one of them

The rules runtime keeps two numeric types. Captured against the Firestore Rules Test
API (project `digame-mas`, observed 2026-09-28, Web SDK 12.13.0):

| Expression | Verdict |
| --- | --- |
| `1.5 + 1 == 2.5` | **allow** — mixed arithmetic promotes to float |
| `1 == 1.0`, `0 == -0.0` | **allow** — a scalar compares by value |
| `[1] == [1.0]`, `{'a': 1} == {'a': 1.0}` | **deny** — a List or Map compares elements by type *and* value |
| `1.0 in [1]`, `[1].hasAny([1.0])`, `removeAll()` | **deny / false** — membership is typed |
| `[1].toSet().hasAny([1.0])`, `{'a': 1}.diff({'a': 1.0})` | **allow / no affected keys** — Sets and `diff()` compare by value at every depth |
| `NaN == NaN` | **deny**, at every depth |
| `int > float` and siblings | **not settled** — see below |

Two consequences for this repository, and they are why the Guest was refused or one
refresh away from being refused:

1. **A Booking carries a copy of the published cancellation policy**
   (`refund_policy_snapshot`), and the gate compared that copy with `==`. Map equality
   is type-strict per element, so the moment one figure in the published policy is a
   double — the Admin's Flutter app writes Dart `double`s, and a whole Dart double
   reaches Firestore as a `doubleValue` while the Web SDK writes the same whole number
   as an `integerValue` — *every* Guest submission reads as a tampered policy and is
   refused. Invisibly: the page shows `permission-denied` and nothing else. It now
   compares with `diff().affectedKeys().size() == 0`, which asks the question that was
   meant — did the Guest change a figure — and nothing about encoding.
2. **Every money comparison in the gate could mix the two types.** `firestore.rules`
   now normalises both sides to integer centavos through one function, `centavos()`,
   so no gate orders or equates an int against a float anywhere: not the rate, the
   stay total, the down payment, the deposit, the balance, the claim, the pet fee, the
   late-checkout fee, the refund ceiling on a withdrawal, or the published figures the
   Admin write door validates. `dueCents = totalCents * 50 / 100` is the client's own
   floor-at-whole-centavos (`downPaymentAmount`), and it is exact under integer
   division rather than depending on a `/ 100.0` to rescue it.

`int > float` is the one question the captures do not answer. The runtime's message for
a mixed comparison names `int > int, float > float` and no mixed pair — but the same
message for `+` omits `int + float`, which *does* work, so the message is not evidence.
The rules no longer depend on the answer, and the evaluator models the strict reading
(§2.1 item 5) so that a green offline suite means the same thing under either.

To make any of that provable offline, `test/rules/engine.ts` had to stop having one
number type. It now carries `float` as a distinct value, converts a suite's JS data the
way the wire would (a whole number is an int, a fractional one a double), truncates
`int / int`, promotes mixed arithmetic, and applies the equality and membership rules in
the table above. `test/rules/engine.test.ts` pins each row, with its source.

**One pin of the evaluator's own was wrong and is corrected here**, against the standing
rule that it is never modified to make a case pass: `7 / 2 == 3.5` was pinned as true,
which is JS division. In the rules language it is `3`. That pin is why the earlier
version of this gate looked safe offline while it divided two ints and produced
whole-peso figures in production — the defect PR #49 fixed by forcing float division
with `/ 100.0`. The correction tightens the evaluator; it does not loosen a case.

### 15.3 What ran

| Check | Command | Result |
| --- | --- | --- |
| Rules, offline | `npm run test:rules` | **330 / 330** — was 315 with 5 failing (§15.4) |
| Web | `npm test` | **892 / 892** |
| TypeScript | `npm run check:phase0` | 3 errors, all pre-existing in `test/phase0/*` and untouched here (confirmed by re-running with this pass stashed) |
| Rules, emulator | `npm run test:emulator` | **NOT RUN — blocked** (§3.1: the emulator JARs cannot be downloaded here). A new case was added to `test/emulator/rules.emulator.test.ts` and has never executed. |

New offline cases, in `test/rules/firestore-rules.test.ts` under *money as the two
writers encode it*: the production rates document and the production payload; the same
document with every whole figure published as a double; a submission whose own figures
are doubles; the policy snapshot in all four encoding combinations, with a changed
figure and a dropped tier still refused; an under-claim in either encoding still
refused; a centavo off still refused; an odd published rate floored at centavos; and
published addons priced in centavos in a document that mixes both encodings.

The emulator case that was added but not run publishes fractional figures — a JS client
cannot write a whole number as a double, so the encoding asymmetry itself is only
reachable offline, where a fixture can say `ruleFloat(5000)`, and that half is stated in
the case's own comment.

### 15.4 The `admin_security` fixture, and a case that changed meaning

§14.4's 36-character `pin_hash` is padded to the base64 of 32 bytes, so the five
`admin_security` cases that were red on `HEAD` are green. One case then stopped passing
for the wrong reason: *refuses a rotation that keeps the old hash* submitted a document
identical to the stored one, which the shape check had been refusing wholesale. With a
valid hash, an identical document is a no-op write and door 1 has nothing to refuse — no
key moved. The case now says what it means: an unchanged hash may not re-stamp
`pin_updated_at` and may not lower `failed_attempts`, and a write that moves nothing is
recorded as allowed because that is what the doors do.

### 15.5 What only the owner can do

**The rules are not deployed by anything automatic.** `.github/workflows/deploy.yml`
publishes the website to Pages and never touches `firestore.rules`; the documented step
is manual (`docs/FIREBASE_SETUP.md` §5):

```
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Nothing in the repository records which ruleset is live, so a fix that is merged and not
deployed changes nothing for a Guest — and PR #48 ("Fix Firestore rules let-binding
limit") implies an earlier ruleset failed to compile, which means production may still
be running something older than `main`.

To find out what *is* live: Firebase console → Build → Firestore Database → **Rules**
shows the current ruleset with its revision history and the date of the last deploy, and
that text can be diffed against this file. The Firebase CLI has no `rules:get`
(`firebase firestore` manages databases only); the same answer is available over the
Rules REST API, `GET
https://firebaserules.googleapis.com/v1/projects/<project>/releases/cloud.firestore/(default)`
for the live `rulesetName` and then `GET .../rulesets/<id>` for its source, both needing
a `gcloud auth print-access-token` bearer.

After deploying:

1. Confirm which project and config the site is talking to at `/status`
   (`src/pages/StatusPage.tsx` names both).
2. `npm run prepare:phase0:emulators && npm run test:emulator` on a machine that can
   download the emulator JARs — the canonical suite, including the case added here, has
   still never run anywhere.
3. Submit one real booking at `/book/pay` and confirm it lands as **Pending**, not
   confirmed, awaiting the Admin's verification of the proof.
4. If it is refused again, the browser console now carries a copy-pasteable
   `rules-refusal diagnostics` block (PR #50) with the payload, the published document
   and the resolved lead time. That block settles in one reading whether the live
   ruleset is the one in this repository.
