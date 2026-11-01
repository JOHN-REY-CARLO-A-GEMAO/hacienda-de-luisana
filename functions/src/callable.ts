/**
 * Platform-neutral callable boundary shared by Firebase Cloud Functions and
 * the Cloudflare Worker port.
 *
 * The money/availability rules do not know which hosting runtime received the
 * request. They only receive the authenticated UID (when present), the JSON
 * body, and a best-effort client IP, and they fail with a named callable code.
 * Runtime adapters translate `CallableError` into `HttpsError` (Firebase) or
 * the JSON callable protocol (Cloudflare Workers).
 */

export type CallableCode =
  | 'ok'
  | 'cancelled'
  | 'unknown'
  | 'invalid-argument'
  | 'deadline-exceeded'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'out-of-range'
  | 'unimplemented'
  | 'internal'
  | 'unavailable'
  | 'data-loss'
  | 'unauthenticated'

export class CallableError extends Error {
  readonly code: CallableCode
  readonly details?: unknown

  constructor(code: CallableCode, message: string, details?: unknown) {
    super(message)
    this.name = 'CallableError'
    this.code = code
    this.details = details
  }
}

export interface CallableContext {
  /** Verified Firebase UID, or null for a deliberately public callable. */
  authUid?: string | null
  /** Decoded JSON body (`data` in the Firebase callable protocol). */
  data: unknown
  /** Best-effort client IP for public-read rate limiting. */
  ip?: string | null
}
