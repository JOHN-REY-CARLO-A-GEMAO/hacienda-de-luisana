# Dispute retirement and historical-data plan

## Current decision

The active Issue/Dispute case system is retired. Guest support now uses ordinary
private Guest–Admin messages, including image attachments. ADR-0020 supersedes
ADR-0017. Removing application code, handlers, rules, and indexes does **not**
delete historical Firestore documents or Storage objects.

The Firebase Functions codebase is still named `disputes` in `firebase.json`.
That is a retained deployment identifier, not an active dispute feature: the
same codebase deploys `quoteBooking`, `verifyBookingMoney`,
`bookingAvailability`, and `submitBooking`. Renaming it requires a separate
migration and is deliberately not part of this retirement.

## Inventory status in this checkout

The source/data-location inventory found these historical locations:

| Data | Location |
|---|---|
| Cases | `cases/{caseId}` |
| Public activity and evidence metadata | `cases/{caseId}/activity/*`, `cases/{caseId}/evidence/*` |
| Private case state and notes | `casePrivate/{caseId}`, `casePrivate/{caseId}/notes/*` |
| Upload manifests | `caseUploads/{uploadId}` |
| Idempotency receipts | `caseOperations/{id}` |
| Case notifications | `caseNotifications/{id}` |
| Quotas, references, policy, maintenance | `caseRateLimits`, `caseCounters`, `casePolicy`, `caseMaintenance` |
| Legacy disputes | `disputes/{disputeId}` |
| Evidence bytes | Storage prefix `caseEvidence/{caseId}/{uploadId}/...` |

No local production export/backup was present, and this sandbox has no
Firebase/Google credentials or CLI. **Live production counts are therefore not
claimed.** No production data was read, changed, exported, or deleted.

An authorized operator must establish the actual inventory before archival or
deletion. The read-only utility emits aggregate counts, not case content:

```bash
npm --prefix functions run inventory:dispute-data -- \
  --project hacienda-de-luisana \
  --bucket ACTUAL_EVIDENCE_BUCKET
```

Repeat `--bucket` for every bucket that may contain `caseEvidence/`. Use existing
Application Default Credentials; do not place service-account keys or tokens in
chat or Git. The command uses Firestore aggregation counts and Storage metadata
listings. It does not download evidence bytes, write documents, or delete
objects. Review expected read/list costs before running it on a large estate.

## Active-code retirement boundaries

- Guest case forms, histories, notifications, evidence actions, and Booking
  folio insertion are removed. `/support` remains for support and account
  linking; `/messages` carries image attachments.
- Admin case navigation, queue, details, notes, inbox, and evidence UI are
  removed. The Android picker retained for chat now uses only image MIME types
  and the `hacienda/message-attachments` channel.
- `disputeCommand`, `disputeEvidence`, `disputeInbox`, `disputeDirectory`, and
  `disputeMaintenance` have no exports. Booking callables remain exported.
- Case-only rules and indexes are removed. Retired collections and the
  `caseEvidence/` prefix fall through to **default deny**; this protects retained
  data from clients without deleting it.
- `sharp`, `pdf-lib`, case-only environment variables, and dispute tests are
  removed from the active implementation.

## Separate archival and deletion plan — approval required

1. **Authorize and inventory.** Identify the production project, every evidence
   bucket, legal holds, retention obligations, operators, and expected costs.
   Run the read-only inventory and record its aggregate output securely.
2. **Create a restricted archive.** Use an approved archive project/bucket in an
   appropriate region, with uniform bucket-level access, public-access
   prevention, least-privilege IAM, encryption, versioning/retention controls,
   and no public or bearer URLs. Decide the legal retention period before
   copying anything.
3. **Export consistently.** Pause the already-retired writers (the new Functions
   deployment has none), then export all listed Firestore collections and their
   subcollections, including legacy `disputes`. Copy the complete
   `caseEvidence/` prefix with object metadata. Do not omit orphan uploads or
   legacy evidence referenced by old documents.
4. **Verify before deletion.** Re-run counts; reconcile document/object counts,
   bytes, export manifests, and hashes; check a privacy-reviewed sample; perform
   a restore drill; and confirm that private notes, evidence, and legacy
   `internal_notes` remain inaccessible to Guests and the public.
5. **Obtain separate written approval.** Approval must name the project,
   archived collections/buckets, verified manifest, retention date, and exact
   deletion scope. Code removal is not data-deletion approval.
6. **Only then delete.** Use a separately reviewed, narrowly scoped runbook with
   a named operator and rollback window. Verify post-deletion counts and retain
   the archive manifest. This repository intentionally includes no automated
   production deletion command.

## Deployment checklist for active-code removal

1. Release the Guest website and updated Admin app; old dispute clients will no
   longer have a supported backend after the next step.
2. Deploy the existing Functions codebase and confirm removal of only the five
   dispute handlers/scheduler. Confirm all four booking callables remain healthy.
   Check for any orphaned Scheduler job.
3. Deploy Firestore and Storage rules, then the index configuration. Firebase
   may leave now-unused deployed indexes in place; remove only confirmed case
   indexes through a separate operational review. Index removal does not delete
   documents.
4. Remove case-only runtime environment entries after confirming the new
   Functions revision is active. Keep `BOOKING_QUOTES_ENABLED`, quote settings,
   Firebase web configuration, and all booking deployment configuration.
5. Run authorized Booking, payment, messaging, attachment authorization, and
   cross-conversation denial smoke tests. Native Flutter/Android verification is
   still required where the SDK is unavailable locally.
6. Complete the independent archival process above before any historical-data
   deletion.
