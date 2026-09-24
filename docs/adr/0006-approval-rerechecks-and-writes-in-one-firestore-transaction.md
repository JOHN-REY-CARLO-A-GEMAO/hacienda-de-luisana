# An approval re-checks availability and writes it in one Firestore transaction

**Status**: accepted (reads "the Admin" where it once said "the Host" — ADR-0007). The transactional Approve described here is the *website's* implementation; since ADR-0007 the Admin approves from the mobile app, whose `applyBookingAction` re-runs the same date re-check against the latest Bookings snapshot before writing. Moving that write into a Firestore transaction on the app side is the open follow-up.

The G2 rule says the *system* re-checks availability when a Booking is approved — never the Admin's eyeball. It did that correctly, but it did it in two steps: read the Bookings collection, decide, then write the patch. Two simultaneous approvals of overlapping dates can both read the world before either writes, both see the dates as free, and both hold the last unit of a one-unit Accommodation. The re-check and the write had to be one step, so an approval now runs in a Firestore transaction.

## The protocol

The browser SDK's `Transaction.get` reads a single document — it refuses a query — so the transaction cannot re-run `findDateConflicts` on its own. The protocol splits the work, and the split is the design:

1. The `runTransaction` callback — which the SDK reruns from the top on every abort — first reads the Bookings collection with an ordinary query. That read is outside the transaction; it only decides whom to verify next.
2. The Booking being approved is read through the transaction, and so is every other Booking that still holds its dates: same Accommodation, overlapping nights, `holdsDates(effectiveStatus(...))`. That set is `approvalCouplingSet` in `src/lib/booking/availability.ts`. None of the rivals' data is used — the reads are what couple concurrent approvals. A rival approval that commits in between makes one of the reads stale, this transaction aborts, the SDK reruns the callback, and the fresh query sees the rival's commit.
3. `applyAction` runs again on the fresh document (a Booking cancelled or hold-expired between the Admin's click and now is refused here, not approved on a stale read), and the patch is written through the same transaction.

`approvalCouplingSet` is deliberately wider than `findDateConflicts(..., { forApproval: true })`. The approval decision only *counts* the committed statuses (ADR-0003), but a rival can change that count through a Booking that is merely queued — Pending — today. Every overlapping date-holder is read, committed or not, so the last unit cannot be claimed twice in either order.

## Considered Options

- **Re-check the query inside the transaction** — the obvious answer, impossible in the browser SDK: `Transaction.get` takes a `DocumentReference` only (`@firebase/firestore` 4.17, verified). A Cloud Function or the Admin SDK could run the query transactionally, but this repository has no `functions/` and both apps are client-only; a new deployable tier is a new failure surface the project has explicitly avoided (ADR-0005).
- **A hold-registry document** — one doc per Accommodation holding a list of the dates in play, written by every lifecycle action, read by every approval. Transactionally sound, but it is a second source of truth for something the Bookings already say, and every writer must now maintain it in its own transaction. The coupling reads buy the same atomicity from the documents that already exist.
- **Pessimistic: lock the dates at submit** — a submitted Booking would block approval of every overlapping Booking until it is resolved. Rejected: ADR-0003 exists precisely because a queue must not make a one-unit Accommodation unapprovable; two Guests may wait for the same unit and the Admin approves whichever they choose.
- **Keep the two steps and accept the race** — the window is small (two Admins, or an Admin and a stale screen, approving overlaps in the same breath), but it is a money-adjacent failure: double-booking is the one thing the whole hold machinery exists to prevent, and the fix costs no new infrastructure.

## Consequences

- An approval's callback does one collection query plus one transactional read per overlapping date-holder. For the size of this property that is at most a handful of documents; the query is the same one `list()` already runs.
- The Activity entry is appended through the regular append-only path *after* the commit, not inside the transaction. The log's sequence is managed with a query of its own, and an entry must not start being written before the approval has actually committed: a logged approval whose write aborted would be a false record, and the log is append-only. The one-entry-per-state-change rule is unchanged — the entry still comes from the action that made the change.
- A refused approval still stores nothing and logs nothing; the transaction simply commits no write.
- The non-transactional path is kept for every other action and for demo mode: only Approve reads the world before it writes, and demo mode has no server to race.
- If Firestore ever grows a client-side query-reading transaction (or the project gains Functions), step 1 can move inside the transaction and the coupling reads go away — the protocol, the ADR and the tests are shaped so that is the only change.
