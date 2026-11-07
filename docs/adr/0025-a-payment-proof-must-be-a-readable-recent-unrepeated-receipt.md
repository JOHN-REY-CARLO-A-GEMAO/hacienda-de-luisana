# ADR-0025: A payment proof must be a readable, recent, unrepeated receipt

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

A Guest claims a payment by uploading a screenshot of a GCash, Maya or bank
transfer receipt. Until now the browser read the image with OCR and pre-filled
the reference and the amount, but the fields stayed editable and the read was
only advice (ADR-0012). A Guest could file a claim the image never supported —
a different reference, an amount the receipt does not print, a date that is not
on it — and the first person to notice was the Admin opening the screenshot by
hand. Nothing compared one Booking's reference against another's, so the same
reference could pay for several Bookings at once, and nothing refused a receipt
from a year ago.

The Admin cannot verify money from a picture (ADR-0012 remains true). What the
system *can* do is refuse to file a proof it cannot check: a claim the receipt
does not carry is not evidence, it is an assertion with an attachment.

## Decision

### The four values are read, not typed

`/book/pay` and the re-send form in `PaymentStep` read the receipt in the
browser and file four values: the **reference number**, the **amount**, the
**payment date** and the **payment time**. All four are displayed read-only.
When the scan cannot produce all four, the form refuses with the values it
could not read and asks for a clearer screenshot; there is no manual-entry
fallback and no "my receipt says otherwise" override.

The rule is one pure function, `checkScannedReceipt` in
`src/lib/payments/receipt-rules.ts`, so both forms and the tests agree on the
answer. Its problem codes are `not-scanned`, `unreadable`, `reference-mismatch`,
`amount-mismatch`, `date-mismatch`, `time-mismatch`, `too-old`, `in-future` and
`duplicate`.

### Alphanumeric references keep their letters

Bank apps print `BDO-1234 5678`, `bdo12345678` and `BDO12345678` for the same
payment. The duplicate check compares a key — upper-cased, `[A-Z0-9]` only —
while the Guest and the Admin keep the printed spelling
(`normalizePaymentReference` / `displayPaymentReference`). Letters are never
dropped, so an all-letter reference survives.

### The window is an Admin setting

A receipt is accepted only within `payment_proof_max_age_days` (1–90) from
`site_config/booking`, default **7 days** when the document says nothing usable.
Receipt timestamps are read as Asia/Manila (UTC+08:00); a receipt up to ten
minutes ahead of the browser's clock is tolerated, anything further ahead is
refused as `in-future`.

### One reference, one payment

A reference already on a live Booking (any status other than `Cancelled`,
`Rejected` or `Expired`) is a duplicate, refused with a `role="alertdialog"`
titled **"Duplicate reference"**. The check runs in two places:

- advisory, before the Guest submits: the `paymentReferenceStatus` callable
  (auth required, key 6–40, quota-limited) so the popup can be shown early;
- authoritative, inside `submitBooking`'s Firestore transaction, so two
  submissions racing with the same reference cannot both pass
  (`already-exists`, `cause: DUPLICATE_PAYMENT_REFERENCE`).

`payment_reference_key` is stored beside `payment_reference`; `firestore.rules`
and `validateGuestBookingShape` accept both, and the key is what the duplicate
lookup queries.

## Consequences

- A blurry photo, a cropped screenshot or a receipt for another person's payment
  can no longer be filed. The Guest is told exactly which value was unreadable.
- The Admin no longer receives proofs whose claim disagrees with the image; the
  remaining verification is the money itself (ADR-0012).
- `ocr_payment_time` joins the OCR evidence boundary, and `payment_time` /
  `payment_reference_key` join the Guest's allowlisted update fields.
- A receipt photographed from another screen, or a stale receipt re-used across
  Bookings, has a named refusal instead of an Admin discovering it later.
- The demo adapter performs the same checks over its local store, so behaviour
  without Firebase credentials matches the deployed callables.
