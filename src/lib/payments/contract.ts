// ----------------------------------------------------------------------------
// The payment-proof upload contract (pure — no Firebase, no browser APIs
// beyond a File's own three fields).
//
// The proof is the Guest's claim that money sent outside the system (GCash /
// bank transfer, ADR-0001) arrived. It lands under /payments — never in the
// KYC slot, so an ID review and a money review can never read each other's
// documents. Limits mirror storage.rules, the same way kyc/contract.ts does.
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
 * Storage address for a payment proof: `payments/{uid}/{safeRef}/proof.{ext}`.
 *
 * `safeRef` keeps `[A-Za-z0-9-]` and uppercases, the same sanitiser the KYC
 * contract uses, so one Booking's uploads land in one predictable folder.
 */
export function proofObjectPath(input: {
  uid: string
  bookingRefId: string
  filename: string
}): string {
  const safeRef = input.bookingRefId.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
  return `payments/${input.uid}/${safeRef}/proof.${extOf(input.filename)}`
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
