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

/**
 * One-line, operator-facing description of an upstream failure.
 *
 * Server logs need more than an error class name when Google rejects a call:
 * `FirestoreRestError` alone cannot distinguish `PERMISSION_DENIED` from a
 * missing index. Include the machine-readable status/HTTP code when a
 * transport supplies them, flatten and cap the message, and redact bearer
 * tokens if an upstream ever echoes one. Request bodies and headers are not
 * included.
 */
export function describeErrorForLog(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'

  const record = error as { status?: unknown; httpStatus?: unknown }
  const statusParts: string[] = []
  if (typeof record.status === 'string' && record.status) statusParts.push(record.status)
  if (typeof record.httpStatus === 'number') statusParts.push(`HTTP ${record.httpStatus}`)
  const status = statusParts.length > 0 ? ` [${statusParts.join(' ')}]` : ''

  const flattened = error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  const message = flattened.length > 600 ? `${flattened.slice(0, 597)}...` : flattened
  return `${error.name}${status}${message ? `: ${message}` : ''}`
}
