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

Deterministic ang document id (`paymentReferenceDocId()` sa web, `_recordPaymentReference()` sa
Dart), kaya hindi ito ma-doble kahit dalawang Admin ang mag-verify nang sabay.

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
- **Walang OCR sa Flutter admin app.** Ang mobile app ay Admin-only (ADR-0007/0008); wala itong
  Tesseract at hindi nito kailangan: ang Guest sa website ang nag-e-extract, at ang admin ang
  nagbe-verify sa pamamagitan ng pagtingin sa proof at sa `ocr_*` fields.

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
| `lib/views/bookings/payment_verification_queue_screen.dart` | Admin verification, at ang pagsulat ng `payment_references` row. |
| `lib/views/payments/payment_refs_screen.dart` | Admin listahan ng references; dito nakikita at naitatama ang extraction. |
| `test/web/receipt-ocr.test.ts`, `receipt-amounts.test.ts`, `receipt-preview.test.ts` | Mga test para sa OCR at field mapping. |

## 8. Kung gusto mong ilagay din ito sa Flutter app

Hindi kasama ngayon, at may dahilan. Kailangan ng OCR package (`google_mlkit_text_recognition`) sa
device, o isang server function na may Vision API key — parehong bagong dependency at bagong
paggastos. Bago gawin iyon, sagutin muna: **sino ang mag-e-extract?**

- Kung **Guest**, website na ang tamang lugar — nandoon na, at libre (browser engine).
- Kung **Admin**, hindi kailangan ng OCR: nakikita na niya ang larawan at ang `ocr_*` fields. Ang
  kulang lang doon ay editing UI, hindi bagong engine.
