# Defense Q&A derived from the two project recordings

Mock panel questions distilled from the evaluator critiques in `elmar10202.mp3`
(first — classroom lecture) and `2026_10_09_18_34_31.mp3` (later — live walkthrough,
2026-10-09 18:34). Each question carries the transcript quote the panel heard, where
the answer lives in this repo, and a 20–30 second answer in the same style as
[DEFENSE_CHEATSHEET.md](DEFENSE_CHEATSHEET.md): say what is done, say what is not,
stop.

Companion docs: [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md),
[DEVELOPER_COMPLIANCE_CHECKLIST.md](DEVELOPER_COMPLIANCE_CHECKLIST.md).

---

## 1. Security, data privacy & access control

**Q: "Why are you requesting name, camera, and location without full Terms & Conditions?"**

- Quote: *"Kapag wala kayong terms and condition, kulong kayo... patay kayo sa data privacy."*
- Lives in: `src/lib/legal.ts` (full T&C justifying every permission/input); no
  location is stored at all — ADR-0009/ADR-0013 (proximity alert only, ephemeral
  stream, coordinates never written to Firestore).
- Answer: "Every permission the app asks for is justified in the Terms & Conditions
  in `legal.ts`. On location specifically: we don't store it — the proximity alert
  uses a consented, exphemeral stream that expires, per ADR-0013."

**Q: "Can someone book without signing in?"**

- Quote: *"dapat need mag-sign in na access to naman"*
- Lives in: `submitBooking` callable requires Firebase auth and binds the uid
  (`docs/BOOKING_POLICY.md`); the website signs the Guest in **anonymously** at
  `/book` creation — ADR-0004.
- Answer (say the line honestly): "Booking requires an authenticated identity — the
  server callable refuses unauthenticated creates. On the website that identity is an
  anonymous Firebase sign-in attached at creation (ADR-0004), so a Booking always
  belongs to the browser that made it; it is not a named email account."

## 2. IoT, smart lock & checkout edge cases

**Q: "How does check-in key writing and checkout revocation work with the dual-IoT setup?"**

- Quotes: *"Dalawang dalawang IoT, isang smart lock... taga revok"*;
  *"ira-rite yung key... pag tinap niya bukas pag tinap niya ulit sarado."*
- Lives in: `docs/SMART_LOCK.md`, `docs/HDL_FLOW_CORRECTED.md`, `lib/services/security_gate.dart`,
  `lib/views/smartlock/`, `access_logs`.
- Answer (say the line): "The flow is charted end-to-end: desk reader writes the key to
  the RFID card at check-in, checkout tap revokes it, and every touch lands in
  `access_logs`. Honest line: in the current build the app reads and simulates the
  lock pipeline — the hardware driver is charted, not yet live (`HDL_FLOW_CORRECTED.md`
  says so itself)."

**Q: "What happens if a guest damages or steals something right before checkout?"**

- Quotes: *"ia-announce doun sa admin tapos... i-check yung kwarto"*;
  *"2 hours na parang pag clean... Paano pag may nawawala? ...message na lang."*
- Lives in: `docs/HDL_FLOW_CORRECTED.md` §5 (damage report → deposit settlement →
  cleaning → inspection → `COMPLETED` = AVAILABLE); the "2 hours" is the standard-stay
  gap — check-out 12:00 NN → next check-in 2:00 PM (`src/config/site.ts`), gated by the
  `Complete` move in `src/lib/booking/actions.ts` ("only once cleaning and inspection
  have passed").
- Answer: "Checkout triggers the admin flow: a cleaning-hold record is filed in
  `room_turnover`, damage inspection is recorded as a damage record (and the departed
  Guest is flagged as messaged), then cleaning passes, and only then can the Booking
  be Completed and the room return to available. The meeting's 2-hour hold is realized
  as the 12:00 NN → 2:00 PM turnover window of the 22-hour standard stay, enforced by
  the `Complete` lifecycle gate."

## 3. Error handling & app stability

**Q: "Why does the app ever show raw Firebase/IOE errors?"**

- Quote: *"...may Firebase permission denied... Network connection na lang sir."*
- Lives in: `lib/utils/validators.dart`; `docs/BOOKING_POLICY.md` (permission/network
  failures never shown as "Available"; Refresh/retry offered).
- Answer: "User-facing errors are only input validations or a generic network message;
  backend exceptions are caught and logged, not rendered. The booking flow documents
  its failure states explicitly in BOOKING_POLICY.md."

**Q: "Why did the back button crash the app / force re-login?"**

- Quote: *"Dapat pag pinindot ko yung back button... Home... Bago dapat mag-exit, dapat
  merong confirmation na are you sure you want to sir."*
- Lives in: pop/exit handling in `lib/main.dart`.
- Answer: "Back navigation is handled explicitly and app exit asks for confirmation;
  both are fixed in `main.dart`."

## 4. Payment verification & OCR

**Q: "How do you avoid manual reference-number errors from payment screenshots?"**

- Quotes: *"Kapag nag-send kayo ng screenshot, dapat yung reference number mababasa
  niya magiging text."*; *"Search ang putik. Hirap. Daming number ng reference ah."*
- Lives in: `lib/services/receipt_ocr_service.dart`, `lib/models/receipt_extraction.dart`,
  `docs/RECEIPT_OCR_GUIDE.md`, ADR-0023.
- Answer (say the line): "OCR extracts the reference number from the uploaded
  screenshot on the Admin's device at review time (ADR-0023) — that is why it runs on
  the Admin app, not the Guest's. PayMongo QR was the lecture's first recommendation
  but the later walkthrough dropped it for manual logs + OCR; we built the final
  instruction."

## 5. UI/UX standards & feature hygiene

**Q: "What design standard did you follow, and is it usable by non-technical users?"**

- Quotes: *"dapat kahit Bobo ay naiintindihan"*; *"Flatter Daily... gayahin niyo 'yung
  sa iOS..."*
- Lives in: the project's own design system — `docs/UI_UX_AUDIT.md`,
  `docs/WEB_INTERFACE_GUIDELINES_REVIEW.md`, `docs/ADMIN_UI_REDESIGN.md`,
  `docs/GUEST_UI_REDESIGN_PLAN.md`; typography/vocabulary in `docs/ACCOUNT.md`.
- Answer (say the line): "The lecture named a TikTok benchmark ('Daily Flutter UI');
  in practice we built and documented our own consistent design system — the audit
  and redesign docs are the standard, and the glossary in ACCOUNT.md keeps language
  plain for non-technical users."

**Q: "Why were there dead toggles / unlinked buttons on the admin screens?"**

- Quotes: *"alert on tag... toggle lang wala lang kwenta tanggali tanggali"*;
  *"pwedeng replyan... H'wag na... Tanggalin mo 'yan."*
- Lives in: no "Alert on Tag"/indoor-alert toggle anywhere in `lib/ src/` (removed);
  Admin review replies exist only as a **private** response, never on the public
  review — ADR-0014, `docs/REVIEWS.md`.
- Answer: "Dead controls were stripped — the alert toggle has no trace in the code.
  Review replies were removed from the public review UI; the Admin keeps a private
  response channel instead (ADR-0014)."

---

## If the panel asks "did you follow the meetings?"

Point at [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md): every MUST from
both recordings is implemented; the four documented deviations (anonymous sign-in,
manual payments per the *later* recording, simulated IoT pipeline, private review
replies) each have an ADR. The chronology table there shows `elmar10202.mp3` (lecture)
vs. `2026_10_09_18_34_31.mp3` (walkthrough) and which one the repo follows where they
differ.
