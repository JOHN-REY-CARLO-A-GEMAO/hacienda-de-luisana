# The rule layer checks a Booking's coherence, not its price — and the gap that opens is written down

**Status**: accepted, 2026-10-21. Amends [ADR-0010](./0010-money-and-audit-invariants-in-the-rule-layer.md) by narrowing one of its rows. Records the outcome of the work described in [`docs/HANDOFF-rules-budget.md`](../HANDOFF-rules-budget.md) §7, which left the gap described but not yet decided.

---

## The problem the fix solved

`validAuthoritativeMoney` re-derived a Booking's price inside `firestore.rules`: the
Accommodation lookup, the weekday/weekend classification against the holiday list,
included occupancy and excess pricing, the pet fee, the late-checkout fee, the 50/50
split, and twelve checks on the rate configuration. It was the strongest thing in the
file — a Guest with a browser console could not invent a price, because the rules
computed the real one and compared.

It was also over Firestore's documented **1,000-expression budget for a single
document write**. Firestore does not report that as a policy failure: an evaluation
error arrives as the same bare `permission-denied` a refusal produces. So from the
outside, *every* Guest Booking was refused, on every date, while
`npm run test:rules` reported green — the offline evaluator in `test/rules/engine.ts`
models no budget at all. Nothing in this repository could see the difference between
"the policy said no" and "the policy ran out of room".

The fix, landed 2026-10-14, deleted the descent. `validGuestCreate` now calls
`validBookingMoneyInvariants(data)`, which reads nothing outside the submitted
document.

## What is decided now

| Where | Guarantee | Enforced by |
| --- | --- | --- |
| Booking create | `Pending` only, with a non-empty `payment_proof_url`, `payment_status: pending`, `amount_claimed > 0`, and no verification marker (ADR-0012) | `firestore.rules` |
| Booking create | One 22-hour standard stay: `nights is int && nights == 1` | `firestore.rules` |
| Booking create | A known rate unit and classification: `standard_stay`, and `weekday`/`weekend_holiday` — no invented third schedule | `firestore.rules` |
| Booking create | The published split, to the centavo: `amount_due == int(stay_total * 50) / 100.0`, `balance_due == stay_total - amount_due`, `amount_claimed >= amount_due` | `firestore.rules` |
| Booking create | A floor against nonsense: `stay_total >= 1000`, `rate_amount > 0`, `security_deposit >= 0` | `firestore.rules` |
| Booking create | Counts are counts: `guests` is an integer ≥ 1, `pet_count` and `late_checkout_hours` are integers ≥ 0 when present | `firestore.rules` (added with this ADR) |
| Rates publish | A rate the rules cannot price may not be published at all: the canonical three Accommodations, no retired `nightly_rate`/`reservation_fee_amount`, `down_payment_percent == 50`, both schedules well-shaped, the A-House held to its documented occupancy, and **`holiday_dates` present as a list** | `firestore.rules`, `validRatesDocument` (the holiday clause is new with this ADR) |
| Booking update | A pricing-snapshot key the stored Booking already has cannot be changed or removed (`pricingSnapshotImmutable`) | `firestore.rules` — working again; see *Corrections* below |
| Payment references | The Admin alone writes the catalogue; a spent reference may be `void` but never rewritten, re-`available`, or deleted | `firestore.rules` (the duplicate block that let a signed-in Guest write it is deleted — see *Corrections*) |
| Price authority | The quote a Guest sees is computed once, in `src/lib/booking/rates.ts`, from the published document, and the Client refuses a submit whose figures do not match | the website |
| Money verification | The Admin reads the screenshot against the rate card and the claim before approving | the Admin app, `lib/services/booking_lifecycle.dart`, plus ADR-0015's Security PIN |

## The accepted gap

Between the two halves of the table — arithmetic the Guest's figures must satisfy, and
a price only the published document knows — a Booking can be **internally coherent and
financially wrong**. Stated plainly, so nobody has to discover it:

- `stay_total: 1000` for a stay the card prices at ₱32,000 passes, and so does
  zeroing `security_deposit`.
- A `pet_count` nobody has priced passes, and a fourth guest in a unit documented to
  hold three passes.
- A Guest may write their own `refund_policy_snapshot`; nothing compares it with the
  published policy at create time.
- A Guest may choose `weekend_holiday` for a Monday check-in; the classification is no
  longer re-derived in the rules.

Two arguments were raised for why this does not matter, and neither holds:

- *"Normal Guests use the web UI."* The rules are not there for the UI. They are the
  defence against a direct Firestore write from a browser console, which is exactly
  the case `validAuthoritativeMoney` existed for.
- *"The Admin verifies the GCash screenshot."* A screenshot shows what was **paid**,
  not what was **owed**. A ₱500 receipt matches a ₱500 claim perfectly; the Admin's
  current check compares `amount_claimed` with `amount_due`, and both are numbers the
  Guest wrote.

This is accepted as an **interim** posture, not a permanent one. What closes it is a
re-derivation at the one moment it can still be refused cheaply — the Admin's approve
step — reading `site_config/rates` server-side and refusing the transition when the
Booking's money does not match the published rate for its dates and party. Until that
exists, this ADR is where the gap is stated, and the tripwire is a test:

- `test/rules/firestore-rules.test.ts`, *`GAP (recorded, 2026-10-14): a coherent
  figure the published rate would not produce passes the rule layer`* — five cases
  that assert the current pass. Closing the gap means flipping them to `deny` in the
  same change; widening it fails here first.

## Corrections that came with writing this down

Three things this file's subject turned out to be while reconciling the rules suite
against it. All are in `firestore.rules`, all were verified by executing the rule text
(315 assertions, `npm run test:rules`):

1. **A `match` block was declared twice.** `payment_references` had two blocks.
   Firestore ORs every `match` whose path fits, so the looser second block silently
   overrode the stricter one — including an `allow create: if isSignedIn()` that let
   any signed-in Guest write a row into the catalogue the Admin verifies proofs
   against. That is a route to making a wrong amount look expected. The duplicate is
   gone, and the website's booking write — which attempted exactly that row and
   swallowed the refusal — is gone with it.
2. **`pricingSnapshotImmutable` could not evaluate.** It called
   `keys().toSet()`; `Map.keys()` already returns a Set and `Set` has no `toSet()`, so
   the expression errored — which under this file's whole theme is indistinguishable
   from a refusal, and made the money-snapshot guard unreliable on the update path.
   It is now `keys().intersection([...].toSet())`.
3. **`access_logs` fixtures contradicted the rule they tested.** A `granted` row must
   be an Admin's (`result != 'granted' || isAdmin()`, from the IoT audit) and must
   carry the writer's own `uid`, which is what the Admin app stamps. The fixtures wrote
   a Guest's `uid` under an Admin's auth and asserted the write would pass.

## Why the fix was not "put it back, but cheaper"

Three alternatives were rejected on the way here:

- **Fold the derivation back in under the budget.** It does not fit: the arithmetic is
  ~200 expressions per Accommodation and the document carries three, with a `get()`
  read that must succeed on the create path. A version that prices only the
  Accommodation named by the Booking was tried and is still ~500 expressions before
  the schedule shape checks, which is where the file already sits.
- **A Cloud Function on the write path.** Firestore trigger Functions run *after* the
  write and cannot refuse it; only Blocking Functions can, and those sit on
  authentication, not on documents. A callable the Guest calls instead of writing
  directly would be the right long shape, and it changes every identity and rate
  surface at once — that is a project, not a repair.
- **An expression counter in the offline engine.** Genuinely useful and *still not
  built* (`docs/HANDOFF-rules-budget.md` §8 item 6). Until it is, the emulator is the
  only instrument that can see this class of failure, and `test/emulator/` is the
  canonical suite for exactly that reason. What this ADR adds instead is cheaper and
  honest: the rules file says what each layer guarantees, and the suite pins the gap
  where the gap is.

## Consequences

- `docs/LIMITATIONS.md` carries the gap in the standing list, so no document claims
  the rules check the price.
- `docs/VERIFICATION.md` records that "rules verified" means *executed by the offline
  evaluator* on this machine, and that the emulator — the only thing that can see an
  expression-budget failure — has not been run here.
- The Admin-side re-derivation named above is the next piece of real work on the
  money path, and it is the item that lets `security` and `end-to-end flow` be
  claimed outright rather than defended.
