# Issue & Dispute Management — implementation and release verification

## Status and authorization

Design: confirmed Q1–Q23, including A–D. Implementation: authorized on the Arena
working branch. **Deployment, migration and production-data changes: NOT authorized.**
No cloud resources or production records were changed while implementing this.
This document is not deployment approval or a claim of production readiness.

## Components

| Component | Implementation |
|---|---|
| Pure policy/state machine | `functions/src/domain.ts` |
| Retention/cleanup guards and Manila calendar anniversaries | `functions/src/privacy.ts` |
| Authenticated commands / transactions / inbox / maintenance | `functions/src/index.ts` |
| Image/PDF validation and scanner transport | `functions/src/evidence.ts` |
| Guest API | `src/lib/disputes.ts` |
| Booking entry, case form, messages, evidence, outcomes | `src/components/DisputeForm.tsx` |
| General support, account linking, persistent inbox | `src/pages/SupportPage.tsx` (`/support`) |
| Admin queue, case detail, actions and inbox | `lib/views/disputes/disputes_screen.dart` |
| Admin REST callable client | `lib/services/dispute_service.dart` |
| Android per-file selection / export | `MainActivity.java`, Storage Access Framework |
| Firestore/Storage boundaries | `firestore.rules`, `storage.rules` |

The native evidence picker/exporter is Android-specific, matching the current
Admin app target. iOS file selection/export needs a native implementation before
claiming iOS evidence support. No new Flutter packages were introduced.

## Data and trust boundaries

- `cases/{id}`: reference, participant, Booking/Accommodation link, description,
  category, priority, assignment, independent-review flags, formal/simple path,
  status, deadlines, outstanding remedy, version and timestamps. Internal parents
  have `visibility: internal` and `guest_id: null`.
- `cases/{id}/activity/{operationHash}`: append-only client-visible action,
  real authenticated actor, version/status, text and attachment IDs. Clients
  cannot write, edit or delete it. Retention is the deliberate server exception.
- `cases/{id}/evidence/{uploadId}`: safe display metadata and restriction flag;
  no object path, signed URL, Firebase download token, or file bytes.
- `casePrivate/{id}`: substantive participants, hold metadata, exceptional
  reopening request, operational source/related-case links, cleanup lock.
- `casePrivate/{id}/notes`: private notes and administrative reasons. Restricted
  access to bytes is recorded here. Do not put sensitive evidence contents in notes.
- `caseUploads`: server-only owner/session/validation/attachment manifest.
- `caseEvidence/{caseId}/{uploadId}/chunks/{n}` and `/validated`: private Storage
  bytes. Raw SDK reads/writes are denied even to Admin clients. Download uses a
  currently authorized callable and returns bytes, not a bearer download URL.
- `caseOperations`: UID-scoped operation fingerprint and result. No request body.
- `caseNotifications`: persistent privacy-safe per-user/shared Admin inbox.
- `casePolicy/current`: server-managed day targets and `retentionApproved` flag.
- `caseRateLimits`: server-enforced daily limits (10 creations, 300 case actions).
- `caseCounters/{year}`: transactionally allocated `HDL-YYYY-NNNNNN` reference.

Auth uses the current Firebase Auth account and stored Profile. Bootstrap Admin
emails additionally require verified email; unverified registrations cannot
inherit case privileges. Anonymous sessions are refused. Existing Booking role
and payment rules are not modified.

Account linking is Firebase `linkWithCredential` / `linkWithPopup` on the original
anonymous identity, preserving UID. Already-used credentials or lost anonymous
sessions require official, verified recovery; **there is no email/reference-based
transfer shortcut**. Manual cross-account recovery is deliberately not automated.

## Callable contracts

Region: `asia-southeast1`; runtime Node 22. All callable inputs are untrusted.
Actor UID/role, timestamps, reference and authoritative patches come from the server.

`disputeCommand`:

```
{ action, operationId, caseId?, expectedVersion?, ...actionFields }
-> { caseId, reference, version }
```

Creation: `category`, `description` (10–4000 characters), optional `bookingId`.
Admins default to internal reports; `internal: false` requires a recoverable
Booking owner. `sourceCase` deliberately shares a new summary without copying
private report content. A Guest's Booking must have exactly the caller's UID.

Commands: create; assign; priority; review; message; note; request_info;
extend_deadline; await_staff; propose; accept; contest; escalate; resolve;
final_decision; enforce_remedy; complete_remedy; withdraw_request; close; reopen;
request_reopen; approve_reopen; deny_reopen; duplicate; link; hold;
evidence_request; evidence_decision.

Decision actions require the assigned investigator/reviewer. The complainant
cannot decide their own case. Independent assignment checks the accumulated
substantive participants. Review authority survives information gathering.
Private links may cross participants; consolidation cannot.

Financial completion requires `executionRef`: an existing authorized
`booking-activity:<id>` whose Booking shows the completed financial action,
`external:<documented execution reference>` (manual Admin attestation, not bank
verification), or `no-remedy:<reasoned basis>` where no outstanding remedy is due.
These references are private; never put payment credentials in them.
A restricted-evidence decision additionally requires a guest-visible privacy-safe
`summary`. Failure to produce a safe summary must go to independent review.

A stale version returns `aborted`; refresh and reconsider. The same UID/operation
and same payload return the recorded result without duplicate audit/notifications.
Reusing an operation for different data is refused. Activity and the case patch
are atomic. No case handler writes to a Booking or executes money.

`disputeEvidence`: begin (case/version, operation, name/type/size), immutable
192-KiB base64 chunks, finalize (decode/validate/scan), authenticated download.
Limit 10 MiB/file, five attachments/message, 50 reserved/submitted files/case.
Expired unattached slots are released. Submitted files are not overwritten.
JPEG/PNG/WebP are re-encoded to WebP and EXIF discarded. PDF: 1–100 pages, no
active content/forms/embedded files/external links, and a clean ClamAV result.
Inspection traverses direct nested arrays/dictionaries and stream dictionaries,
not just indirect object roots. Evidence callables use concurrency 1 to bound
per-instance image/PDF memory pressure; load/cost verification remains required.
No scanner => no accepted PDF. An authorized withdrawal restricts access
immediately; privacy-designated Admin reviews release/deletion, honoring holds.
Downloaded copies cannot be recalled. File content is not automatically classified
as a government ID; upload warnings, restriction and privacy review remain needed.

`disputeInbox`: list/read, server-scoped recipients, 50-item pages with opaque
notification ID cursor. Shared Admin notifications have individual read state.
In-app only: email, SMS and background push are not promised. Reading does not
accept a proposal. Notifications are created with the transaction, so they cannot
be lost in an after-commit client callback.

`disputeDirectory`: active Admin UID/display labels, Admin-only.

## Lifecycle

| From | Normal next states |
|---|---|
| Submitted | Under Review |
| Under Review | Awaiting Guest Response, Awaiting Staff Action, Resolution Proposed, Escalated, eligible simple Resolved |
| Awaiting Guest Response | Under Review on response or deliberate reassessment |
| Awaiting Staff Action | Under Review, Escalated, fulfilled resolution/determination |
| Resolution Proposed | accepted Resolved, accepted unfinished Awaiting Staff Action, contested Escalated |
| Escalated | remains pending; eligible assigned reviewer starts Under Review |
| Resolved | Closed, ordinary/approved exceptional Reopened, enforcement of existing remedy |
| Closed | ordinary/approved exceptional Reopened, enforcement of existing remedy |
| Reopened | Under Review |

Closure exceptions: reasoned overdue non-financial abandonment, recorded
non-financial requested withdrawal, or same-participant duplicate consolidation.
Financial silence/withdrawal never substitutes for a reasoned determination.
Final independent decisions allow exceptional requests only. Prior investigator
and reviewer participation is never erased by reassignment. No eligible reviewer
means pending, not a fallback to self-review.

First response is substantive communication, not an assignment/view/review tap.
Messages do not extend a response deadline; explicit recorded extensions do.
The hourly worker emits idempotent reminders/overdue notices without resolving,
rejecting or consenting on anyone's behalf. Thus notices may lag by up to one
schedule interval; the case always displays its actual server deadline.

## Retention and maintenance

Temporary unattached uploads expire after 24 hours; the hourly worker removes
bytes, marks expiry and releases slots, unless a hold or another cleanup lock
blocks removal. An existing case missing its private policy is quarantined rather
than treated as unheld. A per-file lock spans authorization and byte removal;
retrying failed expiry does not release the same attachment slot twice. A failed
client upload is never displayed as submitted. Upload/expiry/attachment checks are transactionally separated;
finalization cleans a lost-expiry race rather than resurrecting the attachment.

Automatic retention requires BOTH `DISPUTE_RETENTION_ENABLED=true` AND
`casePolicy/current.retentionApproved=true`, after separate approval.
Anniversaries use Asia/Manila calendar months, clamping leap/month-end dates.
At 12 calendar months after closure: remove correspondence, evidence, private
notes, description and full rationale; keep minimal outcome/action signatures.
At 24 calendar months: remove the minimal record and case notifications.
Holds and outstanding exceptional requests block deletion. Reopening resets the
content purge state/deadline so newly supplied evidence is not overlooked.
Cleanup locks prevent concurrent reopening/hold changes during deletion; leases
permit retry after a failed maintenance run. Physical deletion is idempotent.

**Release verification must include failure injection into maintenance**, bucket
versioning/soft-delete/backups and held data. Application deletion is not a claim
that cloud backups/versioned bytes are erased. Align infrastructure policy with
legal-approved retention before enabling deletion. Large-history/catch-up load
must also be measured before enabling the worker on legacy data.

## Configuration, cost and deployment gates (NOT executed)

`functions/.env.example` documents disabled defaults. Never commit `.env` files.
`DISPUTES_ENABLED=false` is the production default. Automatic retention has a
separate default-off switch. Designate privacy handlers by active Admin UID via
`DISPUTE_PRIVACY_ADMINS`, not a client-editable Profile field.

Private evidence uses an optional `DISPUTE_EVIDENCE_BUCKET`. Runtime checks require
uniform bucket-level access and refuse public IAM grants. Review project-level
inherited IAM, public-access prevention and service-account least privilege too.
No Firebase download tokens are created. Service account needs its documented
Firestore/Auth/Storage and bucket-policy inspection permissions. Confirm an
existing Firebase project can actually support Firebase Storage; existing payment
proofs are Supabase-backed and must remain unchanged.

PDF scanning requires a separately approved private-network ClamAV service,
current signatures, scan-size limits, VPC access and service monitoring. Do not
expose unauthenticated ClamAV to the internet. Scanner unavailability fails closed.
Images do not need that service because they are decoded/re-encoded.

Cost review: Functions/Cloud Build/Artifact Registry, Scheduler, Firestore
transactions/streams/indexes, Storage operations/bytes/egress, Auth lookups,
private networking/scanner runtime and log retention. Up to 50 x 10 MiB of evidence
per case can materially affect costs; cap/alert budgets and load-test chunk costs.
Functions max instances 5, 512 MiB, timeout 120s; no universal peso estimate is
claimed without project billing and expected-volume data.

Approval order:
1. Review code/spec, privacy/legal policy, operational independent-review coverage.
2. Approve a non-production project/billing plan and least-privilege infrastructure.
3. Compile/test Functions, build web and Flutter; canonical emulator/handler smoke,
   Android device evidence, scanner, retention, concurrency/failure injection.
4. Review and approve a sanitized legacy migration dry run and backups.
5. Approve deploy order: compatible Functions/indexes/security boundaries and
   split legacy data before enabling Guest reads; compatible Admin and Guest apps.
6. Explicit production deployment/migration approval, staged enablement and budget
   alerts. Monitor failures, unassigned/escalated age, deadline lag and cleanup.
7. Roll back UI/function enablement if needed; never restore insecure legacy reads.

## Legacy migration plan (no production execution)

- Export/back up in an approved environment; inventory ownership and evidence.
- Keep original IDs. Add unique references and a real migration event, not invented
  historical events. Record missing timestamps as review blockers, not guessed facts.
- `open` -> Submitted; `under_review` -> Under Review. Preserve legacy resolved /
  rejected outcomes as historical decisions, never fabricated consent or appeal.
- Move `internal_notes` into private notes, never copy them into public Activity.
- Verify the Guest against the linked Booking and recoverable Auth identity.
  Quarantine mismatches rather than attach another person's Booking.
- Quarantine legacy evidence URLs until ownership/privacy are verified; do not
  re-publish arbitrary public/signed links into the new evidence system.
- Reconcile counts/hashes, validate permissions as both Guests and Admins, inspect
  a sample manually, then separately approve application of the migration.
- Legacy writes/Guest reads remain frozen until approved migration. An old mobile
  release may fail its old dispute-write path; coordinate the update, do not relax
  rules to keep an obsolete client writing insecure documents.

## Verification evidence for this checkout

**2026-10-15: implemented locally, NOT release-ready.** Detailed evidence,
limitations and next checks: [VERIFICATION.md](VERIFICATION.md). Frozen,
non-production rule comparison: [verification/rules-comparison.json](verification/rules-comparison.json).

| Check | Actual result |
|---|---|
| `npm run lint` | PASS (TypeScript) |
| `npm test` | **932 PASS**, including six dispute UI tests |
| `npm run build` | PASS; existing large-chunk warnings |
| `npm --prefix functions test` | **195 PASS**; includes 21 mocked handler/maintenance tests, not emulator integration |
| `npm run test:safety` | **44 PASS** |
| `npm run test:rules` | **272 PASS / 51 FAIL / 323 total** (supplemental) |
| `npm run test:rules:baseline` | **263 PASS / 51 FAIL / 314 total** against pinned original rules |
| `npm run check:rules:baseline` | PASS: all 314 original assertion statuses identical, seven fixture/evaluator files hash-identical, all nine new dispute assertions pass |
| `npm run build:phase0` | FAIL: three pre-existing fixture type errors, not waived |
| `npm run test:emulator` | BLOCKED: pinned emulator JARs missing; **Java 21 is now installed and checksum-verified** |
| `npm run test:flutter:analyze` | BLOCKED: Flutter/Dart SDK missing |
| Three changed Dart files, tree-sitter parse | No syntax error nodes; **not** Flutter analysis or native compilation |
| Billing/IAM, deployed scanner, live scheduling, migration, production | NOT PERFORMED |

Of the 51 unchanged supplemental failures, **32 report unsupported evaluator
`.toSet()` on a set; 19 are assertion mismatches with unresolved cause**. These
19 are not labelled evaluator bugs. Status equivalence does not establish real
Firebase semantics or prove the absence of a security regression.

The existing canonical case boundary tests are supplied in
`test/emulator/disputes.rules.test.ts`; they remain **UNRUN**. Downloads are
blocked because official emulator/Flutter artifacts use `storage.googleapis.com`
and Flutter dependencies use `pub.dev`, neither allowed in this sandbox.
Do not substitute an untrusted mirror, weaken checksums/isolation, or test in production.

Commands (local checks, not deployment):

```sh
npm ci --ignore-scripts
npm --prefix functions ci
npm --prefix functions test
npm run lint
npm test
npm run test:safety
npm run build
# Both supplemental suites currently exit nonzero with the same 51 failures:
npm run test:rules
npm run test:rules:baseline
npm run check:rules:baseline
npm run build:phase0
# Preparation uses approved official sources only; see VERIFICATION.md.
PIP_INDEX_URL=https://pypi.org/simple npm run prepare:phase0:java
npm run test:emulator
npm run test:flutter:analyze
```

The repository's standard runners isolate demo tests in a loopback-only network
namespace. Keep those safety boundaries. Backend tests use a mock Admin SDK;
scanner protocol fixtures bind loopback and are not a live antivirus deployment.
Emulator integration must use `demo-hacienda` only; do not run test suites against
the committed live project.

## Explicit unfinished acceptance/release gates

- **Restricted evidence:** a summary is enforced at proposal/decision time when
  restricted evidence exists, but a separately recorded opportunity to respond
  before an adverse decision is **not yet enforced**. Requirement D is incomplete;
  do not enable adverse reliance until this protocol and both UIs are completed/tested.
- **Retention:** pure guards and selected mocked failure/retry paths pass. Full
  12/24-month worker behavior, crash/orphan recovery (including uploads, operation
  receipts and notifications), concurrency and legal-hold coverage need real
  emulator/failure-injection verification and any resulting fixes before enablement.
  Hold-review reminders are not complete. Retention remains default-off and unapproved.
- **Independent review:** authorization has local test coverage; actual queues,
  no-eligible-reviewer operations and Android workflows still need integration/device proof.
- **Security/native/toolchain:** canonical Auth/Firestore/Storage/Functions integration,
  the 51 supplemental failures and Flutter/Android gates remain unresolved.
- **Infrastructure/policy:** approved scanning service, billing/budgets, inherited IAM,
  public-access prevention, backups/soft-delete alignment, legal retention approval,
  operational ownership and legacy migration approval remain mandatory.

No deployment, migration, cloud configuration change or production-data mutation
was performed or is authorized by this handoff.
