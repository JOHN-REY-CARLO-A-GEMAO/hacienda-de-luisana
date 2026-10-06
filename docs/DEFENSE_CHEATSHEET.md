# Defense cheat sheet — Hacienda de LuisAna

For criteria **2, 3, 7, 9, 12**. These are the ones where the honest answer is
"partly, and here is exactly where the line is". Say the line out loud. Do not
round up.

Rule for all five: **never claim these are fully met.** If asked "is this
complete?", the answer is "here is what is done, here is what is not, here is
why" — in that order, and stop.

---

## 2 — Security

**Current implementation**
Enforcement lives in the database, not the UI. `firestore.rules` is 82 KB and
holds two roles only (`guest` / `admin`); anything unknown resolves to guest. A
Guest can only move their *own* Booking forward, and only through a transition
whitelist. Money invariants are rules too — `reservedIsPaidFor()`,
`approvedIsEarned()` — so an unpaid Booking cannot be made to read as reserved
even by a hand-written request. `storage.rules`, `database.rules.json` and
Postgres RLS on the Supabase bucket each default-deny. The Admin app adds a
second factor on sensitive actions: a 6-digit Security PIN, PBKDF2-HMAC-SHA256
at 100,000 rounds with a per-record 16-byte salt, constant-time compare, and a
lockout ladder — and the service layer re-asks the gate so a forgotten call
site still cannot bypass it.

**Still missing**
- **App Check is not initialised.** The dependency is present, the call is not.
- **Rate limiting is client-side only.** Reloading the page clears the cooldown.
- **No CSP header.**

**Why scoped this way**
App Check needs a Firebase Console registration and a Play Integrity setup for
the Android package. Activating it before that exists causes Firebase to
*refuse* every request, so shipping it half-done is strictly worse than not
shipping it. Rate limiting needs Cloud Functions, which this project does not
deploy.

**Demonstrate**
Show the Security PIN gate on a real action (approve a Booking). Show
`firestore.rules` open in the editor.

**20–30 second answer**
> "Authorization is enforced in `firestore.rules`, not in the screens — there are
> only two roles, and the rules decide them. Payment invariants are rules too,
> so an unpaid booking can't read as reserved. The Admin app adds a PBKDF2
> Security PIN on sensitive actions, and the service layer re-checks it, so a
> forgotten UI check still can't take money or delete. Two things are honestly
> open: App Check isn't activated, because it needs Console registration first
> or it blocks all Firebase calls, and rate limiting is client-side, which needs
> Cloud Functions."

**Point at**
`firestore.rules` · `lib/services/security_gate.dart` (12 PIN-tier actions) ·
`lib/services/pin_store.dart:54` · `supabase/01-storage.sql` (deliberately **no**
`select` policy, so no Guest receipt is ever public) · `src/lib/rateLimit.ts:1`
— which documents its own limitation in line one. Admitting that last one reads
as competence, not weakness.

---

## 3 — Database and performance

**Current implementation**
Cloud side is strong: Firestore for records, Supabase Storage for payment-proof
receipts, Realtime Database for the ephemeral live-location stream. `firestore.indexes.json`
declares 4 composite indexes that match the 4 real queries rather than being
guessed. Payment-proof reads go through an Edge Function that verifies the
Firebase ID token, re-reads the role from Firestore, and returns a 60-second
signed URL — so an Admin can read a receipt without the bucket ever being public.

**The fix made tonight, and the honest limit of it**
This used to fall back to demo data. It no longer does: mock records are seeded
only when there is no cloud connection, one malformed document is quarantined
instead of discarding its whole snapshot, and a real Firestore error now reaches
a screen that says so. **That fixes data integrity. It is not a local database.**

**Still missing — be precise, this is the one most likely to be probed**
There is **no local database** in the mobile app. `shared_preferences` stores
the PIN cache and the tutorial flag; no business data is on-device. Firestore's
built-in offline persistence is not a local database and I would not present it
as one.

**Why scoped this way**
An offline-first cache (sqflite or Drift) is 2–3 days of work: a migration
story, an invalidation rule, and reconciliation on write. Doing it badly would
be worse than not doing it. Given the deadline, a correct online system with an
honest gap was the right trade.

**Demonstrate**
Show the 4 composite indexes against the queries they serve. Show that a denied
read now produces a *visible error*, not invented Guests.

**20–30 second answer**
> "Cloud is Firestore plus Supabase Storage plus Realtime Database, with four
> composite indexes built from the actual queries. Receipts are served through
> an Edge Function that checks the caller's role before signing a URL, so the
> bucket is never public. What I fixed tonight: the app used to substitute demo
> records whenever a read failed, so a permission error showed invented guests
> with invented peso amounts. Now demo data only loads with no connection, a bad
> record is quarantined, and real errors surface. **What I have not built is a
> local database** — there's no SQLite cache in the mobile app. That was scoped
> out against the deadline rather than half-built."

**Point at**
`firestore.indexes.json` (4 indexes) · `supabase/functions/admin-payment-proof/index.ts`
· `lib/services/firestore_service.dart:162` (`_parseAll`, the quarantine) ·
`docs/LIMITATIONS.md`

If they push: *"Yes, that's the gap. Here's the plan I'd defend — a `bookings`
table mirrored on every snapshot, reads served from it when offline, writes
sync through. Two to three days. I chose not to ship it half-done."*

---

## 7 — UI/UX and design

**Current implementation**
One deliberate brand system. Website: Tailwind tokens (`forest`, `olive`,
`cream`), shared component classes in `styles.css`, Cormorant Garamond + Inter.
Admin app: forest green + gold, same two typefaces. Responsive layout is
systematic (`max-w-7xl`, `lg:grid-cols-3`, sticky summary). Placeholder text is
actively policed by a test that fails on `TODO` / `lorem ipsum` / `coming soon`.
A guided interactive tour drives the real screens.

**Still missing — cosmetic only**
- **Font drift between the two apps.** The app uses three display faces
  (Cinzel, Cormorant, Playfair); the website uses two.
- **Colour drift.** App `#1E3A2F` vs website `#1E3120`; app gold `#D4AF37` vs
  website cream-gold.
- **Language drift.** Two Tagalog strings sit in an otherwise English Guest page
  (`BookingHistory.dart:44,47`).

**Why scoped this way**
All three are visible only if someone opens both apps side by side and compares
hex codes. They cost nothing to fix later and nothing to leave.

**Demonstrate**
Open the website on a phone-width viewport next to the app on a tablet. Show the
tour. Show `/account` paginating and the withdraw confirmation — both fixed
tonight and both directly visible.

**20–30 second answer**
> "One palette and two typefaces, shared component classes, responsive
> throughout, and a test that fails the build on placeholder copy. Tonight I
> fixed a real UX bug: `/account` paginated to five bookings with no way to
> reach the rest — six bookings and the sixth was simply not on the page. The
> pager is mounted now, empty searches say so instead of showing nothing, and
> withdrawing a request asks first because it releases your held dates. Honestly
> the two apps aren't perfectly colour-matched and a few strings are in the
> wrong language; those are cosmetic and I'd fix them next."

**Point at**
`tailwind.config.js` · `src/styles.css:79–109` · `src/pages/AccountPage.tsx`
(the Pager + empty-search state) · `test/web/site-content.test.tsx:35` (the
placeholder guard)

---

## 9 — Pagination and large data

**Current implementation**
Real cursor pagination on the two unbounded things:
- **Chat**, both apps: `orderBy` + `startAfter` cursor, page size 30, with a
  "Load earlier messages" button.
- **Guest reviews**: 20 at a time via `DocumentSnapshot` cursor, "Load 20 more".

**The bug fixed tonight** — `/account` computed a page but never rendered a
control, so a Guest with more than 5 bookings could not reach the rest. The
`Pager` component existed and was imported but never mounted. It is now mounted,
with a working page-size selector, and it hides itself when everything fits on
one page.

**Still missing**
The **Admin Bookings list** still reads the whole collection and pages in
memory. Deliberate: adding a hard `.limit()` would silently hide bookings from
the Admin, which is far worse than loading a list. A cursor there is a real
change to the list's query contract.

**Why scoped this way**
Fixing the Admin list properly means cursor state surviving filter changes, plus
the `firestore.rules` interaction. That's redesign, not repair — and it was
explicitly out of scope tonight.

**Demonstrate**
The best evidence is the one the panel can check themselves: **seed 6+ bookings
on the Guest account** (your checklist item 5), open `/account`, and page
between them. Then open Admin → Guest reviews and press "Load 20 more" twice.

**20–30 second answer**
> "Chat and reviews use real cursor pagination — a `startAfter` cursor, not an
> offset, so it doesn't get slower as the list grows. I found and fixed a real
> bug tonight: the account page computed a page but never rendered the pager, so
> anyone with more than five bookings simply couldn't see the rest. That's fixed
> and tested. The Admin bookings list is the one place still paging in memory;
> I left it deliberately, because truncating that list would hide bookings from
> the operator, and a cursor there changes the query contract."

**Point at**
`src/lib/chatCloud.ts:244` (`startAfter`) · `lib/views/reviews/reviews_screen.dart:170`
("Load 20 more") · `src/components/Pager.tsx` · `test/web/account-page-lists.test.tsx`
(6-booking test) · `docs/LIMITATIONS.md` § Pagination

If they push: *"Yes, one list out of seven. I chose visible-complete over
truncated-fast."*

---

## 12 — Payment and QR integration

**Current implementation — this one is genuinely partial, so lead with the split**
What runs **without a human**:
- OCR reads the screenshot in the browser (tesseract.js) and **extracts the
  reference number** — labelled refs first, then a digit-group walker that
  reassembles GCash's two-column layout, deliberately refusing 14–16 digit card
  numbers.
- It **extracts the amount**, and where a receipt printed two different figures
  (a fee makes "Total Sent" differ from "Amount") it returns *every* peso figure
  with its label and refuses to guess — `suggestedAmount` returns `null` on a
  tie rather than picking one.
- The claim is then **checked against the screenshot**: the submitted amount must
  be one the receipt actually shows, or the Guest is asked which figure they
  sent. With a stated escape hatch for a blurry photo.

What **requires a human**: the final verification. `canAutoVerifyFromOcr()`
returns literal `false`. The Admin opens the proof and confirms the amount, which
requires the Security PIN.

**Still missing — do not soften this**
- **No PayMongo / QR Ph integration.** There is no gateway, no webhook, no
  merchant link. The Guest is shown the published GCash number and bank account
  and transfers manually. **I cannot claim automated payment verification.**
- `canAutoVerifyFromOcr` is hard-coded off, so the reference catalogue is a
  tested contract and a rule — **not a wired workflow**.
- OCR runs client-side, so a determined Guest controls what gets extracted.
- The Admin's Payment-references screen is an in-memory list; it never writes to
  the cloud collection.

**Why scoped this way**
PayMongo needs a merchant account and **secret** keys. A client app cannot hold
a secret, so it requires a Cloud Function webhook — infrastructure this project
does not deploy. Auto-verifying from OCR without a server-side second source
means trusting a number the paying party supplied. Both were scoped out with a
written rationale rather than shipped as a fake integration.

**Demonstrate**
Upload a real GCash receipt and let OCR pre-fill the reference and amount on
stage. Then show the Admin opening the proof and verifying with the PIN. Say
out loud where the human enters the loop.

**20–30 second answer**
> "Half of this is automated and half is deliberate. OCR reads the screenshot,
> pulls the reference number, and pulls the amount — and where a receipt shows
> two different figures because of a fee, the page asks the Guest which one they
> actually sent rather than guessing. The submitted amount is then checked
> against what the receipt shows. **The final verification is manual, by
> design**: auto-verifying would mean trusting a number the paying party
> supplied. And I have **not** integrated PayMongo — that needs a merchant
> account and secret keys, which can't live in a client app, so it needs a
> server webhook. The reference-matching function exists and is tested, but it's
> a contract, not a live workflow yet."

**Point at**
`src/lib/payments/ocr.ts` — `extractReferenceNumber:124`,
`extractReceiptAmounts:152`, `suggestedAmount:256` (returns `null` on a tie),
`claimAgainstReceipt:446`, `canAutoVerifyFromOcr:511` (**returns `false`**),
`src/components/Booking/PaymentStep.tsx:341` ("OCR is not verification") ·
`docs/adr/0001-approve-before-pay-manual-verification.md`

**The line, memorised:** *"extraction is automated, verification is not."*

---

## If they ask something not covered here

Three answers that are always true:

1. **"Is this complete?"** → "No. Here is exactly where the line is." Then stop.
2. **"Why isn't X built?"** → "Deadline. Two to three days of work, and I chose
   a correct online system over a half-built offline one."
3. **"How do you know it works?"** → "853 web tests and 229 Dart tests, and the
   three red ones are deliberate — they're documented invariants we haven't
   fixed yet, not flakes." (Real: 853 pass, 229 pass, 3 intentional-red.)

Never claim 2, 3, 7, 9 or 12 is fully met. Never say "70% complete" — let them
score it.