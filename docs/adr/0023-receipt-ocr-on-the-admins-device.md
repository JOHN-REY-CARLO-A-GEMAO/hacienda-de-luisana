# Receipt OCR runs on the Admin's device — and never verifies a payment

**Status**: accepted, 2026-10-29. Extends ADR-0011 (private proof storage) and
ADR-0012 (a screenshot is required before a Booking exists); changes neither.

## What was already there

The Guest website has run OCR at upload time since 2026-09-27:
`src/lib/payments/ocr.ts` reads the chosen screenshot with tesseract.js in the
Guest's browser and writes what it read onto the Booking as `ocr_reference`,
`ocr_amount`, `ocr_sender_name` and `ocr_payment_date`, next to the reference the
Guest accepted as `payment_reference`. `canAutoVerifyFromOcr()` is hard-coded
`false`.

The Admin app then ignored most of that. `BookingModel` parsed only
`ocr_sender_name` and `ocr_payment_date`; `ocr_reference` and `ocr_amount` were
stored on every website upload and never read, so the one screen that decides
whether money arrived could not see the reference the receipt printed.

## The decision

**1. The Admin app reads the stored extraction first.** For a proof the website
has already read, there is nothing to compute: the panel shows
`ocr_reference`/`ocr_amount` and labels them `OCR — hindi pa beripikado`. The
stored read is trusted only while `ocr_proof_url` still matches the attached
`payment_proof_url` — a re-sent proof is a new object under a new path, so a
read of the old image must never be shown against the new one.

**2. When there is no usable stored read, the Admin app reads the proof itself**,
on the device, with Google ML Kit's Latin text recognizer
(`google_mlkit_text_recognition`). That covers a proof uploaded before the
website had OCR, a browser where tesseract.js failed to load, and the Admin's
own "basahin muli" after a bad read.

ML Kit was chosen over a cloud OCR API because it needs **no API key** (nothing
secret ships in the APK, which is what `docs/VERIFICATION.md` § 6 requires), it is
**free** (the model is bundled; no per-page bill), it is **private** (a Guest's
GCash receipt carries their name, number and reference — exactly what ADR-0011's
private bucket exists to protect, and it never leaves the phone), and it works
**offline**.

**3. The parsing is pure Dart and shared in spirit with the website.**
`lib/models/receipt_extraction.dart` mirrors the website's extractor: a 10–13
digit reference (refusing a 16-digit card number), the awkward two-column GCash
reference that spans two rows, label-specific amounts (`Total Amount Sent` over
`Amount`) because a fee makes them disagree, day-first Philippine dates with an
ambiguity flag, and sender/recipient taken only from a label. It has no Flutter
or Firebase import, so it is unit-testable without a device.

**4. Extraction and acceptance are separate writes.** OCR writes `ocr_*` fields
only — `ocr_reference`, `ocr_amount`, `ocr_sender_name`, `ocr_recipient_name`,
`ocr_payment_date`, `ocr_proof_url`, `ocr_engine`, `ocr_confidence`,
`ocr_extracted_at`. The reference a human accepts is written by a second,
deliberate action: `payment_reference`, with `payment_reference_source:
admin_corrected`, `payment_reference_corrected_by/at`, and
`payment_reference_previous` when it replaced one. Neither write touches
`status`, `payment_status`, `amount_verified`, `payment_verified_by` or
`payment_verified_at`, so **no receipt can approve itself**. `firestore.rules`
already allows the Admin to write any Booking field (`adminUpdate()` has no
allowlist) while the Guest's `hasOnly` vocabulary excludes every field above, so
a Guest cannot write, clear or forge an extraction.

**5. A machine-read number cannot carry a verified payment.** In the payment
queue, a Booking whose only reference is `ocr_reference` stops before verification
and asks the Admin to confirm or correct it. The `payment_references` row filed
after verification records `reference_source` (`admin_confirmed` or `ocr`) and
stays `pending_review` if it was never accepted by a human.

**6. Guards, in one service, not in each screen.**
`PaymentReferenceService` refuses an invalid reference or date; refuses a
reference already filed against a different Booking unless the Admin confirms on
the record; and refuses to change the reference of a verified payment without a
second explicit confirmation. Concurrent reads/writes run in a transaction, and
an extraction whose proof changed mid-read is discarded rather than filed.

## Consequences

- The Admin does not re-type a GCash reference. It is pre-filled, labelled with
  where it came from, and editable.
- An unreadable receipt produces warnings and an empty field — never a
  fabricated number.
- The features are Android/iOS only: ML Kit has no web or test-platform
  implementation, so `readProof` returns `unsupported` there and the panel tells
  the Admin to type the reference. `flutter test` therefore exercises the parser
  and the decision rules, not the recognizer.
- Latin script only. A receipt printed in another script will read poorly, which
  the panel shows as "walang nabasang detalye" rather than as values.
- A `payment_references` row's `reference` and `amount` are immutable under the
  rules (they are evidence). Correcting a filed OCR reference is done on the
  Booking, which is where the extraction lives; the row remains as filed.
- OCR stays a hint engine. Nothing in this change flips
  `canAutoVerifyFromOcr()`, and ADR-0012's rule — the Admin decides, with the
  Security PIN in front of it — is unchanged.

## Amendment — 2026-11-01: the website's read now reaches the Admin whole

The "What was already there" section above described the website writing its
read onto the Booking on every upload. That was only true of `/mybookings`:
`/book/pay` ran the same OCR but kept only the two form fields it pre-fills, so
a Booking born there carried the Guest's `payment_reference` claim and **no**
`ocr_*` evidence at all — the Admin app opened it with "Hindi nabasa" beside
the amount and date, and "Walang naitalang pinagmulan" for its provenance.
`/book/pay` now files the read it already computed (`ocr_reference`,
`ocr_amount`, `ocr_sender_name`, `ocr_payment_date`) plus its provenance
(`ocr_proof_url`, `ocr_engine: 'tesseract'`, `ocr_confidence`), and the
`submitBooking` callable admits those keys with strict shape bounds.

Point 4 also narrows accordingly. The Guest's `hasOnly` vocabulary already
carried the four evidence fields for the website's re-send; it now carries the
provenance triple too, because only the Guest's write can re-stamp which proof
object a re-sent read describes — point 1's staleness rule has nothing to
compare without it. The correction metadata (`ocr_recipient_name`,
`ocr_extracted_at`, `payment_reference_source`, `payment_reference_*`) stays
Admin-only, and nothing about who may verify money moves.

What the browser read was also thinner than the receipt: the website parser
required an amount label on the figure's own row (GCash prints the label and
the `₱figure` on separate rows), its bare-`PHP` marker test could never fire,
and tesseract's `eng` model has no `₱` and usually returns `P` for it. The
reference — a digit-group read — survived all three, which is why only it
showed. The website parser now takes the label from the row above when a row
is only currency (as the Dart parser always did), recognises the misread `P`
for decimalled or comma-grouped figures, and admits day-first month names
(`1 November 2026`); both parsers were kept in step. Finally, when the Admin
app cannot *file* a read it took on-device, the panel shows the read anyway
and says so — an error above four fields still reading "Hindi nabasa" was the
other half of the same screenshot.

## Amendment — 2026-11-02: the write survives a lost connection, and names its cause

The 2026-11-01 amendment fixed what the Admin *sees* when a read cannot be
filed. It did not fix the filing. `_storeExtraction` wrote inside a Firestore
transaction, and a transaction requires a live connection: it is not queued
offline the way an ordinary write is. An Admin reviewing a proof on a weak
signal therefore watched the recognizer read the receipt correctly and then got
"Hindi na-save ang nabasang detalye" — the same sentence a `permission-denied`,
a deleted Booking, or a bug in the patch would produce. The screenshot that
started this read the reference, the amount and the date perfectly and filed
none of them.

Point 6's guard is unchanged; the write is now attempted twice:

1. **The transaction.** It re-reads the Booking and refuses to file if the
   attached proof is no longer the one the recognizer saw. This is the atomic
   path and stays first, so the normal case keeps its guarantee.
2. **A plain `update`,** if the transaction threw. Firestore queues a normal
   write and lands it when the signal returns, which is the behavior an Admin
   reviewing proofs away from the house needs; the patch is identical, so
   `ocr_*` evidence is still all it can touch. The staleness guard is kept by
   reading the proof path first and, more importantly, is carried *inside* the
   patch: `ocr_proof_url` names the object the read describes, and
   `BookingModel.ocrReadIsStale` is what the panel compares before believing it.
   The pre-check is best effort — a read that cannot be made is not a reason to
   discard a read the Admin is looking at.

`update` rather than `set(merge: true)` on the second path, deliberately: a
merge-set on a Booking deleted mid-read would create a document holding nothing
but OCR fields, while an update fails honestly with `not-found`.

The failure is also classified now (`ReceiptWriteFailure`, via the free function
`receiptWriteFailureFor`) and the panel prints the matching next step: rules not
deployed, no signal, Booking gone. One sentence for four different accidents was
the reason this bug took a screenshot to diagnose.

Both paths still touch `ocr_*` only. Nothing here moves money, and nothing here
flips `canAutoVerifyFromOcr()`.

## Amendment — 2026-11-02: an evidence row appears only when it carries evidence

Point 1 put amount, transaction date, sender and recipient on the panel, each
with where it came from, and the panel printed "Hindi nabasa" in any of them the
recognizer could not fill. On the commonest proof in the queue — a GCash
*Express Send* receipt, which prints no `Sender` label and an unlabelled, masked
payee — that produced two rows of "could not read" above the notice that
actually mattered, and read as a fault in the app rather than as an answer. The
same screenshot that started the 2026-11-01 amendment shows three of them.

Sender, recipient and the provenance line are now rendered **only when they have
a value**. Nothing is thrown away: `ocr_sender_name`, `ocr_recipient_name` and
`ocr_proof_url` are still written by the extraction, still pre-fill the
correction dialog, and `ocr_proof_url` is still what pins a read to a proof —
a stale one is reported in `warnings`, which is where a thing the Admin can act
on belongs. A receipt that could not be read is likewise still said once, in
`warnings`; it is no longer said three times in the evidence list. The "Walang
naitalang pinagmulan" string is gone with the row it described, and amount and
transaction date keep their "Hindi nabasa": those two are the fields the decision
turns on, so their absence *is* the signal.

## Amendment — 2026-11-02: the evidence write has its own rule, and the refusal names its writer

A device log reported ML Kit reading `Ref: 8159662488150` / `₱5000.00` and
`_storeExtraction()`'s `update(bookings/EFWlBlZN72rBnVjfaLFK)` coming back
`PERMISSION_DENIED`. Point 4 above said "`firestore.rules` already allows the
Admin to write any Booking field (`adminUpdate()` has no allowlist)" — true of
the field list, but not the whole story. The general `allow update` also binds
every write to `reservedIsPaidFor()`, which asks about the **stored** status: a
historical `Reserved` Booking whose `payment_status` is not `verified` fails it
even when the patch changes nothing but OCR evidence. Firestore reports that as
the same bare `permission-denied` a role refusal produces. Two other causes
produce the same
line: a ruleset deployed from a different commit/project, and a session the
rules read as Guest (`profiles/{uid}` missing, or an allowlisted address whose
`email_verified` **ID-token claim** is stale — the app read `User.emailVerified`
instead).

Changes, none of which move money:

1. **`firestore.rules` now decides evidence writes on their own.** Inside
   `match /bookings/{bookingId}`, `adminOcrEvidenceUpdate()` is an OR branch
   ahead of the general update rule: at least one `ocr_*` key must change,
   **only** the nine `ocr_*` keys from `_storeExtraction` may change, and
   `isAdmin()` must hold. Because the key list is closed, the lifecycle and
   money invariants are vacuous for this write; every other write still pays
   for them first, and the Guest's seven-key self-serve vocabulary is
   unchanged. This lifts "extraction never moves money" from a Dart-only
   guarantee into the rule layer.
2. **The Admin session aligns its token.** `AuthStore` refreshes the ID token
   on session restore when a verified allowlisted address carries a stale
   `email_verified: false` claim, so the app's idea of Admin cannot run an hour
   ahead of the rules'. A Profile-promoted Admin needs no token claim.
3. **A refusal is diagnosable.** `logReceiptWriterIdentity()` prints the uid,
   email, `User.emailVerified`, and the token's `email`/`email_verified` claims
   to the device log; `receiptWriteAdvice()` now names the deployed rules,
   `profiles/<uid>.role`, the verified allowlist address and a token refresh.
   `docs/FIREBASE_SETUP.md` § 4 has the deployment/identity checklist.

A generic `allow read, write: if isAdmin()` built on `users/{uid}`,
`resource.data.userId`, `admin` custom claims or camelCase receipt fields was
**rejected**: this project has no `users` collection, no `admin` custom claim,
and stores a Booking's Guest as `uid`. Installing that snippet would replace
the Guest, lifecycle and money invariants of ADR-0001/0012/0018 with a
two-line rule and would still not help a session the rules read as Guest.
