# Hacienda de LuisAna: Canonical Verification (Phase 0 Completion Gate)

Date: 2026-10-01. Baseline commit `5297ec7a1432222c0e2c1f24bd3af353e786c116`. Branch `arena/01a0f701-hacienda-de-luisana`.

**Scope:** verification only. No remediation was done. The following were **not** modified:

- Firestore rules, `storage.rules` and `database.rules.json`;
- Supabase SQL and the Edge Function;
- any production source, dependency or lockfile;
- the deploy workflow.

The `SCOPE` hash test (210 production files compared with the baseline commit) still passes.

---

## 1. What "canonical" means here, and what actually ran

| Layer | Canonical engine | Ran? | Why / why not |
|---|---|---|---|
| Firebase Auth | Auth Emulator bundled in locked `firebase-tools` 15.31.0. It needs no Java and no JAR. | **YES** | `npm run test:emulator:auth` ran 6/6 PASS inside the loopback-only namespace. |
| Firestore rules | `cloud-firestore-emulator-v1.22.0.jar`, pinned in `firebase-tools` 15.31.0 | **NO: BLOCKED** | Java 21 is now installed. The JAR comes only from `storage.googleapis.com`, which this sandbox cannot reach (TLS `SSL_ERROR_SYSCALL`). |
| RTDB rules | `firebase-database-emulator-v4.11.2.jar` | **NO: BLOCKED** | Same. |
| Storage rules (legacy) | `cloud-storage-rules-runtime-v1.1.3.jar` | **NO: BLOCKED** | Same. |
| Flutter/Dart | Flutter 3.44.4 stable (Dart ≥ 3.12) | **NO: BLOCKED** | `storage.googleapis.com` (SDK and engine) and `pub.dev` are unreachable. |
| Supabase Storage / RLS | An isolated Supabase staging or local stack | **NO: BLOCKED** | See the list below. |
| Supabase Edge Function | Deno running `supabase functions serve` | **NO: BLOCKED** | Deno is not installed, and `jsr.io` and the npm-for-Deno imports are unreachable. The function also requires a Firebase service account; Phase 0 refuses it by design. |
| *Supplemental:* PostgreSQL RLS | PGlite 0.3.15 (PostgreSQL 17.5 compiled to WASM, in-process) | **YES** | `npm run test:supabase:rls` ran 11/11 PASS. **This is not Supabase.** See §4. |

Why the Supabase stack cannot be provisioned:

- no Docker;
- `supabase.com` and `api.supabase.com` are unreachable;
- the `supabase` npm CLI downloads its binary from GitHub release assets, which are also unreachable;
- the production project (`project_id` in `supabase/config.toml`) must not be used.

### Network evidence (2026-10-01, from this sandbox)

- **Reachable:** `github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`.
- **Unreachable** (connection reset / HTTP 000):
  - Google and Firebase artifact hosts: `storage.googleapis.com`, `dl.google.com`, `maven.google.com`;
  - Dart, Flutter and Deno hosts: `pub.dev`, `storage.flutter-io.cn`, `deno.land`, `jsr.io`;
  - Java vendors: `api.adoptium.net`, `cdn.azul.com`, `corretto.aws`, `download.java.net`;
  - package mirrors: `deb.debian.org`, `repo1.maven.org`;
  - container registries: `registry-1.docker.io`, `ghcr.io`, `quay.io`;
  - GitHub release-asset hosts: `objects.githubusercontent.com`, `release-assets.githubusercontent.com`;
  - Supabase: `supabase.com`, `api.supabase.com`;
  - Playwright browser CDNs.

### How Java 21 was obtained

Java 21 is Eclipse Temurin 21.0.8+9, from the PyPI wheel `jdk4py==21.0.8.2`.

- The wheel's SHA-256 `85addfcb…0356` is pinned in `scripts/phase0/toolchain.mjs`.
- It is installed into the gitignored `.cache/phase0/java` by `npm run prepare:phase0:java`.
- No system package was changed.

### Emulator artifact integrity

`prepare:phase0:emulators` now verifies the pinned emulator artifacts after download. So does every emulator test action.

- **What is checked:** size and SHA-256.
- **Where the expected values come from:** the locked `firebase-tools/lib/emulator/downloadableEmulatorInfo.json`. They are not restated, so the version cannot drift silently.
- **If a JAR is missing or mismatched:** the result is BLOCKED (exit 78). It is never run.

The 3 JARs can also be copied into `.cache/phase0/emulators/` by hand on an air-gapped machine. They are accepted only if the checksums match.

### Rejected substitutes (not used, on purpose)

- `@firestore-emulator/server` (npm): a third-party Node re-implementation of Firestore. It is not Google's rules engine, so a PASS there would not be a Firebase PASS.
- A third-party "firebase-emulator-cache" GitHub release: unreachable anyway (release-asset host blocked). It would have been acceptable only after pinned-checksum verification.
- Running the suites on GitHub-hosted Actions runners: this requires committing and pushing a new workflow. The integration token reports `push:false` and cannot read Actions settings or secrets. This is an owner action; it is not done silently. See REPORT §Remaining Blockers.

---

## 2. Production-isolation verification (run before any integration test)

`npm run test:safety` → **44/44 PASS** (32 earlier, plus 12 new). It verifies that:

- the kernel network namespace differs from the launcher's and has loopback only;
- reserved external IPv4 and IPv6 addresses have no route, including from a native subprocess;
- every non-demo project variable fails closed;
- credential and Supabase variables are refused **by name only**, with values never echoed. New in this phase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`;
- proxy escape routes are refused in either case: `HTTP_PROXY`, `http_proxy`, `https_proxy`, `ALL_PROXY` and `all_proxy` (the lowercase variants are new);
- dotenv files, credential files and authenticated Firebase CLI caches block the run;
- a fake `HDL_PHASE0_ALLOW_PRODUCTION=true` flag does nothing, and no bypass exists;
- arbitrary runner flags and payloads are refused;
- **new:** a present but wrong emulator JAR is reported `mismatched` and never `verified`;
- **new:** Java resolution uses a fixed repository path, not an environment override;
- **new:** `FIREBASE_CONFIG` is accepted only as the exact demo-derived value (see the harness issue below). Another project, an extra key or different whitespace is refused.

### Harness issue found and fixed (test tooling only)

`firebase emulators:exec` injects `FIREBASE_CONFIG={"projectId":"demo-hacienda","storageBucket":"demo-hacienda.appspot.com","databaseURL":"https://demo-hacienda.firebaseio.com"}` into the script it runs (`firebase-tools/lib/emulator/commandUtils.js`, `runScript`).

The Phase 0 boundary refused that name unconditionally. As a result, **every** emulator suite would have failed closed inside its own launcher, before a single rule was evaluated. The earlier Phase 0 run never got far enough to see this, because Java was missing.

The fix accepts only that exact byte string. This is a **TEST HARNESS ISSUE** in Phase 0 tooling. It is not an application finding.

---

## 3. Firebase canonical results

### 3.1 Auth Emulator: RAN (`npm run test:emulator:auth`, 6/6 PASS)

These tests make the **same SDK calls** as the website:

- `src/lib/guestAuth.ts:50` calls `signInAnonymously`;
- `src/lib/authFirebase.ts:120` calls `createUserWithEmailAndPassword`;
- `src/lib/authFirebase.ts:132` calls `signInWithEmailAndPassword`.

The calls run against the real Auth Emulator. The tests do **not** import `src/lib/firebase.ts`, which initialises only when a Firebase web config is supplied, and Phase 0 refuses to supply one.

| Test | Result | Meaning |
|---|---|---|
| Emulator bound to `demo-hacienda` on `127.0.0.1:9099` | PASS | Boundary holds. |
| Anonymous tokens are unsigned (`alg: none`), with `aud=demo-hacienda` and provider `anonymous` | PASS | These tokens could never be accepted by production. |
| F16: anonymous session → `createUserWithEmailAndPassword` gives a **different** UID, and the anonymous account is left orphaned | PASS | Confirms the platform behaviour behind F16. |
| F16: anonymous session → `signInWithEmailAndPassword` gives a **different** UID | PASS | Same. |
| CONTROL: `linkWithCredential` keeps the anonymous UID | PASS | A UID-preserving path exists, but the website does not call it (source). This is not a fix and nothing was changed. |
| F04 precondition: a self-registered password account gets a token whose `email` is chosen by the registrant and whose `email_verified` is `false` | PASS | The decisive part of F04 (whether `firestore.rules` treats such a token as Admin) needs the Firestore emulator and is **BLOCKED**. Production sign-up settings are deployed state. |

### 3.2 Firestore / RTDB / Storage rules: BLOCKED

| Command | Result | Exact reason (from `.cache/phase0/results/*.command.json`) |
|---|---|---|
| `npm run test:emulator` | **BLOCKED** (exit 78) | `pinned emulator artefacts not verified (firestore v1.22.0 missing, database v4.11.2 missing, storage v1.1.3 missing)`. Java 21.0.8 was resolved from the pinned path. |
| `npm run test:emulator:invariants` | **BLOCKED** (exit 78) | Same. |

So the 2 existing canonical suites (`test/emulator/*.test.ts`) and the Phase 0 emulator suites have **still never executed**:

- characterization: security, location, concurrency and auth-review;
- invariants: security, location and concurrency.

Every rules-level outcome in REPORT §C is still a hypothesis from the in-repository supplemental evaluator. It is **not** a Firebase result.

### 3.3 Classification of failing invariants

**No canonical emulator invariant executed**, so none can yet be classified as one of the following:

1. confirms the finding;
2. contradicts the simulated test;
3. exposes a new issue;
4. is a harness issue.

The 31 failing *simulated* invariants (`npm run test:invariants`) are the same 31 as before, and are desired-but-unmet behaviour. They are not regressions. One item is classified on canonical evidence alone: the boundary refusal described in §2, a type-4 harness issue, now fixed.

---

## 4. Supabase: staging BLOCKED; supplemental Postgres policy evaluation

### What `test:supabase:rls` proves

`supabase/01-storage.sql` was applied **verbatim and twice** (the idempotency claim holds) to real PostgreSQL 17.5 (PGlite), on top of a minimal reconstruction of Supabase's `storage` schema (`test/phase0/supabase/storage-schema.reconstruction.sql`). Roles were entered with `SET ROLE`. This shows how Postgres's own RLS engine evaluates the production policies.

### What it does not prove

It does **not** cover:

- the Supabase Storage API: upsert/RETURNING choice, `owner`, size and MIME enforcement;
- PostgREST or JWT;
- signed URLs;
- the Edge Function.

| Requested verification | Result | Evidence |
|---|---|---|
| Receipt bucket access | Policy layer: private bucket with `file_size_limit` 5 MB. Enforcement itself: **REQUIRES STAGING** | PG test 1 |
| Anonymous upload | Policy layer: **allowed** for any `payments/…` path in `payment-proofs`. Denied outside `payments/` and in other buckets (42501). | PG tests 2–4 |
| Authenticated upload | Policy layer: **denied** (42501). Policies grant `anon` only, and the website uses no Supabase session. | PG test 6 |
| Cross-user access | Write: anon may write under **another** guest's UID segment, because the UID is not bound to the caller. Read: 0 rows visible to anon or authenticated. | PG tests 3, 5, 6 |
| Booking-scoped proof access | **Not enforced at the storage layer.** No policy references a booking, and the path has no booking ID. | PG test 11 + source |
| Proof deletion | anon/authenticated delete affects 0 rows. `service_role`, the Edge Function's key, bypasses RLS. | PG test 7 |
| Overwrite / proof swap | anon UPDATE affects 0 rows, because the row is invisible without a select policy. An upsert-shaped `INSERT … ON CONFLICT DO UPDATE` is refused even for a first upload (42501). This matches the file's own comment. | PG tests 8, 9 |
| Duplicate proof / reference | The same path twice is refused (23505). A retry attempt (`proof-2`) and the same reference under another UID are each **accepted as new objects**. | PG test 10 |
| Edge Function behaviour | **BLOCKED** (no Deno, imports unreachable, service account refused) | — |
| Real Supabase upload, read and signed URL | **BLOCKED** (no staging) | — |

### Specific findings

- **F05: PARTIALLY CONFIRMED (policy layer only).** Real Postgres confirms that the anon role may add objects under any guest's `payments/{uid}/…` path, with no booking binding, while reads stay closed. Whether the Supabase Storage API adds further restrictions (owner, MIME) **REQUIRES STAGING**.
- **F12: BLOCKED.** F12 is the cross-store mismatch: a browser-local proof accepted into a cloud booking, and a production build that pairs live Firebase with no Supabase settings. It needs the Firestore emulator plus Supabase staging. Nothing here contradicts the simulated result.
- **F17: BLOCKED** for its core claim, which is duplicate *bookings* after a lost Firestore response or a double submit. That needs the Firestore emulator. The storage layer is consistent with the simulation: each retry produces another accepted object, and the storage layer does not deduplicate by reference.

---

## 5. Flutter: BLOCKED

| Command | Result | Reason |
|---|---|---|
| `npm run test:flutter` | **BLOCKED** (78) | `Flutter/Dart SDK missing` |
| `npm run test:flutter:invariants` | **BLOCKED** (78) | Same |
| `npm run test:flutter:analyze` | **BLOCKED** (78) | Same |

**Required versions:**

- Flutter **3.44.4 stable**: `.metadata` revision `ad70ec4617166f1c38e5d2bfd388af71fda14f06`, which is the "update changelog for 3.44.4" commit.
- `pubspec.lock` requires `flutter >=3.44.0` and `dart >=3.12.0 <4.0.0`.

**Mobile coverage against the requested areas** (static inventory; none of it executed):

| Area | Coverage | Tests |
|---|---|---|
| Booking state display | PARTIAL | `test/booking_lifecycle_test.dart` covers `normalizeStatus`, transitions and `adminActionsFor`. There is no widget/screen test of what the Admin sees. |
| Admin handover (Admin A → B) | PARTIAL | The lifecycle test's "who may act" group covers guest/system/Admin roles only. Phase 0 has an F06 Dart characterization of two Admins on stale data. There is **no** Dart test for F15 (Admin B continuing Admin A's booking); that is covered only by web supplemental rules. |
| Mock/demo fallback | NOT COVERED | Only the F14 parser characterization and invariant (`characterization_test.dart:56`, `invariants_test.dart:24`). Nothing tests whether the Admin app shows demo data on a denied or failed read. |
| Financial reporting | PARTIAL | `booking_model_test`/`booking_lifecycle_test` cover the stay-total and refund breakdown; Phase 0 adds the F28 `totalAmount` characterization and invariant. |
| Identity / recovery | NOT COVERED | No Dart test of Admin sign-in, the role bootstrap or recovery. |
| Release configuration | NOT COVERED | No test of `android/app/build.gradle` signing or applicationId (F32). This is device/release work. |

The gaps are recorded, not filled. New Dart tests that cannot be compiled here would be unverified code.

---

## 6. Reconciliation: simulated vs canonical

**Status key:**

- **CONFIRMED:** canonical evidence fully confirms the simulated result.
- **PARTIALLY CONFIRMED:** canonical evidence confirms part of it; the rest is blocked.
- **NOT REPRODUCED:** canonical evidence contradicts it.
- **TEST HARNESS ISSUE:** the simulated result is an artefact of the harness.
- **BLOCKED:** no canonical execution was possible.

"Simulated" means one of: the pure model, the in-repository supplemental rules evaluator, Firestore/Auth SDK doubles, or source inspection.

| Finding | Simulated Result | Firebase/Flutter/Supabase Result | Status | Explanation |
|---|---|---|---|---|
| F01 | Supplemental: unsigned, foreign-UID and malformed booking creates allowed | Firestore emulator not run | BLOCKED | Rules-level claim; JAR unavailable. |
| F02 | Model/supplemental: ₱1/zero-due approval; guest quote rewrite allowed | Firestore + Flutter not run | BLOCKED | Approval runs in the Admin app (Dart) and rules. |
| F03 | Supplemental: Approved verified downgrade and proof swap allowed | Firestore not run | BLOCKED | Supabase PG shows anon cannot UPDATE stored *objects*. F03 concerns the Firestore booking field `payment_proof_url`, so this neither confirms nor contradicts it. |
| F04 | Resolver/supplemental: unverified allowlisted claim treated as Admin | Auth emulator: a self-registered account gets a registrant-chosen `email` with `email_verified=false`. Firestore not run. | BLOCKED | Only the precondition was observed canonically. The decisive rules evaluation is blocked; production sign-up settings are runtime state. |
| F05 | SQL source: anon insert; legacy Storage needs no booking | Real Postgres RLS on verbatim SQL: anon may write any `payments/{uid}/…` (including another UID's); no read; no booking binding. Supabase staging not run. | PARTIALLY CONFIRMED | Policy layer confirmed by Postgres's engine. The storage-api layer and the live project are unverified. |
| F06 | SDK double: two approvals on capacity 1 | Firestore transactions + Flutter not run | BLOCKED | Real transaction contention semantics are needed. |
| F07 | Model: claim copied as verified; duplicate reference accepted; overpayment not reconciled | Postgres: the same reference under 2 paths is accepted as 2 objects. Flutter/Firestore not run. | BLOCKED | The storage-layer observation is consistent with the finding but is not the claim, which is about verification logic in Dart/Firestore. |
| F08 | Model: no reconciliation record on paid Pending terminal paths | Not run | BLOCKED | Also an owner policy decision (money disposition). |
| F09 | Model: Completed early with ₱23,999 due | Flutter not run | BLOCKED | Dart test written, never executed. |
| F10 | Model: ₱12,000 vs ₱1,500 refund under the same policy version | Flutter not run | BLOCKED | Refund rules also need an owner decision. |
| F11 | Model: disjoint nights exhaust 2 units | Firestore/Flutter not run | BLOCKED | — |
| F12 | Real helpers + SDK double: local-only proof accepted into a cloud booking; wrapper drops mode | Firestore + Supabase staging not run | BLOCKED | Cross-store behaviour needs both. Nothing contradicts the simulation. |
| F13 | SDK double: denied non-decision patch resolves and mutates the local copy | Firestore not run | BLOCKED | Needs real `permission-denied` from the emulator. |
| F14 | Web: denied subscription emits demo bookings; denied list `[]` | Firestore/Flutter not run | BLOCKED | — |
| F15 | Supplemental: Admin B progression denied | Firestore not run | BLOCKED | No Dart test exists either (§5). |
| F16 | Auth adapter double: register/login replace the anonymous UID | Auth emulator, same SDK calls as `authFirebase.ts`: new UID on both; anonymous account orphaned; the link control keeps the UID | PARTIALLY CONFIRMED | Identity loss confirmed on real Auth. Whether bookings become unreachable under the new UID needs Firestore rules (blocked). The app module was not executed (it needs a web config). |
| F17 | SDK double: lost response + retry gives 2 bookings; double submit; upload timeout leaves the operation live | Firestore not run. Postgres: each retry is a new accepted object. | BLOCKED | The core claim is about Firestore bookings. The storage observation is only consistent with it. |
| F18 | Replay duplicates Activity; local fallback; guest false Approve event | Firestore not run | BLOCKED | — |
| F19 | Not testable: no firmware or gateway in the repository | — | BLOCKED | Genuinely cannot run: no artefact exists to execute. |
| F20 | Supplemental: guest can mint a granted access row; simulator payload incomplete | Firestore not run | BLOCKED | — |
| F21 | Web transport double: 30 min vs 90 s; `stream_secret`/`session_secret` mismatch | RTDB emulator not run | BLOCKED | — |
| F22 | SDK double: inactive session publishes; stop failures swallowed | RTDB/Firestore not run | BLOCKED | — |
| F23 | Existing offline tests only | Not run | BLOCKED | — |
| F24 | Real component + double: status loads once; later stages show the Pending headline | Firestore not run | BLOCKED | Live subscription behaviour needs the emulator. |
| F25 | Supplemental: missing-review get denied | Firestore not run | BLOCKED | The canonical application-sequence test is written and unexecuted. |
| F26 | Source: no review composite indexes | Deployed index state | BLOCKED | Emulators do not enforce production indexes, so this needs staging/runtime. |
| F27 | Source: privacy text vs live location; retention deletes nothing | Not run | BLOCKED | Purge requires staging and the owner. |
| F28 | Source: `totalAmount` defaults to nights×12000 | Flutter not run | BLOCKED | — |
| F29 | Source: room status separate from capacity | — | BLOCKED | Needs an owner decision (room-to-unit mapping). |
| F30 | Source: unbounded approval query | Not run | BLOCKED | Load test not available. |
| F31 | Source: deploy on Node 20 vs locked dependency ≥22; no test gate. Local Node 22 build PASS. | Hosted CI metadata, read only: the last 3 `Deploy to GitHub Pages` runs on `main` (e.g. run 36808897623) succeeded through `npm ci` and `npm run build` on Node 20, and contain no test step | PARTIALLY CONFIRMED | **Contradiction recorded:** the Node-version mismatch does **not** currently break the hosted build, so the impact is not reproduced. The missing test gate is confirmed. |
| F32 | Source: debug release signing | Device/release not run | BLOCKED | — |
| F33 | Not testable: no delivery/escalation consumer | — | BLOCKED | Genuinely cannot run: nothing tracked to execute. |

**Totals:**

- CONFIRMED 0;
- PARTIALLY CONFIRMED 3 (F05, F16, F31);
- NOT REPRODUCED 0;
- TEST HARNESS ISSUE 0 among the findings (one harness issue was found in the Phase 0 tooling itself; see §2);
- BLOCKED 30.

No simulated result was contradicted by canonical evidence, except the **impact** portion of F31.
