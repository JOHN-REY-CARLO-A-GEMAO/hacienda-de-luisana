# Paano nade-extract ang payment receipt papunta sa payment reference

Sagot sa tanong na: *"paano ko magagawa na ma-extract yung details ng payment receipt at mapunta
doon sa payment reference ng app?"*

**Maikling sagot:** nakagawa na ito. Nasa `src/lib/payments/ocr.ts` ang parser, at awtomatikong
tumatakbo pag pumili ka ng screenshot sa `/book/pay` (bagong booking) o sa `/account` (muling
pagpapadala ng proof). Napupunta ang nabasa sa `payment_reference` ng Booking, at pag na-verify ng
Admin, nagiging row sa `payment_references` collection.

Dalawang engine ang nagbabasa ng larawan (ADR-0024):

| Engine | Saan tumatakbo | Kailan gamit | Kailangan |
| --- | --- | --- | --- |
| **OCR.space** | Sa `readReceiptText` function, gamit ang `OCR_SPACE_API_KEY` | **Una**, kapag naka-set ang `VITE_RECEIPT_OCR_CLOUD=ocrspace` | Deployed na function + key; internet |
| **tesseract.js** | Sa browser ng Guest | Default, at fallback kapag bigo ang OCR.space | Internet sa unang pagbasa (dina-download ang engine) |

Pareho lang ang binabasa ng dalawa: PHP parser sa `src/lib/payments/ocr.ts` ang humahati ng text
sa reference, amount, sender at petsa. **Hindi nagbe-verify ang kahit alin sa kanila.**

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
        ↓  resize → JPEG ≤ 1 MB (ocr-space.ts)   ← kapag naka-on ang cloud read
        ↓  readReceiptText callable  →  OCR.space  (key sa function lang)
        ↓  kapag pumalya: tesseract.js sa browser — walang upload
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
  test/web/receipt-ocr-cloud.test.ts test/web/receipt-ocr-cloud-run.test.ts \
  --config vitest.local.config.ts
npm --prefix functions test  # kasama ang functions/test/ocr.test.ts (walang network)
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
> pagbasa ng larawan. Kailangan ng internet sa browser mo. Kung naka-on ang OCR.space
> (`VITE_RECEIPT_OCR_CLOUD=ocrspace`) at deployed ang function, hindi na umaabot sa download na
> iyon ang normal na daloy — pero nasa code pa rin ito bilang fallback. Ang parser tests, at ang
> buong functions suite, ay walang network call.

## 5. Ano ang sinasadyang hindi ginagawa

- **Hindi kailanman nagma-mark ng "paid"**. `canAutoVerifyFromOcr()` ay hard-coded na `false`.
  Ang Admin, na tumitingin sa screenshot, ang nagpapa-verify.
- **Walang API key sa browser.** Kapag naka-on ang OCR.space, ang key ay nasa `functions/.env`
  (hindi naka-commit) at ang browser ay tumatawag lang sa `readReceiptText`. Walang `VITE_*`
  variable na may key — kung meron, makikita ito ng kahit sinong nagbukas ng DevTools.
- **Walang iniimbak na larawan o text sa function.** Base64 papasok, text pabalik, tapos wala na.
  Ang log ay failure code lang — walang pangalan, numero, reference o OCR text.
- **Walang OCR sa Flutter admin app.** Ang mobile app ay Admin-only (ADR-0007/0008); ML Kit ang
  fallback nito sa device (ADR-0023), at hindi ito tumatawag sa `readReceiptText`.

### Ang privacy na kapalit ng bilis

Ang resibo ay may pangalan, numero at reference ng Guest. Kapag naka-on ang
`VITE_RECEIPT_OCR_CLOUD=ocrspace`, **lumalabas ito sa device at dumadaan sa OCR.space**. Iyon ang
presyo ng mabilis na pagbasa, at ito ang mitigasyon:

- Opt-in kada build: walang flag, walang ipinapadala — tesseract.js lang sa browser.
- Ang tanging tumatawag sa third party ay ang `readReceiptText` function. Walang ibang code path.
- Hindi iniimbak ng project na ito ang larawan o ang text; failure code lang ang naka-log.
- Nasa [terms ng OCR.space](https://ocr.space/ocrapi) ang retention nila — hindi natin kontrolado,
  kaya kailangang malaman ito bago i-on.

### Quota (libreng key)

| Limitasyon | Halaga | Bakit mahalaga |
| --- | --- | --- |
| Requests/buwan | 25,000 | Sapat para sa maliit na hacienda. |
| Requests/araw | 500 **kada IP** | Iisa ang egress IP ng function, kaya **hati ang buong site** sa 500/araw. |
| Laki ng file | 1 MB | Kayang i-resize ng browser pababa; refusal, hindi truncation, kapag lumagpas. |

Pag kulang, bumili ng PRO key ($30/buwan) at ilagay sa `OCR_SPACE_ENDPOINT` + `OCR_SPACE_API_KEY`.
Kapag naubos ang quota, `resource-exhausted` ang sagot ng function at tesseract.js ang gagamitin —
hindi tumitigil ang booking.

## 5b. Paano i-on ang OCR.space

```bash
# 1. Kunin ang libreng key: https://ocr.space/ocrapi/freekey
cp functions/.env.example functions/.env    # gitignored
#    ilagay ang OCR_SPACE_API_KEY=... sa functions/.env

# 2. I-deploy ang function (kailangan ito; kung wala, tesseract ang gagamitin)
firebase deploy --only functions:readReceiptText

# 3. Sabihin sa website na unahin ang cloud read, tapos i-redeploy
#    Vercel → Settings → Environment Variables (o .env.local sa dev)
VITE_RECEIPT_OCR_CLOUD=ocrspace
```

Walang key o walang deploy? Walang problema: `failed-precondition` ang isasagot ng function at
tahimik na babalik sa tesseract.js. Ganito rin ang dev build — kaya walang network call ang tests.

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
| `src/lib/payments/ocr-space.ts` | Bagong (ADR-0024): ginagawang ≤ 1 MB JPEG ang screenshot, ipinapadala sa `readReceiptText`, at ginagawang `CloudOcrUnavailableError` ang bawat refusal para may fallback. |
| `functions/src/ocr.ts` | Bagong (ADR-0024): ang `readReceiptText` callable — nagbabasa ng `OCR_SPACE_API_KEY`, nagpapadala sa OCR.space, may 1 MB cap at per-Guest/IP na rate limit. Walang iniimbak, walang ini-log na text. |
| `test/web/receipt-ocr.test.ts`, `receipt-amounts.test.ts`, `receipt-preview.test.ts` | Mga test para sa OCR at field mapping. |
| `test/web/receipt-ocr-cloud.test.ts`, `receipt-ocr-cloud-run.test.ts`, `functions/test/ocr.test.ts` | Bagong: ano ang lumalabas sa device, kailan tumatakbo ang bawat engine, at ang error mapping ng callable. |

## 8. Kung gusto mong ilagay din ito sa Flutter app

May ML Kit na ito sa device (ADR-0023) para sa kasong hindi mabasa ng website: proof na luma, browser
na hindi naka-load ang engine, o muling pinadalang proof. Kung gusto mong **OCR.space din sa admin
app**, posible na — nandoon na ang `readReceiptText` callable — pero kailangan muna ng Admin-only na
auth check sa function (hindi puwedeng pampublikong callable para sa admin path) at ng bagong
`https` client sa Dart. Bago gawin iyon, sagutin muna: **sino ang mag-e-extract?**

- Kung **Guest**, website na ang tamang lugar — nandoon na, at libre (browser engine) o mabilis
  (OCR.space kapag naka-on).
- Kung **Admin**, may ML Kit na sa device: libre, walang key, at hindi lumalabas ang resibo. Ang
  kulang lang doon ay editing UI, hindi bagong engine.
