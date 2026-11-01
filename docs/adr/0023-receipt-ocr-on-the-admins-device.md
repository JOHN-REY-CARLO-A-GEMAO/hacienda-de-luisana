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
