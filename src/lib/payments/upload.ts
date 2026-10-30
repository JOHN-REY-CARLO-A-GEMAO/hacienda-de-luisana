// ------------------------------------------------------------------------------
// Uploading a Guest's payment proof from the website.
//
// The bytes go to Supabase Storage's `payment-proofs` bucket (ADR-0011) and the
// caller records the returned **file path** on the Booking as `paymentProofUrl`
// (and its snake_case twin `payment_proof_url`) — a path the Admin can read
// straight from the API, not a signed URL that expires mid-review. With no
// Supabase keys the upload falls back to this browser's own storage (demo mode),
// exactly as the rest of the site does for Firebase; it never silently pretends
// a receipt reached the Hacienda.
// ------------------------------------------------------------------------------
import { ensureGuestUid } from '../guestAuth'
import { uploadPaymentProofFile } from '../storage'
import { proofObjectPath, validateProofFile } from './contract'

export type ProofUploadFailureReason = 'too-large' | 'wrong-type' | 'failed'

export type ProofUploadOutcome =
  | { ok: true; url: string; uid: string }
  | { ok: false; reason: ProofUploadFailureReason; message: string }

/**
 * Uploads one payment proof and returns the storage **path** to record on the
 * Booking as `payment_proof_url` / `paymentProofUrl` (ADR-0011).
 *
 * The path is keyed under the Guest's own anonymous uid when there is one —
 * `ensureGuestUid()` first, falling back to `demo` when the site runs without
 * Firebase — so a proof stays tied to the identity the Booking was created
 * with (ADR-0004).
 */
export async function uploadPaymentProof(input: {
  file: File
  bookingRefId: string
  /** Which upload this is for this Booking; 1 for the first. */
  attempt?: number
}): Promise<ProofUploadOutcome> {
  const check = validateProofFile({ name: input.file.name, size: input.file.size, type: input.file.type })
  if (!check.ok) return check

  // This nonce is independent of the retry counter. If the object upload
  // succeeds but the Booking write fails, the next click must not target the
  // orphaned object: Supabase intentionally forbids overwrites. Refuse the
  // upload rather than fall back to a predictable or non-cryptographic id.
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID !== 'function') {
    return {
      ok: false,
      reason: 'failed',
      message: 'This browser cannot create a secure upload ID. Please update your browser and try again.',
    }
  }
  let uploadId: string
  try {
    uploadId = randomUUID.call(globalThis.crypto)
  } catch {
    return {
      ok: false,
      reason: 'failed',
      message: 'A secure upload ID could not be created. Please try again.',
    }
  }

  const uid = (await ensureGuestUid().catch(() => null)) || 'demo'

  const path = proofObjectPath({
    uid,
    bookingRefId: input.bookingRefId,
    filename: input.file.name,
    attempt: input.attempt ?? 1,
    uploadId,
  })

  const stored = await uploadPaymentProofFile({ file: input.file, path })
  if (!stored.ok) {
    return { ok: false, reason: 'failed', message: stored.message }
  }
  return { ok: true, url: stored.path, uid }
}
