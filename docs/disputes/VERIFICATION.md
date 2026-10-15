# Local verification — 2026-10-15

**Working branch only. NOT RELEASE-READY. No deployment, migration, production
configuration change or production-data mutation was performed.** Passing local
checks do not authorize any of those operations.

## 1. Toolchain and sandbox boundary

- Pinned Java **21.0.8 / jdk4py 21.0.8.2** was prepared from PyPI with the existing
  checksum-verifying script. `test:emulator` now finds it successfully. The local
  cache is generated, not tracked; repeat preparation if it is absent. This is
  an emulator runtime, not proof of an Android JDK/SDK build toolchain.
- The emulator runner stops **before startup**, exit 78 / BLOCKED: Firestore
  1.22.0, Database 4.11.2 and Storage 1.1.3 JARs are missing. Official URLs/pinned
  SHA-256 values are in the locked Firebase CLI metadata and
  `scripts/phase0/toolchain.mjs`; the official host is `storage.googleapis.com`.
- Flutter/Dart are absent. `test:flutter:analyze` stops with BLOCKED, not PASS.
  Official SDK artifacts require `storage.googleapis.com`; packages require
  `pub.dev`. Both are outside this sandbox's allowed outbound hosts.
- No unofficial mirrors, checksum exceptions, live Firebase fallback, external
  test endpoints or network-isolation bypass were used. No cloud credentials or
  setup were requested. Existing demo-project and Linux network-namespace guards
  remain intact; **44 safety tests pass**.
- A preliminary tree-sitter parse found no syntax error/missing nodes in the
  three changed Dart files (tree-sitter 0.25.2, tree-sitter-dart 0.1.0 from PyPI).
  This does **not** resolve imports, check Flutter/plugin APIs, perform Dart
  analysis, compile Java/Android or prove native behavior. It is not an SDK substitute.

### To unblock on an approved development machine

1. Prepare the locked npm/Functions dependencies outside test execution.
2. Run `PIP_INDEX_URL=https://pypi.org/simple npm run prepare:phase0:java` if needed.
3. With official artifact access, run `npm run prepare:phase0:emulators` outside
   TEST. For offline transfer, copy only official artifacts into the fixed cache
   paths documented by the toolchain. **The runner must verify the pinned hashes.**
4. Install an appropriate official Flutter SDK and resolve the committed
   `pubspec.lock` outside TEST (`flutter pub get --enforce-lockfile`). Never resolve
   new packages during isolated tests or silently change dependency versions.
5. Use the standard isolated `npm run test:emulator`, `npm run test:flutter:analyze`,
   `npm run test:flutter` and `npm run test:flutter:invariants` commands. Record
   failures truthfully and fix them; missing-tool output is not a passing test.
6. Separately authorize any nonproduction infrastructure/scanner/device work.
   Production access, deployment and migration are **not** part of this procedure.

## 2. Supplemental rules baseline investigation

Pinned original commit: `e5155dec0e2255c3f6b29dbec7b1f5e063f1d878`.

| Run | Passed | Failed | Total |
|---|---:|---:|---:|
| Current working rules | 272 | 51 | 323 |
| Original pinned rules, same existing assertions | 263 | 51 | 314 |
| Added dispute boundaries | 9 | 0 | 9 |

All **314 existing assertion statuses match**. Seven relevant files, including
all five original test files plus evaluator/context, are SHA-256 identical to the
pinned commit. The new baseline runner reads rules through `git show` in an
isolated setup; it **never overwrites the working rules** or fetches GitHub data.

The comparator rejects missing/skipped assertions, inconsistent totals, duplicate
names, reports outside the recorded command interval, incorrect demo/isolation
metadata, stale inputs, changed fixtures, changed statuses or failing/missing
new dispute tests. A passing comparison is **equivalence evidence only**, not a
passing rules suite. The frozen [JSON report](verification/rules-comparison.json)
contains hashes, all 51 failure names and classifications, and nine new results.
It does not replace a fresh run after relevant source changes.

### What the 51 failures actually show

- **32:** explicit unsupported evaluator `.toSet()` on a set. The evaluator's
  `keys()` returns a set, while its `toSet` implementation accepts a list only.
  Neither evaluator nor rules were changed to force these tests green.
- **19:** assertion mismatches, **cause unresolved**. By test-name grouping:
  11 published-rate/booking positive-control cases, 5 Admin Security PIN cases,
  1 payment-reference case and 2 access-log cases. Some fail in a positive control
  before reaching the denial named by the test. Do not infer that the named
  negative scenario was actually exercised or that these are evaluator bugs.
- These failures reproduce on the original rules. This does **not** settle their
  real Firebase behavior or prove no security regression. Take representative
  positive/negative controls to the canonical emulator before classifying/fixing.

Reproduce independently (the first two currently return nonzero):

```sh
npm run test:rules
npm run test:rules:baseline
npm run check:rules:baseline
```

Generated fresh reports live under `.cache/phase0/results/`, including command
records. The comparison snapshot in this directory is intentionally small and
contains synthetic test identifiers only, not guest data.

## 3. Security review and fixes made locally

| Area | Verified locally | Still unproven |
|---|---|---|
| Guest isolation | Own/general vs foreign booking checks; foreign case actions/downloads refused before writes/Storage; server-derived role; own/public rule boundaries | Real Auth tokens, Firestore queries, deployed index behavior, full callable HTTP path |
| Private notes/inbox | Notes stay out of Guest case/public text; private notes do not notify Guests; recipient/cursor forgery refused; previews generic | Live client reads, queue/subscription behavior and native rendering |
| Independent reviewers | Prior investigator and private-note author excluded; another eligible assigned Admin can decide; old investigator cannot decide appeal | Real concurrent assignment, unavailable-review operations and device UX |
| Evidence access | Foreign/ordinary restricted reads denied before bytes; current assigned reviewer reads with private audit; withdrawal masks metadata immediately | Real Storage/IAM and withdrawal/download races; downloaded copies cannot be recalled |
| Holds/cleanup | Designated UID, not Profile privacy flags; hold blocks approved deletion; temporary expiry honors hold/missing private policy; failed expiry retries once | Full maintenance/retention failure injection, legal holds across all persisted data, backups |
| Account authority | Anonymous/unauthenticated/disabled/revoked sessions refused in handler mocks; guests cannot grant themselves Admin through request fields | Real Auth lifecycle, verified anonymous linking/recovery and server-token revocation integration |

**Backend: 195/195 PASS**: pure policy/retention tests, 21 handler/selected
maintenance tests with a transactional in-memory Admin adapter, and file-validator
fixtures. The adapter serializes transactions and rejects reads after writes; it
is **not** Firebase's transaction engine, retries, rules, Auth, Storage or scheduler.
Nine supplemental rules tests pass; the supplied canonical case-boundary tests
remain **UNRUN**.

### Corrected issues

1. PDF checking originally inspected indirect dictionary roots only. It now
   recursively inspects direct arrays/dictionaries and stream dictionaries,
   rejects active actions/embedded files, and limits nesting. Adversarial fixtures
   cover inline annotation actions, inline file attachments and embedded streams.
2. Privacy deletion's old lock condition allowed another file to enter while a
   different file owned the lock. The guard now requires either no cleanup lock
   or the **same evidence ID** for retry, with no hold.
3. Temporary upload expiry did not consult holds. It now reads private policy
   transactionally, acquires a per-file lock across byte deletion, quarantines
   an existing case missing private policy, and retries failure without a second
   slot decrement. Holds prevent claiming deletion; normal commands cannot slip
   a new hold/reopen into the middle of already-authorized cleanup.
4. Retention anniversaries now use clamped Asia/Manila calendar months rather
   than overflowing a leap/month-end date; shared pure guards check both public
   and private reopening flags, holds, pending remedies, active leases and privacy
   deletion. This does not prove all worker phases/recovery are complete.
5. Evidence callables explicitly use concurrency 1 to bound per-instance memory
   pressure. Runtime/load/billing limits still need measurement.

### PDF scanner evidence is deliberately limited

Static PDFs still require a configured ClamAV clean verdict. Tests exercised
INSTREAM framing and clean/malware/error/incomplete/malformed acknowledgements
against a **synthetic loopback server**, not a real deployed antivirus/signature
service. Missing/unavailable scanning fails closed. Parser/blacklist inspection
is defense-in-depth, not a universal PDF-safety guarantee or content sanitization.
Before release require an approved private-network scanner, current signatures,
monitoring, size/time limits, real malicious/encrypted/corrupt fixtures and outage
verification. No public scanner or PDF evidence deployment was configured.

## 4. Build/regression evidence and outstanding implementation gaps

- Web regression: **932/932 PASS**, 69 files, including 6 new dispute UI tests.
- `npm run lint`: PASS. `npm run build`: PASS, existing large-chunk warnings.
- `npm run build:phase0`: **FAIL**, unchanged fixture errors:
  - `test/phase0/emulator/auth-review.characterization.test.ts:42`: missing
    registration `termsVersion` / `termsAcceptedAt`.
  - `test/phase0/identity.characterization.test.ts:36`: same missing fields.
  - `test/phase0/location.invariants.test.ts:32`: `number` vs `15 | 30 | 60`.
  These fixture files/production workflows were not changed to manufacture a green gate.
- `git diff --check`: PASS.

**Requirement D is incomplete:** summary text is required when restricted evidence
exists at decision/proposal time, but recorded prior opportunity to respond is
not enforced. Implement the safe-summary/response protocol in backend and both
UIs; test summary changes and independent review. Do not enable adverse reliance
on restricted material until this is resolved.

**Retention remains default-off and legally unapproved.** Selected guard/expiry
retry tests do not prove full 12/24-month deletion. Verify/fix crash recovery and
orphans, including upload manifests, notifications and operation receipts; hold
review reminders; concurrent workers; expired leases; reopen/reclose; failed
bucket/recursive deletes; catch-up pagination; and backups/versioning/soft-delete.
No migration runner/application is being claimed: the legacy section is a plan
requiring sanitized dry run, review and separate authorization.

## 5. Release prerequisites — all require separate evidence/approval

- [ ] Canonical security/real callable tests in `demo-hacienda`; explain the 51
      supplemental failures without weakening security or concealing controls.
- [ ] Flutter analysis/tests, Android compile and SAF picker/export on a device;
      iOS implementation before promising iOS evidence support.
- [ ] Requirement D and complete worker recovery/hold coverage above.
- [ ] Existing financial action-reference compatibility and no mutation of
      booking/payment/cancellation/availability workflows, including failures/retries.
- [ ] Approved nonproduction scanner/network/IAM integration and scanner outages.
- [ ] Bucket inherited/project IAM, uniform access, public-access prevention,
      service-account least privilege and absence of public download tokens.
- [ ] Billing/service availability, approved budgets/alerts and representative
      load/egress/scan/concurrency costs. Runtime bucket checks do not audit IAM.
- [ ] Privacy/legal approval of retention, restriction/deletion/hold procedures,
      prohibited-material handling, backups/soft-delete policy and public notices.
      Existing website legal text is not sign-off on the new retention policy.
- [ ] Named operational owners and enough eligible Admin coverage; no-eligible-
      reviewer queues, official urgent guidance, deadlines and escalation rehearsed.
- [ ] Sanitized migration inventory/backup/dry run and explicit migration approval.
- [ ] Separate explicit production deployment and staged-enablement approval.

No checklist entry is implied complete by the local unit tests or web bundle.
