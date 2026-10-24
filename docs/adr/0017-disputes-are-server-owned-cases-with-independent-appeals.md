# Disputes are server-owned cases with independent appeals

**Status:** superseded by [ADR-0020](0020-retire-dispute-cases-for-private-message-images.md), 2026-10-24.
This ADR remains as the historical decision record; it no longer describes the
active product. Historical data remains subject to the separate archival plan.

Extends ADR-0007 (Guest website, Admin mobile app) without adding roles. Extends
ADR-0010: Booking money/audit rules remain unchanged; the **separate dispute
state machine** is enforced by trusted callable commands, not client writes.
This does not move or duplicate the Booking lifecycle into Functions.

## Decisions

- General support and every own Booking are eligible, including terminal Bookings.
  Recoverable accounts only; anonymous-to-account linking preserves the original
  Firebase UID. Email or reference matching cannot claim a Booking.
- Two resolution paths: completed simple fixes and formal proposed decisions.
  Silence is never consent. Outstanding remedies remain outstanding.
- One independent appeal as of right. Investigation/notes/decision participation
  permanently disqualifies an Admin from independent review of that case.
  Assignment alone does not. No eligible reviewer means visibly pending.
- Exceptional reopening requires an eligible Admin; remedy enforcement is not a
  second merits appeal. No internal process removes external legal rights.
- Internal reports are private by default. Sharing creates a new deliberately
  authored guest-facing summary; original notes/evidence are not copied.
- Financial and Booking actions are executed only in existing authorized paths.
  Cases record fulfillment references or reasoned no-remedy determinations.
- `cases` and public Activity contain no private notes. `casePrivate` and its
  notes are never queried by Guests. All case writes, including Admin writes,
  are denied to clients and go through Functions.
- Evidence bytes are server-only private Storage objects, not tokenized download
  URLs. Images are decoded/re-encoded. PDF active content is refused and PDFs
  require configured malware scanning, otherwise fail closed.
- 1-day substantive first-response target; 3-day reminder; 7-day requested
  response; 14-day ordinary reopening. Calendar days, Asia/Manila display.
- 12-month correspondence/evidence and 24-month minimal decision/Activity
  retention are proposed defaults pending legal/policy sign-off. Holds and
  reopening requests block automatic deletion. Automatic retention is disabled.

## Consequences

Adds a separately deployable Node 22 Functions codebase and hourly scheduler.
Billing, IAM, private Storage, malware scanning, operational availability and
staging verification are explicit release prerequisites. No deployment has been
performed. Existing Supabase payment-proof storage is unchanged.

Legacy disputes are frozen and Guest reads disabled because old documents may
contain internal notes. An approved migration must split those fields before
restoring historical Guest access through the new schema. UI rollback must never
restore the old data exposure.

See [the retirement, inventory, and archival plan](../DISPUTE_RETIREMENT.md).
