// ----------------------------------------------------------------------------
// The KYC upload contract (pure — no Firebase, no browser APIs beyond a File's
// own three fields).
//
// Nothing here is invented. It is the web copy of what lib/services/
// kyc_storage.dart writes and what storage.rules allows, so a document uploaded
// from the website lands at the same address, with the same limits, as one
// uploaded from the mobile app — and the Host reviews both the same way.
// ----------------------------------------------------------------------------

/** The two documents the Host reviews: the government ID and its receipt. */
export type KycKind = 'id' | 'receipt'

/** storage.rules: `request.resource.size < 5 * 1024 * 1024`. */
export const KYC_MAX_BYTES = 5 * 1024 * 1024

/** The Dart app's extension allowlist — an extension outside it becomes jpg. */
export const KYC_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'] as const

export type KycFile = {
  name: string
  size: number
  /** The browser's declared MIME type; empty on some browsers. */
  type: string
}

export type KycValidation = { ok: true } | { ok: false; reason: 'too-large' | 'wrong-type'; message: string }

/** The filename's own extension, lowercased; '' when there is none. */
function rawExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/** Extension the Dart app would derive from this filename. */
function extOf(filename: string): string {
  const raw = rawExtension(filename)
  return (KYC_IMAGE_EXTENSIONS as readonly string[]).includes(raw) ? raw : 'jpg'
}


/**
 * Storage address for one document: `kyc/{uid}/{safeRef}/{kind}.{ext}`.
 *
 * `safeRef` keeps `[A-Za-z0-9-]` and uppercases, character for character the
 * Dart `_extOf`/`safeRef` pair. Two apps writing the same Booking must write the
 * same object, or a resubmission leaves a stale ID at the other address.
 */
export function kycObjectPath(input: {
  uid: string
  bookingRefId: string
  kind: KycKind
  filename: string
}): string {
  const safeRef = input.bookingRefId.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
  return `kyc/${input.uid}/${safeRef}/${input.kind}.${extOf(input.filename)}`
}

/** Content type to declare on the object, mirroring the Dart `_contentTypeFor`. */
export function kycContentType(filename: string): string {
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
 * The size test is `<`, not `<=`: lib/services/kyc_storage.dart checks
 * `bytes.length > maxBytes` and would let an exactly-5MB photo through only for
 * the rule to refuse it server-side. The rule is the authority here, so the web
 * predicts the same verdict the server will give.
 *
 * Type is taken from the browser when it declares one, and from the extension
 * only when it does not — an unlabelled but real photo should not be turned
 * away, while a PDF renamed .jpg is refused by the label the browser gave it.
 */
export function validateKycFile(file: KycFile): KycValidation {
  const declared = file.type.trim()
  const isImage = declared
    ? declared.startsWith('image/')
    : (KYC_IMAGE_EXTENSIONS as readonly string[]).includes(rawExtension(file.name))

  if (!isImage) {
    return {
      ok: false,
      reason: 'wrong-type',
      message: 'That is not an image. Please send a photo of your government ID.',
    }
  }
  if (file.size >= KYC_MAX_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      message: 'That file is too big — please send a photo under 5MB.',
    }
  }
  return { ok: true }
}
