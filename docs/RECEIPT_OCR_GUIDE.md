# Paano nade-extract ang payment receipt papunta sa payment reference

Sagot sa tanong na: *"paano ko magagawa na ma-extract yung details ng payment receipt at mapunta
doon sa payment reference ng app?"*

**Maikling sagot:** nakagawa na ito. Nasa `src/lib/payments/ocr.ts` ang engine, at awtomatikong
tumatakbo pag pumili ka ng screenshot sa `/book/pay` (bagong booking) o sa `/account` (muling
pagpapadala ng proof). Napupunta ang nabasa sa `payment_reference` ng Booking, at pag na-verify ng
Admin, nagiging row sa `payment_references` collection.

Makikita at makokorek ang mga nabasang detalye sa mga payment proof form. Inalis na ang
standalone receipt-reader page; nananatili ang OCR sa booking at account flows.

---

## 1. Saan mo makikita

| Saan | Kailan tumatakbo | Ano ang nangyayari |
| --- | --- | --- |
| **`/book/pay`** (`DownpaymentPage.tsx`) | Pag pumili ka ng screenshot bago mag-submit ng booking | Automatic na pinupuno ang **Reference** at **Amount you sent**; may note kapag dalawa ang amount sa resibo. |
| **`/account` → Pay and send proof** (`PaymentStep.tsx`) | Pag nag-upload ka ng proof sa booking na aprubado na | Pinupuno ang **Reference**, **Amount**, **Sender**, **Date** — lahat pwedeng i-correct bago i-submit. |
| **Admin app (Flutter)** | Pag binuksan ng Admin ang proof | Ipinapakita ang `ocr_*` values bilang `(OCR)` kapag walang na-type ang Guest. |

## 2. Ang buong daloy

```
screenshot (Guest's browser)
        ↓  tesseract.js  — tumatakbo sa browser, walang upload
   OCR text
        ↓  ocr.ts: extractReceiptFields()
   { reference, amounts[], senderName, paymentDate, paymentDateIso, confidence, notes }
        ↓  Guest confirms / corrects (OCR is only a hint)
   Booking document
        ↓  Admin verification (Flutter app)
   payment_references/{reference}_{booking_id}
```

### Ang field mapping

| Nakita sa resibo | Form field | Booking field (confirmed) | Evidence copy | Binabasa ng Admin sa |
| --- | --- | --- | --- | --- |
| Reference no. | Reference number | `payment_reference` | `ocr_reference` | Payment references |
| Amount | Amount you sent | `amount_claimed` | `ocr_amount` | Verification queue |
| Sender | Sender on the receipt | `payment_sender_name` | `ocr_sender_name` | Verification queue |
| Petsa | Date on the receipt | `payment_date` (YYYY-MM-DD) | `ocr_payment_date` | Verification queue |
| Ang larawan | — | `payment_proof_url` (Supabase Storage path) | — | Proof viewer (60-second signed URL) |

Dalawang kopya ang itinatago: ang **kinumpirma ng Guest** at ang **eksaktong nabasa mula sa
resibo**. Kaya kahit i-correct ng Guest ang mali ng OCR, nakikita pa rin ng Admin ang totoong
sinasabi ng resibo.

Pag na-verify, isinusulat ng admin app ang:

```
payment_references/{reference}_{booking_id}
  reference, amount, status: "verified", booking_id,
  sender_name, payment_date, proof_url, created_at
```

Deterministic ang document id (`paymentReferenceDocId()` sa web at sa Dart), kaya hindi ito
ma-doble kahit dalawang Admin ang mag-verify nang sabay. Sa Dart, isinusulat ito ng
`PaymentReferenceService.recordVerifiedBookingReference()` — at tinatawag ito ng
`FirestoreService.applyBookingAction` para sa **bawat** approval (Approve at Verify Payment),
kahit taga-Booking detail screen, taga-Bookings list, o taga-verification queue. Bago nito, nasa
verification queue lang ang pagsulat, kaya umiiwal ang Payment references screen sa mga bayad
na na-verify na pala. Kung `ocr_reference` lamang ang may reference (walang taong kumumpirma),
`pending_review` ang status — hindi `verified`.

## 3. Ano ang nababasa ngayon

- **GCash / Maya / bank reference**: 10–13 digits. Kasama ang pinakamahirap na kaso — ang GCash
  "Express Send" na `7044 357 122304` na hinahati ng date column sa dalawang linya.
- **Amount**: lahat ng figure na may label (`Amount`, `Total Amount Sent`, `Total`, …). Kapag
  dalawa at hindi tugma (may fee), **hindi pipili ang app** — tatanungin ka kung alin ang ipinadala.
- **Sender**: kung may label (`From`, `Sender`, `Remitter`, `Account name`, `Sent by`). Hindi
  tinatanggap ang numero lang bilang pangalan.
- **Date**: `Aug 26, 2026`, `26/08/2026`, `2026-08-26`. Kapag ambiguous (`08/05/2026`), sinasabi
  nito at ikaw ang magkukumpirma.
- **Hindi tinatanggap**: 14–16 digit na card number, wala pang 10 digits, o walang label at hindi
  tugma sa format.

## 4. Paano i-test

```bash
npm install                 # kung wala pang node_modules
npx vitest run --config vitest.local.config.ts     # buong web suite (1190 tests)
npx vitest run test/web/receipt-ocr.test.ts test/web/receipt-preview.test.ts \
  --config vitest.local.config.ts
npm run dev                 # subukan ang screenshot sa payment proof form
```

Sample text na pwedeng gamitin sa OCR parser tests para makita ang mahirap na kaso:

```
Amount 1,020.00
Total Amount Sent 1,020.00
Ref No. 7044 357 Aug 26, 2026 10:23
122304 AM
```

Dapat lumabas ang `7044357122304` — iyon ang reference na pinagdugtong mula sa dalawang linya.

> **Note sa dev:** dina-download ng tesseract.js ang engine at English language data sa unang
> pagbasa ng larawan. Kailangan ng internet sa browser mo. Ang parser tests ay walang network call.

## 5. Ano ang sinasadyang hindi ginagawa

- **Hindi kailanman nagma-mark ng "paid"**. `canAutoVerifyFromOcr()` ay hard-coded na `false`.
  Ang Admin, na tumitingin sa screenshot, ang nagpapa-verify.
- **Walang cloud OCR call at walang upload ng larawan** para sa pagbasa. Sa browser lang.
- **Walang server-side OCR** — kaya walang API key na kailangang itago, at walang gastos.
- **Walang cloud OCR.** Mula 2026-10-29, **may on-device OCR na sa Flutter Admin app** gamit ang
  Google ML Kit (`lib/services/receipt_ocr_service.dart`, ADR-0023): binabasa nito ang proof kapag
  wala pang nagamit na `ocr_*` read ang website, o kapag pinili ng Admin ang "Basahin muli".
  Pribado, offline, at walang API key — hindi ito Tesseract at hindi ito server call. Ang pag-verify
  ay nananatiling desisyon ng Admin.

## 6. Kung may resibong hindi mabasa

1. Kunin ang **toong OCR text** mula sa isang ligtas na test fixture, at gamitin ito sa parser tests.
2. Kung mali ang pagkakabasa ng layout (halimbawa bagong template ng Maya o bank), dagdagan ang
   pattern sa `src/lib/payments/ocr.ts`:
   - reference → `REF_PATTERNS`, `REF_LABEL_RE`, `labelledGroups()`
   - amount → `extractReceiptAmounts()` (ang label list)
   - sender → `SENDER_LABEL_RE`
   - petsa → `PRINTED_DATE_RE`
3. Magdagdag ng test sa `test/web/receipt-ocr.test.ts` gamit ang tunay na text, bago baguhin ang
   code. Pinipigilan ng suite ang pagbabago ng dati nang gumagana (`reviewer: 38 tests`).
4. Kung mapapansin mong sumisipsip ang reference ng numero ng petsa o card, i-check ang
   `walkGroups()` — iyon ang nagsasala ng date column at ng 14+ digit na numero.

## 7. Mga file na dapat mong malaman

| File | Ano ang ginagawa |
| --- | --- |
| `src/lib/payments/ocr.ts` | Ang buong extraction engine (`runReceiptOcr`, `extractReceiptFields`, `extractReferenceNumber`, `extractSenderName`, `extractPaymentDate`, `claimAgainstReceipt`, `canAutoVerifyFromOcr`). |
| `src/lib/payments/receipt-preview.ts` | Bagong: isinasalin ang extraction sa "saang field napupunta" rows (`scanFields`, `unreadFields`, `scanVerdict`, `paymentReferenceDocId`). |
| `src/pages/DownpaymentPage.tsx` | OCR pag pumili ng screenshot sa bagong booking (`onFile`). |
| `src/components/Booking/PaymentStep.tsx` | OCR + pag-submit ng apat na field sa `/account`. |
| `lib/views/bookings/payment_verification_queue_screen.dart` | Admin verification ng nasa queue. |
| `lib/services/payment_reference_service.dart` | `recordVerifiedBookingReference()` — ang pagsulat ng `payment_references` row, at ang correction/OCR write. |
| `lib/views/payments/payment_refs_screen.dart` | Admin listahan ng references; dito nakikita at naitatama ang extraction. |
| `test/web/receipt-ocr.test.ts`, `receipt-amounts.test.ts`, `receipt-preview.test.ts` | Mga test para sa OCR at field mapping. |

## 8. Kung gusto mong ilagay din ito sa Flutter app

**Nailagay na ito** ng [ADR-0023](./adr/0023-receipt-ocr-on-the-admins-device.md) (2026-10-29):
`google_mlkit_text_recognition` sa device, walang server function at walang Vision API key. Ang
orihinal na dahilan ng seksyong ito — sino ang mag-e-extract — sinasagot na ng dalawang hakbang:
Guest sa browser (tesseract.js, libre) para sa bagong upload, at Admin sa device para sa lumang
proof o sa "Basahin muli". Parehong hint lang ang nabasa; ang pag-verify ay sa Admin pa rin.

## 9. Kapag hindi na-save ang binasa o ang manual reference

Kung nabasa ng ML Kit ang resibo (`Ref: 8159662488150`, `₱5000.00`) pero
`PaymentReferenceService._storeExtraction()` ay tinanggihan ng Firestore, **hindi** ito problema sa
parser kundi sa **na-deploy na `firestore.rules`** o sa **Admin identity**. Buong checklist nasa
[FIREBASE_SETUP.md § 4](./FIREBASE_SETUP.md) — "PERMISSION_DENIED when the Admin app saves
receipt evidence or a reference".

Mga dapat tandaan, dahil madalas magmungkahi ng generic na rule na hindi bagay dito:

- **Walang `users/{uid}` at walang `admin` custom claim** sa project na ito. Ang role ay
  `profiles/<uid>.role == "admin"` o isang **verified** na email sa `adminEmails()`.
- **`uid`** ang owner ng Booking (Guest), hindi `userId`; snake_case ang mga field
  (`payment_proof_url`, `ocr_*`), hindi `paymentProofUrl` / `ocrData` / `updatedAt`.
- **Huwag palitan ang `firestore.rules` ng `allow read, write: if isAdmin()`** — mabubura ang
  Guest, lifecycle at money invariants (ADR-0001/0012/0018).
- Ang pag-save ng read ay may sariling pintuan sa rules: `adminOcrEvidenceUpdate()`, Admin-only at
  **siyam na `ocr_*` key lamang** ang pweding magbago. Ang manual na pag-confirm/itama ay may
  hiwalay na `adminReferenceCorrectionUpdate()`: pitong reference/sender/date key lamang,
  `payment_reference_source == "admin_corrected"`, at sariling uid ang writer. Parehong hindi
  maaaring magbago ng `status`, `payment_status`, o `amount_verified`, kahit sa lumang Booking na
  `Reserved` na walang `verified` na `payment_status`.
- Sa refusal ng OCR man o manual save, inililimbag ang exception at stack trace; para sa
  permission denial, kasama ang uid/email/token claims ng writer. Hanapin ang
  `[PaymentReference]` o `[PaymentReference Save Error]` sa device log at ikumpara ang identity sa
  Authentication at `profiles/<uid>`. Ang pagbubukas/pagsara lang ng keyboard ay hindi katibayan
  na nakapagpadala na ng save request.

I-deploy mula sa commit na ito: `firebase deploy --only firestore:rules --project hacienda-de-luisana`,
pagkatapos ay i-verify ang email o ang Profile, at mag-sign out / sign in muli para ma-refresh ang
ID token. Patakbuhin ang `npm run test:rules` bago mag-deploy.
