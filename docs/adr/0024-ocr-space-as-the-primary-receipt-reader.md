# The website reads a receipt with OCR.space first, through a function — never in the bundle

**Status**: accepted, 2026-11-02. Extends ADR-0011 (private proof storage) and
ADR-0023 (receipt OCR on the Admin's device); changes neither. It **revises the
website half of ADR-0023**: the Flutter Admin app keeps Google ML Kit, the Guest
website now prefers OCR.space and keeps tesseract.js as its fallback.

## The problem with what was there

`src/lib/payments/ocr.ts` has read payment screenshots with tesseract.js in the
Guest's browser since 2026-09-27. It is free and private, and it is also the
slowest thing on the payment screen. The first screenshot of a session fetches a
worker, a WASM core and an English model before a single line is read; on a
mid-range Android phone that is a wait of several seconds on mobile data, and the
result is often noise when the receipt was photographed rather than screenshotted.
A Guest who is waiting to pay has no patience for an engine download, and a Guest
who gives up on the field files a claim the Admin then has to read by eye anyway.

ADR-0023 answered this for the Admin app with **Google ML Kit on the device**: no
key, no cost, no upload, works offline. That reasoning does not transfer to the
website. ML Kit has no web implementation, and the browser's alternative
(tesseract.js) is exactly the engine that is too slow.

## The decision

**1. OCR.space reads the screenshot, on the server.** When a build sets
`VITE_RECEIPT_OCR_CLOUD=ocrspace`, `runReceiptOcr` sends the chosen image to the
`readReceiptText` callable (`functions/src/ocr.ts`) before it tries anything
local. The callable posts it to `https://api.ocr.space/parse/image` and returns
the text it read. The response comes back in about a second, at a quality that
handles a photographed GCash receipt better than a WASM build of Tesseract does.

**2. The key is the function's, never the site's.** `OCR_SPACE_API_KEY` is read
from `functions/.env` (gitignored, loaded by the Firebase CLI at deploy) or from
the hosting dashboard. It is **not** a `VITE_*` variable, so it is not in the
bundle every Guest downloads, not in the Flutter APK, and not in Git. A missing
key is not a broken build: the callable refuses with `failed-precondition` and the
website falls back to tesseract.js, exactly as it behaves today.

**3. The image is resized and re-encoded in the browser first.** The free plan
caps a file at 1 MB; a phone screenshot is often 2–4 MB. `src/lib/payments/ocr-space.ts`
scales the long edge to 1800 px and walks JPEG quality down until the payload fits.
The bytes that are read are the bytes that were uploaded to the private bucket, so
the Admin reviews the same image the engine saw. The cap is enforced again in the
function: a payload over it is refused, never truncated.

**4. Nothing is stored, and nothing is logged.** The image is base64 in the
request, forwarded once, and dropped. The function logs a failure **code**, never
the image, the OCR text, or the reference — a GCash receipt carries a name, a
number and a payment reference, which is the material ADR-0011's private bucket
exists to hold. OCR.space's own retention is stated in their terms; this project
adds none.

**5. It is a reader, not an approver.** The callable returns text and nothing else.
Parsing stays in `extractReceiptFields` (web) and `receipt_extraction.dart`
(admin), the Guest still confirms or corrects every field, and
`canAutoVerifyFromOcr()` is still hard-coded `false`. No extraction touches
`status`, `payment_status`, `amount_verified` or the verification marker.

**6. It is a fallback-shaped design even though it runs first.** Every failure —
no key, no callable, offline phone, spent quota, a format the engine will not
take — becomes a typed `CloudOcrUnavailableError`, and `runReceiptOcr` catches it
and runs tesseract.js. A Guest is never left with no engine because a third party
or a deploy had a bad day. A blank read from OCR.space does **not** fall through:
the screenshot is blank, and downloading a 6 MB engine to confirm that would be
wasteful.

**7. Its cost and its ceiling are written down.** The free plan is 25,000 reads a
month, 500 a day **per IP**, and 1 MB a file. Since every Guest's request leaves
from the function's egress, those 500 are shared by the whole site — ample for a
hacienda taking a handful of downpayments a day, and the reason a PRO key exists
(and why `OCR_SPACE_ENDPOINT` is configurable). The callable also rate-limits per
Guest/IP (`OCR_RATE_LIMIT_PER_MINUTE`, default 10) with the same two-tier budget
the other callables use, so a single caller cannot spend the day's allowance.

## What this costs, honestly

- **A receipt now leaves the device** when the cloud read is on. That is a real
  privacy change and the opposite of the reasoning in ADR-0023. It is mitigated,
  not erased: the call is opt-in per build, the third party is named, nothing is
  stored by this project, and a deployment that leaves the flag unset keeps every
  read in the browser.
- **A third party is in the payment path.** If OCR.space is down or the IP
  allowance is spent, the read is slower (tesseract) — never impossible. The
  submission itself never depends on the read succeeding.
- **A build-time switch, not a runtime one.** Turning the cloud read off is a
  redeploy. `site_config` would make it runtime, but the flag decides where a
  Guest's receipt is sent, so it belongs with the build that was reviewed.

## Consequences

- The payment screen reads a receipt in about a second on a phone, on the first
  screenshot of the session, with no engine download.
- `tesseract.js` stays in `package.json`: it is the default engine and every
  fallback path.
- The Admin app is unchanged. If it ever wants the same engine, the callable is
  already there — it would need an Admin-only auth check, which ADR-0023's ML Kit
  path makes unnecessary for now.
- Tests: `functions/test/ocr.test.ts` covers the request, the caps, the reply
  mapping and every failure mode with an injected `fetch` (the Phase 0 runner has
  no network); `test/web/receipt-ocr-cloud.test.ts` covers what leaves the device;
  `test/web/receipt-ocr-cloud-run.test.ts` covers the engine order and the
  fallback.
