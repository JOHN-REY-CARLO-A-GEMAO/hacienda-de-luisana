# Hacienda de LuisAna — Phase 0 Report (Tests & Safety Preparation)

Date: 2026-10-01 · Baseline commit `5297ec7a1432222c0e2c1f24bd3af353e786c116` · Branch `arena/01a0f701-hacienda-de-luisana`

Status: **PARTIAL** (re-confirmed at the Phase 0 completion gate, 2026-10-01). JavaScript/TypeScript characterization of current behavior is complete and reproducible.

Canonical verification status:

- **Ran:** the Firebase Auth Emulator, and a supplemental real-Postgres evaluation of the Supabase storage policies.
- **Still BLOCKED:** the Firestore/RTDB/Storage emulators (their pinned JARs cannot be downloaded), Flutter, and Supabase staging/Edge.

See the *Phase 0 Completion Gate* section at the end and `docs/phase0/CANONICAL_VERIFICATION.md`.

No production behavior was changed. A test (`SCOPE`, in `test/phase0/foundation.characterization.test.ts`) hashes 210 production source, configuration, rule and lock files against the baseline commit. It passes.

---

## A. Repository test inventory (before Phase 0)

| Layer | Location | Runner | Uses | Reaches production? |
|---|---|---|---|---|
| Web unit/component (42 files) | `test/web/` | Vitest/jsdom | localStorage demo adapters, SDK mocks, source-string checks | No: hermetic `envDir`. Before Phase 0, inherited shell environment variables were not refused. |
| Supplemental rules (4 files) | `test/rules/` | Vitest + in-repo evaluator `engine.ts` | Rules text only | No. **Not canonical**: the evaluator's semantics may differ from Firebase's. |
| Offline “E2E” (1 file) | `test/e2e/` | Vitest/jsdom | Demo adapters, evaluator and smart-lock contract | No. **Not** browser, cloud or device E2E. |
| Canonical emulator (2 files) | `test/emulator/` | `firebase emulators:exec` | Firestore/Storage/RTDB emulators | Previously: project taken from inherited environment variables; arbitrary command override; global Java process sweep. Hardened in Phase 0 (§B). |
| Dart unit (7 files) | `test/*_test.dart` | `flutter test` | Pure Dart | No Firebase. **Not runnable here: no SDK.** |
| Browser QA (3 scripts) | `docs/qa/*.mjs` | Playwright, manual | Local dev server | Hosted `BASE_URL` was accepted. Now guarded. |
| Cleanup tool | `scripts/cleanup-test-bookings.mjs` | Manual | **Real Admin credentials against the live project** | **Yes, by design. Not a test; never run by any Phase 0 command.** |

CI (`.github/workflows/deploy.yml`) runs only `npm ci` and `npm run build`. It uses Node 20, runs no tests, and deploys GitHub Pages on every push to `main`.

## B. Safety-boundary report

### How the repository distinguishes environments

| Mode | Current decision mechanism |
|---|---|
| **PRODUCTION** | `import.meta.env.PROD`. Uses `VITE_FIREBASE_*`, or otherwise **falls back to the committed real project** in `src/lib/firebaseDefaults.ts`. Supabase uses `VITE_SUPABASE_*`; if absent, proofs fall back to **browser-local storage**. |
| **DEVELOPMENT** | `vite dev` with no `VITE_FIREBASE_*` runs in demo mode. If developer keys are present, it can talk to the live project. Emulators are used only when `VITE_USE_FIREBASE_EMULATORS === 'true'`. |
| **TEST** | Before Phase 0, there was no enforced concept. There is now one: the **Phase 0 TEST boundary** below. |

Flutter `lib/firebase_options.dart` contains only the real project's public configuration. Initialization failure is swallowed, and the app falls back to mocks.

### Phase 0 TEST boundary

Implemented in `scripts/phase0/` and designed in `SAFETY-DESIGN.md`:

1. **Fixed-action launcher** (`run.mjs`): every `npm test*`, `check:phase0` and `build:phase0` script uses it. It refuses extra arguments and arbitrary commands.
2. **Fail-closed preflight** (`boundary.mjs`): blocks non-demo project variables, `VITE_FIREBASE_*`, `VITE_SUPABASE_*`, `SUPABASE_*`, service-account/credential variables, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, proxies, `NODE_OPTIONS`, `DOCKER_HOST` and non-loopback `BASE_URL`. It also blocks any non-example `.env*` file, credential-like JSON, authenticated gcloud/Firebase/Supabase CLI state and a host Docker socket. Messages show **names only, never values**.
3. **Kernel isolation** (`netns.py`): every payload runs in a fresh unprivileged user and network namespace, with **loopback only**. Before payload execution, a negative control confirms that reserved external IPv4 and IPv6 addresses are unreachable. Native subprocesses inherit the namespace. This is not merely a mocked `fetch`.
4. **In-process assertion**: each Vitest config, setup file and QA script calls `assertIsolatedProcess()`. Running a config outside the launcher fails, and a forged marker variable is rejected.
5. **Emulators**: run only as `demo-hacienda` with a generated 127.0.0.1 config. They use no import/export dataset and a fixed payload. Cleanup is limited to the launcher's own process group; the old global Java sweep was removed.
6. **No override** exists. There is no "allow production" flag.

Evidence: `npm run test:safety` passes **32/32**. This includes namespace and interface checks, loopback positive control, IPv4/IPv6/native no-route controls, synthetic credential refusal without echoing values, and dotenv/credential-file/CLI-token refusal.

Limits: this protects against accidental production access by trusted test code. It is not a sandbox against hostile code. It requires Linux with unprivileged user namespaces. Where that is unavailable, commands report **BLOCKED** rather than falling back. The ordinary `npm run dev`, `npm run build` and `npm run emulators` scripts are unchanged and are outside this boundary.

## C. F01–F33 regression matrix

The machine-readable matrix is `docs/phase0/FINDINGS.json`. A test also checks that it contains all 33 findings with allowed statuses. Summary:

| Finding | Coverage | Phase 0 result | Environment |
|---|---|---|---|
| F01 | PARTIALLY COVERED | Current issue reproduced; desired check FAILS | Supplemental rules; canonical test written but BLOCKED |
| F02 | PARTIALLY COVERED | Reproduced (₱1/zero due; quote rewrite) | Model and supplemental rules; canonical BLOCKED |
| F03 | PARTIALLY COVERED | Reproduced (Approved downgrade/proof swap) | Supplemental rules; canonical BLOCKED |
| F04 | REQUIRES RUNTIME/STAGING | Reproduced for synthetic token claims only | Resolver and supplemental rules |
| F05 | PARTIALLY COVERED | SQL anonymous insert confirmed in source; legacy storage needs no booking association | Source/supplemental; Supabase requires staging |
| F06 | PARTIALLY COVERED | Two approvals on capacity 1 | Actual adapter with SDK double; canonical/Flutter BLOCKED |
| F07 | PARTIALLY COVERED | Claim treated as verified; duplicate reference; overpayment | TS model |
| F08 | PARTIALLY COVERED | No reconciliation record on paid Pending terminal paths | TS model; policy owner decision required |
| F09 | PARTIALLY COVERED | Future stay Completed with ₱23,999 still due | TS model; Dart test BLOCKED |
| F10 | PARTIALLY COVERED | Same policy version gives ₱12,000 vs ₱1,500 refund | TS model |
| F11 | PARTIALLY COVERED | Disjoint nights falsely exhaust 2 units | TS model |
| F12 | PARTIALLY COVERED | Browser-local proof accepted into a cloud booking | Actual helpers with SDK double; isolated build |
| F13 | PARTIALLY COVERED | Denied non-decision patch reported as success | Actual adapter with SDK double |
| F14 | PARTIALLY COVERED | Denied subscription emits demo bookings | Actual adapter with SDK double; Flutter BLOCKED |
| F15 | PARTIALLY COVERED | Admin B progression denied | Supplemental rules; canonical BLOCKED |
| F16 | PARTIALLY COVERED | Register/login replace anonymous UID | Auth adapter with SDK double; canonical BLOCKED |
| F17 | PARTIALLY COVERED | Lost response causes duplicate booking; upload timeout leaves operation live | Actual adapters with SDK doubles |
| F18 | PARTIALLY COVERED | Duplicate Activity; local fallback; false guest Approve event | Model/adapter/supplemental rules |
| F19 | NOT TESTABLE | No firmware or gateway in the repository | — |
| F20 | PARTIALLY COVERED | Simulator shape mismatch; guest can create a “granted” row | Source and supplemental rules |
| F21 | PARTIALLY COVERED | First fix uses 30-minute expiry, above the 90-second rule | Actual web transport with SDK double |
| F22 | PARTIALLY COVERED | Inactive session still publishes | SDK double; two-store canonical test BLOCKED |
| F23 | PARTIALLY COVERED | Not newly executed | Existing offline tests only |
| F24 | PARTIALLY COVERED | One-shot status; later states labelled as Pending | Real component with SDK double |
| F25 | RESOLVED 2026-10-06 | Missing-document review read denied (supplemental) | The read rule compared a uid against a `resource` that is not there when no Review exists yet, so `submitReview`'s pre-read was refused and the first review of a stay could not be filed. `allow read` now also opens an absent Review to the owner of the Booking the document id names — the same fact `create` checks. Covered offline (`test/rules/firestore-rules.test.ts`) and on the emulator (`test/emulator/rules.emulator.test.ts`, `test/phase0/emulator/auth-review.characterization.test.ts`). Deploy with `firebase deploy --only firestore:rules`. |
| F26 | REQUIRES RUNTIME/STAGING | No review indexes checked in | Deployed indexes unknown |
| F27 | PARTIALLY COVERED | Privacy copy contradicts location sharing; retention helpers do not delete | Source only |
| F28 | PARTIALLY COVERED | `nights × 12000` default | Source; Dart test BLOCKED |
| F29 | RESOLVED 2026-10-06 | Room status is separate from capacity | Owner decision: a `rooms` document is a status register keyed to a canonical Accommodation id, never a catalogue. Capacity, occupancy and money live in `site_config/rates`; availability reads `available_units` from there. The rate control the Rooms screen offered was removed because nothing read `rooms.pricePerNight`. |
| F30 | PARTIALLY COVERED | Unbounded approval query | Source only |
| F31 | PARTIALLY COVERED | Node 20 vs locked ≥22; local Node 22 build passes | Local only |
| F32 | REQUIRES RUNTIME/STAGING | Debug release signing | Static configuration |
| F33 | NOT TESTABLE | No delivery or escalation consumer | — |

“Reproduced” means the defect was observed in the stated harness. It does not imply a production incident.

## D. Test fixture inventory

`test/phase0/fixtures/scenarios.json`, with typed helpers in `fixtures/index.ts`. Everything is synthetic; every UID has the `phase0-` prefix.

- **Identities:** anonymous Guest, authenticated Guest, second Guest, Admin A, Admin B (both with seeded stored profiles), non-Admin, forged/mismatched UID, and an unverified token that claims an allowlisted address. The latter is used in emulator tokens only; no registration is attempted.
- **States:** all 9 current-path states, plus historical Payment Pending, Payment Verified, Reserved, and retired Confirmed / KYC Submitted. Includes ordered new and historical paths.
- **Money:** no payment, claimed, proof attached, partial, tampered partial, full, overpayment, duplicate reference, rejected proof, refund initiated, refund completed, unresolved paid rejection, and outstanding balance plus deposit.
- **Inventory:** single unit, multiple units, occupied, maintenance, consecutive nights, overlapping nights, and last-unit race.
- **Evidence:** valid, missing, foreign UID, wrong booking, duplicate reference, local-only, cloud-only, invalid type and too large.
- **Policy and location:** historical policy, changed policy under the same version, and a live-location session/fix.
- **Doubles:** `test/phase0/doubles/cloud.ts`, an explicit Firestore SDK double. It provides deterministic barriers, including a stale-query last-unit schedule, and lost-response injection. It is **not** proof of Firebase semantics.
- **Canonical helpers:** `test/phase0/emulator/helpers.ts`, with a rules-denial-only assertion and a `demo-hacienda` guard.

## E–I. Suites

Characterization tests (`*.characterization.test.*`) assert **current** behavior and are expected to pass. Invariant tests (`*.invariants.test.*`) assert **desired** behavior. They are ordinary tests with no `.fails` or skip wrapper, so they fail until remediation.

| Suite | Files | Current result | Desired result |
|---|---|---|---|
| E Security, supplemental | `security.*`, `supplemental-security.ts` | 23/23 PASS | 13 FAIL |
| E Security, canonical | `emulator/security.*` | BLOCKED (Java) | BLOCKED |
| E Identity | `identity.*`, `emulator/auth-review.*` | 5/5 PASS; canonical BLOCKED | 1 FAIL |
| F Booking flow (preservation contract) | `model.characterization` (FLOW-*), `status.*` | PASS | F24: 1 FAIL |
| G Concurrency | `cloud.*` (F06), `emulator/concurrency.*` | PASS (two commits reproduced); canonical BLOCKED | 1 FAIL; canonical BLOCKED |
| H Financial | `model.*` | PASS | 7 FAIL |
| I Failure/recovery | `cloud.*`, `proofs.*`, `location.*` | PASS | 9 FAIL |
| Foundation/source/scope | `foundation.characterization` | 14/14 PASS | — |
| Dart | `test/phase0/dart/*` | **BLOCKED / never executed** | BLOCKED |

### Booking-flow preservation contract

The current new-booking path is `Pending → Approved → Checked-In → Staying → Checked-Out → Completed`, with **no Reserved step**. The historical path is `Payment Pending → (verify) → Reserved`. Rejected, Cancelled and Expired are separate terminal states. Proof is required before Pending. Guests cannot approve. Retired statuses remain readable. Any future change that breaks these tests is a flow change requiring explicit approval.

### Smart-lock boundary (F19/F20)

No firmware or gateway exists in the repository. The simulator writes a payload that does not match the access-log contract. Rules let any signed-in user create a “granted” row under their own UID. Therefore **no current test, mock, UI state or access-log row can serve as proof of physical actuation**. This is a blocker for any later smart-lock phase.

### Activity/audit (F18)

Activity entries are client-side side effects, not authoritative records. They are appended after the state write in a separate transaction. On cloud failure they fall back to browser storage, while the booking reports cloud success. Rules bind `actor_id` to the caller, but not the action to the caller's authority. Replays duplicate entries. The Flutter path batches the state change and Activity entry atomically. That is the only atomic path, and it was not executed here.

## J. Deployment/CI assessment

| Check | Runs in CI? | Blocks deploy? |
|---|---|---|
| TypeScript (`tsc -b`, via build) | Yes | Yes |
| Vite build | Yes | Yes |
| Web/rules/E2E/emulator tests | No | No |
| Flutter test/analyze | No | No |
| Security/isolation tests | No | No |
| Supabase/Edge checks | No | No |

Deployment happens on every push to `main`. The workflow uses Node 20, which conflicts with locked `@supabase/supabase-js` requiring Node ≥22. **Completion-gate update:** read-only hosted-run metadata shows the last 3 deploy runs on `main` (for example run 36808897623) passed `npm ci` and `npm run build` on Node 20. The mismatch therefore does not currently break the hosted build. The missing test gate is confirmed. Deploy-time environment variables do not include Supabase settings. The isolated local build printed `Building for project "hacienda-de-luisana" — from firebaseDefaults.ts`. That confirms a production bundle can pair the live Firebase project with browser-local proof storage (F12).

### Proposed gate (documented, not installed)

```text
No deployment unless:
1. test environment is isolated        → npm run test:safety
2. security regression suite passes    → npm run test:emulator (canonical) + test:rules
3. booking regression suite passes     → npm test, test:e2e, test:phase0 (characterization)
4. build succeeds                      → npm run build:phase0 (Node 22)
5. critical test commands succeed      → test:flutter, test:flutter:analyze
6. no production credentials           → enforced by the launcher; deploy job alone holds secrets
```

It was not installed because:

1. GitHub-hosted Ubuntu 24.04 restricts unprivileged user namespaces through AppArmor, and this has not been verified there.
2. Java and Flutter are not provisioned.
3. `test:invariants` is intentionally red. Gating on it would block every deploy. The gate should include it per finding only as each finding is remediated.
4. Changing `deploy.yml` changes the release process. That needs owner approval in Phase 1.

## K. Environment/secrets assessment (names only; no values printed)

Shell environment: **no** Firebase, Supabase, Google credential, Admin or proxy variables were present. Non-example `.env*` files: **none**. gcloud, Firebase CLI and Supabase tokens: **absent**. Docker socket: **absent**.

| Variable / location | Class | Notes |
|---|---|---|
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_MEASUREMENT_ID` | Public web configuration | Optional. **Accidental production fallback** to committed defaults in production builds. |
| `VITE_FIREBASE_DATABASE_URL` | Public | Optional. Location sharing is disabled without it. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public (anon) | Optional. **Accidental fallback** to browser-local proofs when absent. |
| `VITE_USE_FIREBASE_EMULATORS` | Development switch | Only the exact value `true` uses emulators. |
| `FIREBASE_ENV_STRICT` | Build switch | Fails a build only when there is no Firebase configuration at all. Does not check Supabase. |
| `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **Secrets**, Edge Function only | Production-only. Never used by tests. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | **Secrets**, cleanup script | Destructive and live. Refused by the launcher. |
| `GCLOUD_PROJECT`, `FIREBASE_PROJECT` | Test | Forced to `demo-hacienda`; anything else is refused. |
| `src/lib/firebaseDefaults.ts`, `lib/firebase_options.dart`, `.firebaserc`, `supabase/config.toml` (`project_id`) | Committed public identifiers | Point to real projects. Not secrets, but they are why isolation must be network-level. |

There is no staging Firebase or Supabase project in the repository. Supabase has no local test configuration (`supabase/config.toml` has only the function setting).

## L. Database/schema snapshot (baseline, from rules and adapters)

| Store | Path | Key fields / authority |
|---|---|---|
| Firestore | `profiles/{uid}` | `uid`, `role` (`guest`/`admin`). Self-creation as Guest only. Admin writes roles. Bootstrap email allowlist overrides this. |
| Firestore | `bookings/{id}` | Guest details, `accommodation`, `check_in`/`check_out` (Manila dates), `guests`, `status`, `uid`, `ref_id`, `hold_expires_at`; claims `payment_proof_url`, `amount_claimed`, `payment_reference`, `ocr_*`; terms `stay_total`, `amount_due`, `security_deposit`, `balance_due`, `policy_version`, `policy_effective_date`; verification `payment_status`, `amount_verified`, `payment_verified_by`/`_at`; refund `refund_status`, `refund_total`, `refund_breakdown`. **Unauthenticated create allowed; owner may edit financial terms.** |
| Firestore | `bookings/{id}/activity/{seq}` | `booking_id`, `action`, `from_status`, `to_status`, `actor`, `actor_id`, `at`, `seq`. Append-only. |
| Firestore | `payment_references/{ref}` | `reference`, `amount`, `status` (`available`/`used`/`void`). Admin only. Status is resettable. The mobile screen uses local rows instead. |
| Firestore | `site_config/rates`, `site_config/booking`, `site_config/review_summary` | Published rates/policy, lead time, summary. Public read; Admin write. Rates are overwritten in place; history is not kept. |
| Firestore | `rooms/{id}`, `guest_profiles/{id}` | Accommodation operational status (`accommodationId` + `status`, Admin-writable, status-only) and CRM. Capacity, occupancy and rates are read from `site_config/rates`, not from here. |
| Firestore | `access_logs/{id}` | `timestamp`, `uid`, `ref_id`, `result`, `reason`. Any signed-in user may write under their own UID. |
| Firestore | `conversations/{id}`, `/messages/{id}` | Member-scoped chat; retention stamp field. |
| Firestore | `location_sessions/{convoId}` | Consent metadata plus `stream_secret`; no coordinates. |
| Firestore | `reviews/{bookingId}`, `public_reviews/{id}` | Private review with a 14-day edit window; curated testimonial. |
| RTDB | `live_location/{convo}/{uid}` | 9-field fix, lease ≤90 seconds, UID-path writes. |
| RTDB | `live_location_admins/{uid}` | Reader mirror, writable by allowlisted email. |
| Supabase | `payment-proofs` bucket: `payments/{uid}/{REF}/proof-{n}.{ext}` | Private. **Anonymous insert/update under `payments/`**; no anonymous read. Admin reads through the Edge Function's signed URLs. |
| Firebase Storage | `/payments/{uid}/…` | Legacy proofs. Owner write; owner or allowlisted reader. |
| Browser | `hdl:bookings`, `hdl:activity`, `hdl:payment-proofs`, drafts | Demo/fallback persistence. |

Refunds are not a separate collection; they are fields on bookings. No ledger collection exists.

## 12. Baseline test report (initial Phase 0 run, superseded by *Test Results* below)

All commands were run on 2026-10-01 in **TEST**: a Linux loopback-only namespace using `demo-hacienda`. Records are in `.cache/phase0/results/commands.ndjson` (gitignored).

| Command | Result | Passed | Failed | Skipped | Reason |
|---|---|---|---|---|---|
| `npm run test:safety` | **PASS** | 32 | 0 | 0 | Isolation verified |
| `npm test` (existing web) | **PASS** | 676 | 0 | 0 | 42 files |
| `npm run test:rules` (existing supplemental) | **PASS** | 236 | 0 | 0 | Not canonical |
| `npm run test:e2e` (existing offline) | **PASS** | 44 | 0 | 0 | Offline adapters, not real E2E |
| `npm run test:phase0` (characterization) | **PASS** | 102 | 0 | 0 | Current behavior and defects reproduced |
| `npm run test:invariants` | **FAIL (expected)** | 0 | 31 | 0 | Desired invariants not yet met |
| `npm run check:phase0` (tsc) | **PASS** | — | — | — | — |
| `npm run build:phase0` (tsc + Vite, Node 22) | **PASS** | — | — | — | Bundle built; deleted afterward; not deployed |
| `npm run test:emulator` | **BLOCKED** | — | — | — | No Java. Official emulator artifact download failed (TLS) |
| `npm run test:emulator:invariants` | **BLOCKED** | — | — | — | Same |
| `npm run test:flutter` / `:invariants` / `:analyze` | **BLOCKED** | — | — | — | No Flutter/Dart SDK |
| `npm run test:qa:*` | **BLOCKED** | — | — | — | Playwright not installed (optional) |
| Supabase RLS / Edge Function | **REQUIRES STAGING** | — | — | — | No local Supabase/Deno/Docker; production must not be used |
| Hosted CI | **NOT TESTED** | — | — | — | Workflow not modified or run |
| Hardware smart lock | **NOT TESTED** | — | — | — | No hardware in repository |

The emulator and Flutter test files are written and typechecked where applicable, but have **never executed**. Their expected outcomes are hypotheses until they run.

## M. Phase 1 readiness

**Safe now** (verifiable with the current harness):

- Client-side truthfulness work for F13/F14 (web): characterization and invariant tests exist.
- Pure-model checks whose policy is clear: F11 night-by-night occupancy and F24 status copy.
- The F21 field-name/lease mismatch, verified at the web-transport level only.

**Still blocked:**

1. **Canonical emulator execution.** F01–F04, F15, F18, F20 and F22 rule changes must not ship on supplemental-evaluator evidence alone. This needs Java 21 plus the pinned emulator JARs: `npm run prepare:phase0:emulators`, then `npm run test:emulator`. Re-baseline the canonical characterization before changing any rule.
2. **Flutter SDK.** Admin-side lifecycle, parser and concurrency changes (F06, F09, F14, F28) cannot be verified.
3. **Supabase staging/local stack.** Needed before any F05/F12 proof-storage change.
4. **Owner decisions:** listed under *Remaining Blockers* below.

*(This section describes the initial run. The completion-gate sections below supersede it.)*

---

# Phase 0 Completion Gate (canonical verification), 2026-10-01

This phase was **verification only**. No remediation was done, and none of the following were modified:

- Firestore rules, booking authorization, payment authority or status;
- approval, inventory or refund behaviour;
- Admin enrollment, guest recovery, live location, smart lock, notifications or reporting.

Changes were confined to Phase 0 tooling, tests and docs:

- **New files:**
  - `scripts/phase0/toolchain.mjs`: pinned Java and emulator-checksum verification;
  - `scripts/phase0/prepare-java.mjs`;
  - `test/phase0/emulator/identity.auth-emulator.test.ts`;
  - `test/phase0/supabase/*`.
- **Edited tooling:** `prepare-emulators.mjs`, `inside.mjs`, `run.mjs`, `boundary.mjs`, `vitest.emulator.config.ts`, and test-only npm scripts.
- **Safety tests:** 12 added.

The `SCOPE` hash test, which compares 210 production files with the baseline commit, still passes.

## Environment

| Tool | Exact version | Source / state |
|---|---|---|
| Node | **v22.22.3** | Sandbox |
| npm | **10.9.8** | Sandbox |
| Java | **OpenJDK 21.0.8 2025-07-15 LTS, Eclipse Temurin-21.0.8+9** | PyPI wheel `jdk4py==21.0.8.2`, SHA-256 pinned (`85addfcb…0356`), in `.cache/phase0/java`, installed via `npm run prepare:phase0:java` |
| Firebase CLI | **firebase-tools 15.31.0** | Locked in `package-lock.json` |
| Emulator Suite: Auth | Bundled with firebase-tools **15.31.0** | **Available, ran** |
| Emulator Suite: Firestore | **1.22.0** (`cloud-firestore-emulator-v1.22.0.jar`, SHA-256 `9b6498b7…166c`) | **NOT INSTALLED**: `storage.googleapis.com` unreachable |
| Emulator Suite: RTDB | **4.11.2** (`firebase-database-emulator-v4.11.2.jar`, SHA-256 `b70d9934…b97f`) | **NOT INSTALLED** (same) |
| Emulator Suite: Storage rules runtime | **1.1.3** (`cloud-storage-rules-runtime-v1.1.3.jar`, SHA-256 `0cd52db6…c900`) | **NOT INSTALLED** (same) |
| Flutter | Required **3.44.4 stable** (`.metadata` revision `ad70ec46…`; `pubspec.lock` `flutter >=3.44.0`) | **NOT INSTALLED**: `storage.googleapis.com` and `pub.dev` unreachable |
| Dart | Required **>=3.12.0 <4.0.0** (bundled with Flutter) | **NOT INSTALLED** |
| Supplemental Postgres | PGlite **0.3.15** = PostgreSQL **17.5** (WASM) | `.cache/phase0/tools`, via `npm run prepare:phase0:supabase-rls`. Not a repository dependency, and not Supabase. |
| Python | 3.11 | Sandbox (used only for the namespace helper and the Java wheel) |

Reachable hosts and the substitutes deliberately rejected are listed in `CANONICAL_VERIFICATION.md` §1.

## Test Results

Complete re-run, 2026-10-01. Every command was run individually inside the TEST namespace.

| Test | Result | Evidence |
|---|---|---|
| `npm run test:safety` | **PASS** (44/44) | Isolation boundary verified **before** the integration runs. Covers non-demo projects, credentials, Supabase settings and proxies (both cases), plus checksum and Java pinning |
| `npm test` | **PASS** (676/676, 42 files) | Existing web suite |
| `npm run test:rules` | **PASS** (236/236) | Supplemental in-repository evaluator; **not canonical** |
| `npm run test:e2e` | **PASS** (44/44) | Offline adapters; not real E2E |
| `npm run test:phase0` | **PASS** (102/102, 8 files) | Characterization of current behaviour, including the `SCOPE` hash |
| `npm run test:invariants` | **FAIL, as intended** (0/31) | The same 31 desired invariants. They are unmet, not regressions |
| `npm run test:emulator` | **BLOCKED** (exit 78) | Java 21.0.8 resolved. `pinned emulator artefacts not verified (firestore v1.22.0 missing, database v4.11.2 missing, storage v1.1.3 missing)` |
| `npm run test:emulator:invariants` | **BLOCKED** (exit 78) | Same |
| `npm run test:emulator:auth` *(new)* | **PASS** (6/6) | Real Auth Emulator in `demo-hacienda`. Canonical evidence for F16, plus the F04 precondition |
| `npm run test:supabase:rls` *(new, supplemental)* | **PASS** (11/11) | `supabase/01-storage.sql` applied verbatim to PostgreSQL 17.5. Policy layer only; **not** Supabase staging |
| `npm run test:flutter` | **BLOCKED** (exit 78) | `Flutter/Dart SDK missing` |
| `npm run test:flutter:invariants` | **BLOCKED** (exit 78) | Same |
| `npm run test:flutter:analyze` | **BLOCKED** (exit 78) | Same |
| `npm run check:phase0` | **PASS** | `tsc -b` + Phase 0 tsconfig |
| `npm run build:phase0` | **PASS** | Vite build on Node 22. `dist/` deleted afterwards; not deployed |
| `npm run test:qa:booking` / `:site` / `:tutorial` | **BLOCKED** (exit 78) | Playwright and its browsers are absent; the Playwright CDNs are unreachable |
| `npm run prepare:phase0:emulators` (preparation) | **BLOCKED** (exit 78) | `Failed to make request to https://storage.googleapis.com/…` for all 3 JARs |
| Supabase staging: RLS through the Storage API, signed URLs, Edge Function | **BLOCKED** | No Docker, `supabase.com` unreachable, no Deno/JSR. Production must not be used |
| Hosted CI | **NOT RUN** | Read-only metadata only (F31) |

Logs:

- per-command records: `.cache/phase0/results/commands.ndjson` and `history/`;
- full console output of this re-run: `.cache/phase0/rerun/*.log`.

All of these are gitignored.

**Harness issue found and fixed** (Phase 0 tooling only): `firebase emulators:exec` injects a demo-derived `FIREBASE_CONFIG`, and the boundary refused it. Every emulator suite would have failed closed before evaluating a rule. Only that exact value is now accepted, and this is covered by safety tests. Details are in `CANONICAL_VERIFICATION.md` §2.

## Canonical Finding Status

Full reconciliation is in `docs/phase0/CANONICAL_VERIFICATION.md` §6.

| Finding | Status | Evidence |
|---|---|---|
| F01, F02, F03 | BLOCKED | Firestore emulator not run (JAR unavailable). Supplemental and model results only |
| F04 | BLOCKED | The Auth emulator shows a self-registered token carries a registrant-chosen `email` with `email_verified=false` (precondition only). Rules evaluation blocked |
| F05 | **PARTIALLY CONFIRMED** | Real Postgres RLS on the verbatim SQL. anon may write any `payments/{uid}/…`, including another UID's path; no read; no booking binding. The Supabase Storage API and live project are unverified |
| F06–F11 | BLOCKED | Firestore transactions and/or Flutter not run. F08 and F10 also need owner decisions |
| F12 | BLOCKED | Needs the Firestore emulator plus Supabase staging. Not contradicted |
| F13, F14, F15 | BLOCKED | Firestore (and, for F14, Flutter) not run |
| F16 | **PARTIALLY CONFIRMED** | Auth emulator, using the same SDK calls as `authFirebase.ts`: register and login from an anonymous session both give a new UID and orphan the anonymous one. Firestore impact blocked |
| F17 | BLOCKED | Core duplicate-booking claim needs Firestore. The storage layer accepts each retry as a new object, which is consistent |
| F18, F20–F24 | BLOCKED | Firestore/RTDB emulator not run |
| F19, F33 | BLOCKED | Genuinely cannot run: no firmware/gateway or delivery consumer exists in the repository |
| F26, F27, F30, F32 | BLOCKED | Deployed or runtime state (indexes, purge, load, release device) |
| F28 | BLOCKED | Flutter not run |
| F29 | RESOLVED 2026-10-06 | Owner decided: a `rooms` document is a status register keyed to a canonical Accommodation id. |
| F25 | RESOLVED 2026-10-06 | `allow read` on `reviews/{bookingId}` now answers the pre-read `submitReview` makes when no Review exists yet, for the owner of the Booking the id names. Offline and emulator coverage written; `firebase deploy --only firestore:rules` still required. |
| F31 | **PARTIALLY CONFIRMED** | Hosted run metadata: Node 20 deploys succeed and run no tests. Gate gap confirmed; **build-break impact NOT reproduced (contradiction recorded)** |

**Totals:** CONFIRMED 0 · PARTIALLY CONFIRMED 3 · NOT REPRODUCED 0 · TEST HARNESS ISSUE 0 · BLOCKED 30.

## Mobile coverage (static; nothing executed)

| Area | Coverage |
|---|---|
| Booking state display | PARTIAL (lifecycle logic; no screen test) |
| Admin handover | PARTIAL (role checks; no F15 Dart test) |
| Mock/demo fallback | NOT COVERED |
| Financial reporting | PARTIAL |
| Identity/recovery | NOT COVERED |
| Release configuration | NOT COVERED |

Details are in `CANONICAL_VERIFICATION.md` §5. The gaps are recorded, not filled with code that cannot be compiled here.

## Remaining Blockers

### Tooling blockers (technical)

1. **Firebase emulator JARs** (firestore 1.22.0, database 4.11.2, storage 1.1.3). They are served only from `storage.googleapis.com`, which is unreachable from this sandbox.
   - **Unblock path A:** run `npm run prepare:phase0:emulators` on a machine with Google Cloud Storage access, or copy the 3 JARs into `.cache/phase0/emulators/`. They are accepted only if the pinned SHA-256 matches.
   - **Unblock path B (owner action):** run the same fixed commands on a GitHub-hosted runner, via a workflow added on a non-`main` branch, without referencing any secrets. This was not done here: it needs a commit, a push and the `workflows` permission, which the sandbox token does not report.
2. **Flutter 3.44.4 / Dart ≥3.12.** The SDK, engine artefacts and `pub.dev` are unreachable. It needs a machine with access, then `flutter pub get` **outside** TEST, then `npm run test:flutter*`.
3. **Playwright browsers** for the optional QA suite. The CDNs are unreachable.

### Staging blockers (technical, environment provisioning)

4. **Isolated Supabase project or local stack** with synthetic data only. This needs Docker or a new non-production project. Neither is available, and the production project must not be used.
5. **Edge Function** (`admin-payment-proof`). It needs Deno plus a **staging** Firebase project and service account. Phase 0 refuses all real credentials by design, so this needs a separately approved staging boundary.
6. **Runtime/deployed state:**
   - production Auth sign-up settings (F04);
   - Firestore composite indexes (F26);
   - data purge (F27);
   - load (F30);
   - signed release on a device (F32).

### Business-policy blockers (owner decisions; not invented here)

No approved requirement for any of these was found in the repository. They remain **unresolved**:

1. A paid booking that is rejected or expires: refund, credit or alternate date?
2. Hold duration, and what happens at expiry.
3. When a manual quote becomes binding.
4. Downpayment vs full-payment requirements.
5. Deposit rules.
6. Refund rules.
7. ~~Room-to-bookable-unit mapping.~~ Resolved: `rooms/{id}` carries `accommodationId` (one of `main-house`, `annex`, `house-a-camping`) and `status` only; the rules refuse any other field.
8. Guest recovery authority: who may re-attach a booking to a new identity.
9. Deployment gating policy: whether deploys must wait for tests.

## Phase 0 Final Status

**`PARTIAL`**

Phase 0 cannot be `COMPLETE`. The required canonical Firebase rules verification (Firestore/RTDB/Storage emulators) and Flutter verification have **not run**. The reason, unreachable artefact hosts in this sandbox, is a property of *this* sandbox, not a genuine impossibility in an approved environment. Both can run unchanged on a machine with Google artefact access.

## Phase 1 Authorization

**`NOT READY FOR PHASE 1`**

Implementation is not authorized. The Phase 1 candidates F01, F02, F03, F04, F13 and F15 are rules-level changes whose current behaviour has been observed only by the supplemental evaluator. The canonical Firestore emulator baseline (`npm run test:emulator` and `npm run test:emulator:invariants`) must run and be reconciled first. Owner decisions 1–9 also remain open.
