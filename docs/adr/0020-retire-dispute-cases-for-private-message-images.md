# Retire dispute cases for private message images

**Status:** accepted, 2026-10-24. Supersedes ADR-0017.

## Decision

Remove the active Issue/Dispute case-management system from the Guest website,
Flutter Admin app, Functions, rules, indexes, and case-only dependencies. Guest
questions and supporting images use the existing private Guest–Admin
`conversations` system instead of a new workflow.

Message images are JPEG, PNG, or WebP, at most 5 MiB, stored as create-only
objects at `messageAttachments/{conversationId}/{messageId}`. Message metadata
must name that exact conversation and immutable message. Authorized participants
read bytes through Firebase Auth; no public download-token URL is created.

Do not delete historical `cases`, `casePrivate`, `caseUploads`, other case-only
collections, `caseEvidence` objects, or legacy `disputes` as part of code
retirement. Their client rules fall back to default deny. Inventory, archival,
restoration verification, and deletion require a separate explicitly approved
production-data plan.

Preserve the booking callables and their existing Functions deployment codebase,
even though its historical identifier is `disputes`.

## Consequences

- Case creation, decisions, evidence, notes, notifications, deadlines, and
  retention maintenance no longer have active application code.
- Old dispute clients must be retired with the deployment; they are not given a
  compatibility path that reopens historical data.
- Booking, payment, refund, conversation, authentication, and Admin behavior
  remain outside the deletion scope.
- The Android native picker is retained only for private message images; its
  dispute evidence exporter and PDF support are removed.
- Production document/object counts are not inferred from source. See
  [the inventory and archival plan](../DISPUTE_RETIREMENT.md).
