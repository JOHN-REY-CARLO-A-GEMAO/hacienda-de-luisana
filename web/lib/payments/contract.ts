// ----------------------------------------------------------------------------
// The payment-proof upload contract (pure — no Firebase, no browser APIs
// beyond a File's own three fields).
//
// The proof is the Guest's claim that money sent outside the system (GCash /
// bank transfer, ADR-0001) arrived. It lands under /payments — never in the
// one address per Booking, so two Bookings can never share a document
// slot. The size limit mirrors storage.rules.
// ----------------------------------------------------------------------------

/** storage.rules: `request.resource.size < 5 * 1024 * 1024`. */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024

/** The extension allowlist — an extension outside it becomes jpg. */
export const PROOF_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'] as const

export type ProofFile = {
  name: string
  size: number
  /** The browser's declared MIME type; empty on some browsers. */
  type: string
}

export type ProofValidation = { ok: true } | { ok: false; reason: 'too-large' | 'wrong-type'; message: string }

/** The filename's own extension, lowercased; '' when there is none. */
function rawExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/** Extension derived from this filename. */
function extOf(filename: string): string {
  const raw = rawExtension(filename)
  return (PROOF_IMAGE_EXTENSIONS as readonly string[]).includes(raw) ? raw : 'jpg'
}

/**
 * Storage address for a payment proof: `payments/{uid}/{safeRef}/proof-{n}.{ext}`.
 *
 * `safeRef` keeps `[A-Za-z0-9-]` and uppercases, the sanitiser the legacy
 * contract uses, so one Booking's uploads land in one predictable folder.
 *
 * `attempt` is in the address because the object is **never** overwritten. A
 * re-send is a second object, not a replacement, for two reasons that both
 * matter:
 *
 *  - Supabase refuses an upsert. `upsert: true` sends
 *    `Prefer: resolution=merge-duplicates`, which evaluates the *update* policy
 *    alongside the insert one, and the `anon` role has no read grant here — so
 *    every upsert is refused with `42501 new row violates row-level security
 *    policy`, on a first upload as much as a re-send. Opening that would mean
 *    granting `anon` a `select` policy, which publishes every Guest's GCash
 *    receipt to the internet (see supabase/01-storage.sql). So the bytes are
 *    written once, to a name nobody has used.
 *  - `firestore.rules` only lets a Guest clear a `payment_reject_reason` by
 *    attaching a *different* `payment_proof_url` in the same write. A fixed
 *    address cannot satisfy that, so a re-send after a rejection is refused.
 *    A fresh address per attempt is what makes the resubmit loop work.
 *
 * Keeping the rejected proof also leaves the evidence: the Admin can see what
 * was first sent and what replaced it.
 */
export function proofObjectPath(input: {
  uid: string
  bookingRefId: string
  filename: string
  attempt: number
}): string {
  const safeRef = input.bookingRefId.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
  return `payments/${input.uid}/${safeRef}/proof-${input.attempt}.${extOf(input.filename)}`
}

/**
 * The attempt number a further upload for this Booking should use, read off the
 * path already recorded on it. A Booking with no proof yet starts at 1; a
 * legacy `proof.{ext}` path also starts at 1, which still differs from what is
 * already stored, which is what the rules require.
 */
export function nextProofAttempt(previousPath: string | null | undefined): number {
  if (!previousPath) return 1
  const last = previousPath.match(/proof-(\d+)\.[a-z0-9]+$/i)
  return last ? Number(last[1]) + 1 : 1
}

/** Content type to declare on the object. */
export function proofContentType(filename: string): string {
  switch (extOf(filename)) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'heic':
      return 'image/heic'
    default:
      return 'image/jpeg'
  }
}

/**
 * Pre-flight the same two limits storage.rules enforces, so a Guest learns a
 * file will not fit before the bytes leave their device.
 *
 * The size test is `<`, not `<=`: the rule is the authority, and an exactly
 * 5MB file is refused server-side.
 */
export function validateProofFile(file: ProofFile): ProofValidation {
  const declared = file.type.trim()
  const isImage = declared
    ? declared.startsWith('image/')
    : (PROOF_IMAGE_EXTENSIONS as readonly string[]).includes(rawExtension(file.name))

  if (!isImage) {
    return {
      ok: false,
      reason: 'wrong-type',
      message: 'That is not an image. Please send a photo or screenshot of your payment receipt.',
    }
  }
  if (file.size >= PROOF_MAX_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      message: 'That file is too big — please send a photo under 5MB.',
    }
  }
  return { ok: true }
}
