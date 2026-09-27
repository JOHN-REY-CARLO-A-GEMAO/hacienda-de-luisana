# A downpayment screenshot is required before a Booking exists

**Status**: accepted, 2026-09-27. Reverses ADR-0001 for new bookings. Historical bookings that were already opened for payment keep the old path.

ADR-0001 decided that the Admin approves a stay before any money moves, so a rejection never creates a refund of money the Hacienda should not have held. That is reversed for new bookings: the Guest sends a downpayment first, uploads a screenshot, and only then is the Booking submitted as `Pending`. The Admin's decision is whether that screenshot is accepted.

## What a Guest can do without an account

Browsing every room does not require a login. Starting a booking does not either. The form collects the stay, the party, and contact details, and stores them only as a draft in this browser. Nothing is written to the Booking collection until the next page.

## What submits a Booking

The payment page is the only create. It requires:

- a screenshot of the downpayment (image, under 5 MB, stored at `payments/{uid}/{ref}/proof.{ext}`);
- the amount the Guest says they sent, greater than zero.

If a published rate card includes a down-payment percent, the page may show that share as the due-now figure. A missing percent is not 50%. The Guest types the amount they sent, and the Hacienda confirms it from the screenshot. No GCash or bank account number is published on the site; the page points at the official phone, email, and Facebook page.

The created document is `Pending`, `payment_status: pending`, and carries no verification marker. OCR may suggest a reference and an amount. It never verifies.

## What the Admin decides

From `Pending` the Admin may `Approve` or `Reject` (or the hold may `Expire`, or the Guest may `Cancel`).

`Approve` requires the screenshot and `amount_claimed > 0`. If `amount_due > 0`, the claimed amount must cover it. The write lands on `Approved`, sets `payment_status: verified` and the verification marker, and clears the date hold. `Approved` holds the dates. Check-in is the next step. `Reserved` is not reachable from `Approved`.

`Reject` sets `payment_status: rejected` and releases the dates. The Booking does not become `Approved` or `Reserved` on the way.

## What is left of the old path

Documents already at `Payment Pending` still choose a plan, upload proof, and are verified into `Reserved`. A stored `Approved` that has no screenshot, or whose payment is not `verified`, reads as `Payment Pending` — that is what `Approved` meant before this decision. New writes of `Approved` always have both, so they stay `Approved`.

A Guest cannot write `Approved`. A cloud write that Firestore refuses is not replayed into this browser when the patch would claim `Approved` or a verification marker.
