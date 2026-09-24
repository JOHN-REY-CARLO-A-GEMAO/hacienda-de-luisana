// ----------------------------------------------------------------------------
// Uploading a Guest's KYC documents from the website.
//
// Firebase Storage is the only place an ID goes. This module deliberately does
// not fall back to a data URL, localStorage or IndexedDB when there is no
// Firebase project: a government ID is PII under RA 10173, and quietly parking
// it in a browser the Admin can never read would both strand the Booking and put
// the document somewhere nobody is looking after it. With no Firebase the Guest
// is told the truth and given the two routes that do work.
// ----------------------------------------------------------------------------
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { BUSINESS } from '../../config/site'
import { storage } from '../firebase'
import { ensureGuestUid } from '../guestAuth'
import { kycContentType, kycObjectPath, validateKycFile, type KycKind } from './contract'

export type KycUploadFailureReason = 'too-large' | 'wrong-type' | 'unconfigured' | 'failed'

export type KycUploadOutcome =
  | { ok: true; url: string; uid: string }
  | { ok: false; reason: KycUploadFailureReason; message: string }

/** Shown where an upload control would be, when there is no Firebase to upload to. */
export const KYC_UPLOAD_UNAVAILABLE_MESSAGE =
  `This website has no Firebase project connected, so there is nowhere to put an ID ` +
  `and we will not keep one in your browser. Send it from the Hacienda de LuisAna ` +
  `mobile app, or email it to ${BUSINESS.contact.email}.`

/**
 * How long one upload may run before the UI stops waiting for it.
 *
 * A stalled connection can leave the Storage promise unsettled forever, which
 * used to stick the form on "Uploading…" with no way out. Racing the upload
 * against this timeout unblocks the Guest with words and a next step; a late
 * upload that lands afterwards is harmless (same address, same contents).
 */
const UPLOAD_TIMEOUT_MS = 60_000

async function uploadWithTimeout(target: ReturnType<typeof ref>, file: File, contentType: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      uploadBytes(target, file, { contentType }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('upload-timeout')), UPLOAD_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Uploads one document and returns the Storage download URL to record on the
 * Booking — the same value `kyc_id_url`/`kyc_receipt_url` already carry from the
 * mobile app, so the Admin app reviews both alike.
 *
 * Writes under the Guest's own anonymous uid: storage.rules allows a write only
 * where `request.auth.uid == userId`, which is why `ensureGuestUid()` runs first.
 */
export async function uploadKycDocument(input: {
  file: File
  bookingRefId: string
  kind: KycKind
}): Promise<KycUploadOutcome> {
  const check = validateKycFile({ name: input.file.name, size: input.file.size, type: input.file.type })
  if (!check.ok) return check

  const uid = await ensureGuestUid()
  if (!uid || !storage) {
    return { ok: false, reason: 'unconfigured', message: KYC_UPLOAD_UNAVAILABLE_MESSAGE }
  }

  const path = kycObjectPath({
    uid,
    bookingRefId: input.bookingRefId,
    kind: input.kind,
    filename: input.file.name,
  })
  const target = ref(storage, path)

  try {
    await uploadWithTimeout(target, input.file, kycContentType(input.file.name))
    return { ok: true, url: await getDownloadURL(target), uid }
  } catch (e) {
    console.warn(`[KYC] upload failed (${input.kind})`, e)
    const stalled = e instanceof Error && e.message === 'upload-timeout'
    return {
      ok: false,
      reason: 'failed',
      message: stalled
        ? 'That upload is taking too long — your connection may have stalled. Please try again ' +
          'on a steadier connection, with a smaller photo, ' +
          `or email it to ${BUSINESS.contact.email}.`
        : 'That upload did not go through. Please check your connection and try again, ' +
          `or email the photo to ${BUSINESS.contact.email}.`,
    }
  }
}
