/**
 * One receipt, read by OCR.space, behind a callable (ADR-0024).
 *
 * The website has read payment screenshots in the Guest's browser with
 * tesseract.js since 2026-09-27 (`src/lib/payments/ocr.ts`). That engine is
 * free and private, but on a mid-range Android phone it is slow to start: the
 * first screenshot of a session downloads a worker, a WASM core and an English
 * model before the first line is read, and a receipt photographed at an angle
 * still comes back as noise. OCR.space reads the same screenshot in about a
 * second, on a server with a better model.
 *
 * This callable is that server, and it is the *only* thing in this project that
 * talks to a third party about a Guest's receipt. Everything that makes that
 * acceptable lives here rather than in the browser:
 *
 *  1. **The key never leaves the server.** `OCR_SPACE_API_KEY` is read from the
 *     function's own environment (`functions/.env`, gitignored, or the hosting
 *     dashboard). No `VITE_*` variable carries it, so it is not in the bundle,
 *     not in the APK and not in Git — `docs/VERIFICATION.md` § 6's rule.
 *  2. **Nothing is stored.** The image is base64 in the request, forwarded to
 *     OCR.space, and dropped. No log line contains the image, the OCR text or
 *     the Guest's reference; failures are logged by code only.
 *  3. **It reads; it never verifies.** The reply is text and nothing else. The
 *     parsing stays in `extractReceiptFields` (web) and
 *     `receipt_extraction.dart` (admin app), and `canAutoVerifyFromOcr()` is
 *     still hard-coded `false`.
 *  4. **It can be turned off without a rebuild.** No key means the callable
 *     refuses with `failed-precondition`, and the website quietly falls back to
 *     the on-device engine it already shipped.
 *
 * Limits that shape the code, from OCR.space's free plan: 1 MB per file,
 * 25,000 requests per month, and 500 requests per day *per IP* — and every
 * Guest's request leaves from this function's egress, so those 500 are shared.
 * A hacienda taking a handful of downpayments a day is nowhere near it; a PRO
 * key ($30/month) is the answer if it ever is, and `OCR_SPACE_ENDPOINT` already
 * accepts the PRO endpoint.
 *
 * DEPLOYMENT:
 *
 *   printf 'OCR_SPACE_API_KEY=your-key\n' > functions/.env
 *   firebase deploy --only functions:readReceiptText
 *
 * The key comes from https://ocr.space/ocrapi/freekey. Leave it out and the
 * website behaves exactly as it did before this file existed.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { MinuteBudget } from './pricing'
import { spendCallableQuota } from './rateLimit'

const options = {
  region: 'asia-southeast1',
  maxInstances: 3,
  memory: '256MiB' as const,
  timeoutSeconds: 60,
}

/**
 * The free plan's hard file limit. A screenshot that has to be squeezed under
 * this is resized in the browser (canvas → JPEG) before it is sent; a file that
 * is still too large is refused here rather than being truncated.
 */
export const MAX_RECEIPT_BYTES = 1_000_000

/** Base64 inflates by 4/3; this is the string length that corresponds to the byte cap. */
const MAX_BASE64_CHARS = Math.ceil(MAX_RECEIPT_BYTES / 3) * 4

/** A receipt is never this long; the cap is there so a hostile reply cannot fill memory. */
const MAX_TEXT_CHARS = 20_000

/**
 * Formats OCR.space documents support. `image/webp` is deliberately absent: the
 * browser re-encodes a screenshot to JPEG before it gets here, and a caller that
 * skips that step is not one this function wants to guess about.
 */
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/tiff',
])

const BASE64_ONLY = /^[A-Za-z0-9+/]+={0,2}$/

export type ReceiptImage = { image: string; mimeType: string }

export type OcrSpaceSettings = {
  apiKey: string
  endpoint: string
  language: string
  engine: string
}

/** Which failure a read ran into, as far as the caller is allowed to see. */
export type OcrSpaceFailure = 'quota' | 'unreachable' | 'malformed' | 'empty'

/** An OCR.space read that produced no text, with the reason kept server-side. */
export class OcrSpaceError extends Error {
  constructor(readonly reason: OcrSpaceFailure) {
    super(`OCR.space read failed: ${reason}`)
    this.name = 'OcrSpaceError'
  }
}

/**
 * The OCR.space configuration for this deployment, or `null` when nobody set a
 * key — in which case the callable refuses to run and the website uses its own
 * engine. Kept pure so the gating is testable without a Functions runtime.
 */
export function ocrSpaceSettings(env: NodeJS.ProcessEnv = process.env): OcrSpaceSettings | null {
  const apiKey = (env.OCR_SPACE_API_KEY ?? '').trim()
  if (!apiKey) return null
  const rawEngine = (env.OCR_SPACE_ENGINE ?? '').trim()
  const engine = rawEngine === '1' || rawEngine === '2' || rawEngine === '3' ? rawEngine : '2'
  const rawLanguage = (env.OCR_SPACE_LANGUAGE ?? '').trim().toLowerCase()
  // OCR.space languages are ISO 639-2 three-letter codes; anything else is a typo.
  const language = /^[a-z]{3}$/.test(rawLanguage) ? rawLanguage : 'eng'
  const endpoint = (env.OCR_SPACE_ENDPOINT ?? '').trim() || 'https://api.ocr.space/parse/image'
  return { apiKey, endpoint, language, engine }
}

/**
 * Validate the callable's payload: a base64 image and its declared type, or a
 * Guest-friendly refusal. Never echoes the payload back in the message.
 */
export function parseReceiptImageRequest(data: unknown): ReceiptImage {
  const body = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  const image = typeof body.image === 'string' ? body.image.trim() : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : ''

  if (!image || !mimeType) {
    throw new HttpsError('invalid-argument', 'Send the receipt as an image.')
  }
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
    throw new HttpsError('invalid-argument', 'That file type cannot be read. Send a JPG or PNG screenshot.')
  }
  if (image.length > MAX_BASE64_CHARS) {
    throw new HttpsError('invalid-argument', 'That screenshot is too large to read. Send a smaller image.')
  }
  // A data URL prefix means the caller skipped the shared encoder; accept it
  // rather than failing on a difference that does not matter.
  const bare = image.startsWith('data:') ? image.slice(image.indexOf(',') + 1) : image
  if (!bare || !BASE64_ONLY.test(bare)) {
    throw new HttpsError('invalid-argument', 'That receipt could not be read. Send a JPG or PNG screenshot.')
  }
  const bytes = Math.floor((bare.replace(/=+$/, '').length * 3) / 4)
  if (bytes < 64) {
    throw new HttpsError('invalid-argument', 'That receipt could not be read. Send a JPG or PNG screenshot.')
  }
  if (bytes > MAX_RECEIPT_BYTES) {
    throw new HttpsError('invalid-argument', 'That screenshot is too large to read. Send a smaller image.')
  }
  return { image: bare, mimeType }
}

/**
 * The form body OCR.space expects. `base64Image` takes the whole data URL, so
 * there is no multipart boundary to get wrong and no second copy of the bytes.
 */
export function ocrSpaceForm(image: ReceiptImage, settings: OcrSpaceSettings): URLSearchParams {
  return new URLSearchParams({
    apikey: settings.apiKey,
    base64Image: `data:${image.mimeType};base64,${image.image}`,
    language: settings.language,
    OCREngine: settings.engine,
    // A screenshot is already the right way up; asking OCR.space to detect it
    // costs time and occasionally rotates a receipt that was fine.
    detectOrientation: 'false',
    scale: 'true',
    isTable: 'false',
    isOverlayRequired: 'false',
  })
}

type OcrSpaceReply = {
  ParsedResults?: { ParsedText?: unknown }[]
  IsErroredOnProcessing?: unknown
  ErrorMessage?: unknown
  OCRExitCode?: unknown
}

/** The engine's own words, flattened and clipped — never shown to a Guest raw. */
export function ocrSpaceFailureText(reply: unknown): string {
  if (!reply || typeof reply !== 'object') return ''
  const body = reply as OcrSpaceReply
  const raw = body.ErrorMessage
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return parts
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .trim()
    .slice(0, 300)
}

/**
 * Turn an OCR.space reply into text, or say why there is none.
 *
 * Success is "the engine exited cleanly and returned a `ParsedResults` array".
 * An empty array is `empty` rather than an error: a blank screenshot is a Guest
 * problem, not a broken deployment, and the website shows a different message
 * for it.
 */
export function ocrSpaceText(reply: unknown): string {
  if (!reply || typeof reply !== 'object') throw new OcrSpaceError('malformed')
  const body = reply as OcrSpaceReply
  if (body.IsErroredOnProcessing === true) throw new OcrSpaceError('unreachable')
  const exit = typeof body.OCRExitCode === 'number' ? body.OCRExitCode : Number(body.OCRExitCode)
  if (Number.isFinite(exit) && exit >= 3) throw new OcrSpaceError('unreachable')
  if (!Array.isArray(body.ParsedResults)) throw new OcrSpaceError('malformed')
  const text = body.ParsedResults
    // Each page arrives with a trailing line break and CRLF endings. Trimming
    // per page and joining once keeps the reply identical to the text the
    // browser engine would have produced, so the parser sees no difference
    // between the two engines.
    .map((result) =>
      result && typeof result.ParsedText === 'string'
        ? result.ParsedText.replace(/\r\n?/g, '\n').trim()
        : '',
    )
    .filter((page) => page.length > 0)
    .join('\n')
    .trim()
  return text.slice(0, MAX_TEXT_CHARS)
}

const OCR_FETCH_TIMEOUT_MS = 40_000

/**
 * Post one receipt to OCR.space and return the text it read.
 *
 * `fetchImpl` is injectable so the request shape and the failure mapping can be
 * tested without a network — the Phase 0 suite runs inside a network namespace
 * where a real call would not merely be slow, it would fail.
 */
export async function callOcrSpace(
  image: ReceiptImage,
  settings: OcrSpaceSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(settings.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: ocrSpaceForm(image, settings).toString(),
      signal: AbortSignal.timeout(OCR_FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new OcrSpaceError('unreachable')
  }
  // The free plan answers 429 for both "slow down" and "the daily IP allowance
  // is spent"; both mean the Guest should be asked to type the details.
  if (response.status === 429) throw new OcrSpaceError('quota')
  if (!response.ok) throw new OcrSpaceError('unreachable')
  let reply: unknown
  try {
    reply = await response.json()
  } catch {
    throw new OcrSpaceError('malformed')
  }
  return ocrSpaceText(reply)
}

const rawLimit = Number(process.env.OCR_RATE_LIMIT_PER_MINUTE ?? 10)
const OCR_LIMIT_PER_MINUTE = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 120 ? rawLimit : 10

/** Per-instance brake before the Firestore bucket, same shape as the other callables. */
const ocrBudget = new MinuteBudget(OCR_LIMIT_PER_MINUTE)

let firestore: ReturnType<typeof getFirestore> | null = null
const db = () => (firestore ??= getFirestore())

/** UID when the Guest is signed in, IP otherwise — both are hashed by the limiter. */
function callerKey(request: CallableRequest): string {
  return request.auth?.uid || request.rawRequest?.ip || 'unknown-caller'
}

/**
 * Read one payment screenshot and return its text.
 *
 * Public on purpose: `/book/pay` is not behind a sign-in, so a Guest paying a
 * downpayment has no guaranteed UID. The ceiling and the 1 MB payload cap are
 * what keep an anonymous caller from spending the month's OCR allowance.
 */
export const readReceiptText = onCall(
  options,
  async (request: CallableRequest): Promise<{ text: string; engine: 'ocr.space'; language: string }> => {
    const settings = ocrSpaceSettings()
    if (!settings) {
      throw new HttpsError(
        'failed-precondition',
        'Receipt reading is not enabled on this deployment. Type the reference and amount from your receipt.',
      )
    }
    const image = parseReceiptImageRequest(request.data)
    await spendCallableQuota({
      firestore: db(),
      budget: ocrBudget,
      scope: 'readReceiptText',
      key: callerKey(request),
      limit: OCR_LIMIT_PER_MINUTE,
      label: 'receipt reading',
      formatMessage: (seconds) =>
        `Too many receipts were read at once. Wait ${seconds} seconds, or type the reference and amount yourself.`,
    })

    try {
      const text = await callOcrSpace(image, settings)
      return { text, engine: 'ocr.space', language: settings.language }
    } catch (error) {
      const reason = error instanceof OcrSpaceError ? error.reason : 'unreachable'
      // Reason only. The image, the text and the Guest's reference are never
      // logged — a receipt carries a name, a number and a payment reference.
      console.warn('[readReceiptText] OCR.space read failed', reason)
      if (reason === 'quota') {
        throw new HttpsError(
          'resource-exhausted',
          'Receipt reading is busy right now. Type the reference and amount from your receipt, or try again later.',
          { cause: 'OCR_QUOTA' },
        )
      }
      throw new HttpsError(
        'unavailable',
        'The receipt could not be read automatically. Type the reference and amount from your receipt.',
        { cause: reason === 'malformed' ? 'OCR_MALFORMED' : 'OCR_UNAVAILABLE' },
      )
    }
  },
)

/** Test seam: the per-instance budget outlives a test case otherwise. */
export function resetReceiptOcrRateLimit(): void {
  ocrBudget.reset()
}
