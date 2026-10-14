# Handoff — Firestore rules: the 1000-expression fix

**Date:** 2026-10-14 · **Base:** `ea64dcd` · **Nothing was deployed.**

---

## 1. The actual problem

`firestore.rules` exceeded Firestore's documented **1000-expression-per-request** limit on the guest booking `create`. Firestore reports an evaluation error as the same bare `permission-denied` a policy refusal produces, so **every guest booking was refused**, on every date, while the offline rules suite (`npm run test:rules`) reported green.

`test/rules/engine.ts` has **no expression counter** (only a recursion guard at `:1234`), so no local tool can measure or regression-test this. Only the Firestore emulator detects it.

Reproduced on this machine before any change — `tmp-repro-out.txt`, run against HEAD, all three dates DENY, anonymous and authenticated.

---

## 2. State of the working tree

```
 M firestore.rules                    +83 lines   (the fix)
 M test/rules/firestore-rules.test.ts  +8/-2      (one it.each entry removed)
 M package-lock.json                  (pre-existing, not mine)
```

Untracked — **mine, delete these three:**
- `test/emulator/tmp-inquiry-lifecycle.rules.test.ts` (abandoned Option B scaffolding)
- `vitest.tmp-inquiry.config.ts`
- `vitest.tmp-offline.config.ts` — **keep this one for now**, it is how you run the offline rules suite on Windows (see §5)

Untracked — **yours, keep:**
- `test/emulator/tmp-repro-create.rules.test.ts`
- `vitest.tmp-repro.config.ts`
- `tmp-repro-out.txt`

---

## 3. What changed in `firestore.rules`

**`validGuestCreate` no longer calls `validAuthoritativeMoney`.** It calls a new `validBookingMoneyInvariants(data)` that checks only the arithmetic of the guest's own submitted figures:

| Check | Purpose |
|---|---|
| `rate_unit == 'standard_stay'` | no retired unit |
| `rate_classification in ['weekday','weekend_holiday']` | no invented class |
| `payment_plan == 'down-payment'` | plan is fixed |
| `nights is int && nights == 1` | one 22-hour stay |
| `rate_amount > 0`, `stay_total > 0` | sane |
| `stay_total >= 1000` | **hard floor** |
| `security_deposit >= 0` | deposit not negative |
| `amount_due == int(stay_total * 50) / 100.0` | the 50/50 split |
| `balance_due == stay_total - amount_due` | the split closes |
| `amount_claimed >= amount_due` | cannot claim underpayment |

The `/ 100.0` is load-bearing — CEL `/` between two ints is **integer division** and would truncate centavos. The formula matches `downPaymentAmount(stayTotal, 50)` at `src/lib/booking/money.ts:55-60` exactly.

The second call site — the guest plan-choice guard in the `allow update` block — was swapped the same way.

**`validAuthoritativeMoney` and its helpers are still in the file and are now dead code.** `scheduledRate`, `classifyCheckIn`, `validPetCount`, `petFee`, `validLateCheckout`, `lateCheckoutFee`, `stayTotalWithAddons` have no remaining callers. **Do not wire them back.** (I attempted this deletion and broke the file; it needs doing carefully.)

Keep: `validGuestSchedule`, `validAHouseSchedule`, `validAvailableUnits`, `isCanonicalAccommodation` (used by the rates-write path), and `validHistoricalPlanChoice` (used at the plan-choice guard).

---

## 4. Verification status — read this carefully

| Check | Result |
|---|---|
| Emulator repro, guest create | ✅ **6/6 ALLOW**, with real headroom — verified on an equivalent version of this change |
| Emulator repro, current tree | ⚠️ **NOT re-verified** — the confirming run was aborted. Re-run it (§5). |
| Offline rules suite | ❌ **18 failed / 314**. 7 are pre-existing; **11 are new** (§6) |
| Full emulator suite | ❌ **never run.** `test/emulator/rules.emulator.test.ts` has ~50 money assertions and is the real regression surface. **This is the big one.** |
| Production deploy | ❌ not done, not attempted |

Pre-existing failures, unrelated and present at HEAD — do not spend time on them:
`access_logs > records a lock touch by the person who made it`,
`access_logs > still works now that live location is retired`,
`admin_security > gives an Admin no write on another Admin's record`,
`admin_security > the create > accepts the Admin's own first setup, counters born zero`,
`admin_security > update door 1 — the counters, forward only > records a failure`,
`… > starts the ladder at five, with a lockout`,
`… > lets a lock be pushed later, and an expired one be cleared`.

---

## 5. How to run things on Windows

The repo's launcher (`scripts/phase0/run.mjs`) is **Linux-only** by design (`run.mjs:14` requires a network namespace). Use these instead:

```powershell
# Offline rules suite (no emulator)
npx vitest run --config vitest.tmp-offline.config.ts

# Emulator repro — KILL THE ORPHAN FIRST, it leaves a java.exe on 8080
Get-NetTCPConnection -LocalPort 8080 -State Listen | % { $_.OwningProcess | % { Stop-Process -Id $_ -Force } }
npx firebase emulators:exec --project demo-hacienda --only auth,firestore "npx vitest run --config vitest.tmp-repro.config.ts"

# Full emulator suite — write a config like vitest.tmp-offline.config.ts but
# include ['test/emulator/**/*.test.ts'] and run it under emulators:exec with
# --only auth,firestore,database,storage
```

Always `--project demo-hacienda`. Never run a deploy from this box.

---

## 6. The 11 tests you must decide about

These fail **because the guarantee they protect is gone**. Deleting them makes the suite green; that is the only way to get green.

```
official guest-count rates > adds the published pet fee to the stay total and the 50/50 split
official guest-count rates > adds the published late-checkout rate to the stay total
official guest-count rates > validates one A-House unit for up to three guests at a flat per-unit rate
official guest-count rates > an A-House schedule that drifts from the documented occupancy  (5 its)
official guest-count rates > rejects manipulated totals, invalid counts and multi-stays
official guest-count rates > fails closed for retired flat/fixed-fee rates and missing holiday configuration
official guest-count rates > captures the exact published refund policy and rejects a guest-edited copy
```

Plus, already handled: `security_deposit` was removed from the `it.each` at the top of `describe('auth: who is asking')`, with a comment explaining it is a real gap.

They sit roughly at `test/rules/firestore-rules.test.ts:233-468`.

---

## 7. The accepted security gap — must be written down

This is the most important part of the handoff.

**Before:** a guest could not forge a price, because the rule re-derived it from the published rates.

**Now:** a guest **cannot tamper with the arithmetic**, but **can quote a coherent price far below the real one.** `stay_total: 1000`, `amount_due: 500`, `balance_due: 500`, `amount_claimed: 500` passes for a ₱32,000 stay. So does zeroing `security_deposit`.

**Nothing downstream catches it today.** `lib/services/booking_lifecycle.dart:1033-1067`:

```dart
final claimed = _num(booking['amount_claimed']);   // guest-written
final owed    = _num(booking['amount_due']);      // guest-written
if (owed > 0 && claimed < owed) { ...refuse... }  // 50 vs 50, both the guest's
findDateConflicts(...)                            // availability, not money
patch['amount_verified'] = claimed;               // promotes the guest's number
```

There is **no Dart pricing code** — `quoteAccommodation`, `classifyRateDate`, `scheduledAmount`, `downPaymentAmount` have **zero hits** in `lib/**/*.dart`. The Admin app does not re-derive anything.

Two justifications that were raised and do **not** hold:
- *"Normal guests use the web UI"* — the rules are the defence against a direct Firestore write from a browser console. That is exactly the case `validAuthoritativeMoney` existed for.
- *"The Admin verifies the GCash screenshot"* — a screenshot shows what was **paid**, not what was **owed**. A ₱50 receipt matches a ₱50 claim perfectly.

**This was accepted knowingly, as interim, pending an Admin-side price re-derivation.** It should land as an ADR that amends `docs/adr/0010-money-and-audit-invariants-in-the-rule-layer.md`, listing every gap above as an explicit accepted item, with `docs/adr/0012` untouched (the proof-before-Pending flow did not change).

---

## 8. To-do, in order

1. Re-run the emulator repro against the current tree (§5). Confirm 6/6 ALLOW.
2. Run the **full emulator suite** — the one that was never run.
3. Decide the 11 tests (§6) and write the ADR (§7).
4. **Build the Admin-side re-derivation** — the thing that actually closes the gap. This is the real remaining work; everything else is cleanup.
5. Delete the dead helpers (§3), carefully.
6. Wire a budget regression test. There is none, and nothing stops this recurring.
7. Consider making `scripts/phase0` runnable on Windows — you asked for this earlier; it is untouched and needs a real design (no netns equivalent, plus this box has `.env.local` and an authenticated Firebase CLI, which `boundary.mjs` blocks by design).

## 9. Deploy

`firestore.rules` at HEAD is **not deployable** — it breaks every guest booking. The change in the working tree makes it deployable **only if** steps 1–2 pass. Deploying is `firebase deploy --only firestore:rules --project hacienda-de-luisana`, and only on your explicit go-ahead.