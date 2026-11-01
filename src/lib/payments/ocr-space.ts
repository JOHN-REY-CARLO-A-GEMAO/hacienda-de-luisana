// ----------------------------------------------------------------------------
// The browser's half of the OCR.space read (ADR-0024).
//
// The engine is not here: `functions/src/ocr.ts` holds the key and talks to
// OCR.space. This module does the two things that must happen on the Guest's
// device before the image is worth sending —
//
//   1. **Shrink it.** The free plan refuses anything over 1 MB, and a modern
//      phone screenshot is routinely 1.5–4 MB. A receipt is text on a flat
//      background, so a screenshot scaled to a 1800-pixel long edge and encoded
//      as JPEG at ~0.7 quality stays legible and lands far below the cap.
//   2. **Encode it.** Base64, from the same bytes that were uploaded to the
//      private bucket, so what the Admin reviews is what was read.
//
// Nothing else changes: the text comes back to `extractReceiptFields` in
// `ocr.ts`, the Guest still confirms or corrects every field, and no extraction
// can verify a payment (`canAutoVerifyFromOcr()` is still hard-coded off).
//
// If this module cannot produce a payload — no `createImageBitmap` (the test
// environment, an old browser), a format OCR.space does not take, a file too
// large to shrink — it throws `CloudOcrUnavailableError` and `runReceiptOcr`
// falls back to tesseract.js. A Guest is never left without an engine.
// ----------------------------------------------------------------------------

import { httpsCallable } from 'firebase/functions'
import { functionsClient } from '../functionsClient'

/**
 * The free plan's per-file limit. `functions/src/ocr.ts` refuses above this too;
 * the cap is enforced on both sides so neither has to trust the other.
 */
export const OCR_SPACE_MAX_BYTES = 1_000_000

/** Long edge after resizing. A receipt is a column of text; 1800 px keeps it sharp. */
const MAX_EDGE = 1800

/** Tried in order until one lands under the cap. Lower quality is better than no read. */
const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42]

/**
 * Types OCR.space accepts when the file comes through unresized. `image/webp` is
 * absent on purpose — the resize path re-encodes it, and an unresized WebP is
 * not something to send and hope about.
 */
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/tiff',
])

export type ReceiptImagePayload = { image: string; mimeType: string }

/** Why a cloud read did not happen, so the caller can decide whether to retry. */
export type CloudOcrFailure =
  | 'not-an-image'
  | 'image-too-large'
  | 'image-unreadable'
  | 'callable-unavailable'
  | 'callable-refused'

export class CloudOcrUnavailableError extends Error {
  constructor(readonly reason: CloudOcrFailure) {
    super(`OCR.space read unavailable: ${reason}`)
    this.name = 'CloudOcrUnavailableError'
  }
}

/**
 * The build-time switch, as a pure function so a test can hand it an object.
 *
 * Only the literal value `ocrspace` turns the cloud read on. That is deliberate:
 * a deployment that does not set `VITE_RECEIPT_OCR_CLOUD` keeps reading receipts
 * exactly where it always did — in the browser, with nothing leaving the device.
 */
export function cloudReceiptOcrEnabled(env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>): boolean {
  const raw = env.VITE_RECEIPT_OCR_CLOUD
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'ocrspace'
}

/** Strip jsdom/older-Safari-proof way of encoding bytes: FileReader, then base64 without the data URL. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that screenshot.'))
    reader.readAsDataURL(blob)
  })
}

function canResize(): boolean {
  return typeof createImageBitmap === 'function' && typeof document !== 'undefined'
}

/**
 * Decode, scale and re-encode to JPEG under the cap, or `null` when this browser
 * cannot do it (no `createImageBitmap`, no 2D context) — the caller then tries
 * the file as it is.
 */
async function shrinkToJpeg(file: File): Promise<Blob | null> {
  if (!canResize()) return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    if (!longest) return null
    const scale = Math.min(1, MAX_EDGE / longest)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of JPEG_QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((result) => resolve(result), 'image/jpeg', quality)
        } catch {
          resolve(null)
        }
      })
      if (blob && blob.size > 0 && blob.size <= OCR_SPACE_MAX_BYTES) return blob
    }
    return null
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}

/**
 * The bytes one OCR.space read will carry, or an error explaining why there are
 * none. Exported so a test can assert the cap and the type rules without
 * touching Firebase.
 */
export async function prepareReceiptImage(file: File): Promise<ReceiptImagePayload> {
  if (!file.type.startsWith('image/')) throw new CloudOcrUnavailableError('not-an-image')

  const resized = await shrinkToJpeg(file)
  if (resized) return { image: await blobToBase64(resized), mimeType: 'image/jpeg' }

  const mimeType = file.type.trim().toLowerCase()
  if (!ACCEPTED_IMAGE_TYPES.has(mimeType)) throw new CloudOcrUnavailableError('image-unreadable')
  if (file.size > OCR_SPACE_MAX_BYTES) throw new CloudOcrUnavailableError('image-too-large')
  if (file.size === 0) throw new CloudOcrUnavailableError('image-unreadable')

  const image = await blobToBase64(file)
  if (!image) throw new CloudOcrUnavailableError('image-unreadable')
  return { image, mimeType }
}

type ReceiptTextReply = { text?: unknown }

/** The `code` on a Firebase callable failure, without `functions/` in front. */
function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code.replace(/^functions\//, '')
  }
  return 'unavailable'
}

/**
 * Ask the callable to read one receipt and return the text it read.
 *
 * Falls back to the browser engine for every failure the Guest should not have
 * to understand: a deployment without the key (`failed-precondition`), a callable
 * that was never deployed (`unimplemented`/`not-found`), an offline phone, a
 * monthly quota spent (`resource-exhausted`). All of them throw
 * `CloudOcrUnavailableError`; `runReceiptOcr` catches it and tries tesseract.
 */
export async function readReceiptTextWithOcrSpace(file: File): Promise<string> {
  const payload = await prepareReceiptImage(file)
  try {
    const reply = await httpsCallable<ReceiptImagePayload, ReceiptTextReply>(
      functionsClient(),
      'readReceiptText',
    )(payload)
    return typeof reply.data?.text === 'string' ? reply.data.text : ''
  } catch (error) {
    const code = failureCode(error)
    throw new CloudOcrUnavailableError(
      code === 'failed-precondition' || code === 'unimplemented' || code === 'not-found'
        ? 'callable-refused'
        : 'callable-unavailable',
    )
  }
}
