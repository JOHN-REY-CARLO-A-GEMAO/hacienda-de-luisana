// ----------------------------------------------------------------------------
// Uploading a Guest's payment proof from the website.
//
// Firebase Storage is the only place a proof goes. Like the KYC uploader, this
// module deliberately does not fall back to a data URL or localStorage when
// there is no Firebase project: a receipt parked in a browser the Host cannot
// read would strand the Booking in Payment Pending with nobody able to verify
// it. With no Firebase the Guest is told the truth and given the route that
// does work (email the receipt quoting the reference).
// ----------------------------------------------------------------------------
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { BUSINESS } from '../../config/site'
import { storage } from '../firebase'
import { ensureGuestUid } from '../guestAuth'
import { proofContentType, proofObjectPath, validateProofFile } from './contract'

export type ProofUploadFailureReason = 'too-large' | 'wrong-type' | 'unconfigured' | 'failed'

export type ProofUploadOutcome =
  | { ok: true; url: string; uid: string }
  | { ok: false; reason: ProofUploadFailureReason; message: string }

/** Shown where an upload control would be, when there is no Firebase to upload to. */
export const PROOF_UPLOAD_UNAVAILABLE_MESSAGE =
  `This website has no Firebase project connected, so there is nowhere to put a receipt ` +
  `and we will not keep one in your browser. Email a photo of it to ${BUSINESS.contact.email} ` +
  `quoting your booking reference, and the Host will verify it from there.`

/**
 * How long one upload may run before the UI stops waiting for it.
 *
 * A stalled connection can leave the Storage promise unsettled forever, which
 * sticks the form on "Uploading…" with no way out. Racing the upload against
 * this timeout unblocks the Guest with words and a next step instead.
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
 * Uploads one payment proof and returns the Storage download URL to record on
 * the Booking as `payment_proof_url`.
 *
 * Writes under the Guest's own anonymous uid: storage.rules allows a write only
 * where `request.auth.uid == userId`, which is why `ensureGuestUid()` runs first.
 */
export async function uploadPaymentProof(input: {
  file: File
  bookingRefId: string
}): Promise<ProofUploadOutcome> {
  const check = validateProofFile({ name: input.file.name, size: input.file.size, type: input.file.type })
  if (!check.ok) return check

  const uid = await ensureGuestUid()
  if (!uid || !storage) {
    return { ok: false, reason: 'unconfigured', message: PROOF_UPLOAD_UNAVAILABLE_MESSAGE }
  }

  const path = proofObjectPath({
    uid,
    bookingRefId: input.bookingRefId,
    filename: input.file.name,
  })
  const target = ref(storage, path)

  try {
    await uploadWithTimeout(target, input.file, proofContentType(input.file.name))
    return { ok: true, url: await getDownloadURL(target), uid }
  } catch (e) {
    console.warn('[Payments] upload failed', e)
    const stalled = e instanceof Error && e.message === 'upload-timeout'
    return {
      ok: false,
      reason: 'failed',
      message: stalled
        ? 'That upload is taking too long — your connection may have stalled. Please try again ' +
          'on a steadier connection, with a smaller photo, ' +
          `or email the receipt to ${BUSINESS.contact.email} quoting your booking reference.`
        : 'That upload did not go through. Please check your connection and try again, ' +
          `or email the receipt to ${BUSINESS.contact.email} quoting your booking reference.`,
    }
  }
}
