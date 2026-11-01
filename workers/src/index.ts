/**
 * Cloudflare Worker host for the Hacienda booking callables.
 *
 * Firestore and Firebase Auth remain the systems of record. This Worker
 * implements Firebase's HTTPS callable protocol for four existing endpoint
 * names, verifies the caller's Firebase ID token itself, and delegates all
 * booking/money decisions to the shared core in `functions/src`.
 */

import { CallableError, type CallableCode, type CallableContext } from '../../functions/src/callable'
import { createAvailabilityCore, type AvailabilityReply, type SubmitBookingReply } from '../../functions/src/availabilityCore'
import { createQuotesCore, type QuoteBookingReply, type VerifyBookingMoneyReply } from '../../functions/src/quotesCore'
import { hasServiceAccountSecret, parseWorkerConfig, type Env, type WorkerConfig } from './env'
import { FirebaseTokenError, FirebaseTokenVerifier, type FirebaseIdTokenClaims } from './firebaseToken'
import { FirestoreRestClient, FirestoreRestError } from './firestoreRest'
import { GoogleAccessTokenProvider } from './googleAuth'
import { IdentityToolkitAuthUsers } from './identityToolkit'

const ENDPOINTS = ['bookingAvailability', 'submitBooking', 'quoteBooking', 'verifyBookingMoney'] as const
type EndpointName = (typeof ENDPOINTS)[number]
const ENDPOINT_SET = new Set<string>(ENDPOINTS)
const MAX_REQUEST_BYTES = 256 * 1024

export interface WorkerServices {
  bookingAvailability(context: CallableContext): Promise<AvailabilityReply>
  submitBooking(context: CallableContext): Promise<SubmitBookingReply>
  quoteBooking(context: CallableContext): Promise<QuoteBookingReply>
  verifyBookingMoney(context: CallableContext): Promise<VerifyBookingMoneyReply>
}

interface WorkerRuntime {
  config: WorkerConfig
  services: WorkerServices
  tokenVerifier: FirebaseTokenVerifier
}

let runtimeCache: { key: string; runtime: WorkerRuntime } | null = null

function runtimeCacheKey(config: WorkerConfig): string {
  return JSON.stringify({
    projectId: config.projectId,
    databaseId: config.databaseId,
    allowedOrigins: config.allowedOrigins,
    quotesEnabled: config.quotesEnabled,
    quoteTtlMinutes: config.quoteTtlMinutes,
    quoteLimitPerMinute: config.quoteLimitPerMinute,
    verifyLimitPerMinute: config.verifyLimitPerMinute,
    submitLimitPerMinute: config.submitLimitPerMinute,
    clientEmail: config.serviceAccount.clientEmail,
    privateKeyId: config.serviceAccount.privateKeyId ?? '',
    privateKeyLength: config.serviceAccount.privateKeyPem.length,
    privateKeyTail: config.serviceAccount.privateKeyPem.slice(-32),
  })
}

function getRuntime(env: Env): WorkerRuntime {
  const config = parseWorkerConfig(env)
  const key = runtimeCacheKey(config)
  if (runtimeCache?.key === key) return runtimeCache.runtime

  const tokenProvider = new GoogleAccessTokenProvider(config.serviceAccount)
  const db = new FirestoreRestClient(config.projectId, config.databaseId, tokenProvider)
  const availability = createAvailabilityCore({
    db,
    submitLimitPerMinute: config.submitLimitPerMinute,
  })
  const quotes = createQuotesCore({
    db,
    authUsers: new IdentityToolkitAuthUsers(config.projectId, tokenProvider),
    quotesEnabled: config.quotesEnabled,
    quoteTtlMinutes: config.quoteTtlMinutes,
    quoteLimitPerMinute: config.quoteLimitPerMinute,
    verifyLimitPerMinute: config.verifyLimitPerMinute,
  })

  const runtime: WorkerRuntime = {
    config,
    tokenVerifier: new FirebaseTokenVerifier(config.projectId),
    services: {
      bookingAvailability: availability.bookingAvailability,
      submitBooking: availability.submitBooking,
      quoteBooking: quotes.quoteBooking,
      verifyBookingMoney: quotes.verifyBookingMoney,
    },
  }
  runtimeCache = { key, runtime }
  return runtime
}

const HTTP_STATUS: Record<CallableCode, number> = {
  ok: 200,
  cancelled: 499,
  unknown: 500,
  'invalid-argument': 400,
  'deadline-exceeded': 504,
  'not-found': 404,
  'already-exists': 409,
  'permission-denied': 403,
  'resource-exhausted': 429,
  'failed-precondition': 400,
  aborted: 409,
  'out-of-range': 400,
  unimplemented: 501,
  internal: 500,
  unavailable: 503,
  'data-loss': 500,
  unauthenticated: 401,
}

function statusName(code: CallableCode): string {
  return code.replace(/-/g, '_').toUpperCase()
}

function jsonResponse(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers })
}

function errorResponse(error: CallableError, cors: Headers): Response {
  return jsonResponse({
    error: {
      message: error.message,
      status: statusName(error.code),
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  }, HTTP_STATUS[error.code], cors)
}

function corsHeaders(request: Request, allowedOrigins: readonly string[]): Headers | null {
  const origin = request.headers.get('Origin')
  const headers = new Headers()
  if (!origin) return headers
  if (allowedOrigins.includes('*')) {
    headers.set('Access-Control-Allow-Origin', '*')
    return headers
  }
  if (!allowedOrigins.includes(origin)) return null
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  return headers
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function decodeCallableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeCallableValue)
  if (!isPlainObject(value)) return value

  const type = value['@type']
  if ((type === 'type.googleapis.com/google.protobuf.Int64Value'
    || type === 'type.googleapis.com/google.protobuf.UInt64Value')
    && Object.keys(value).length === 2
    && (typeof value.value === 'string' || typeof value.value === 'number')) {
    try {
      const parsed = BigInt(String(value.value))
      return parsed >= BigInt(Number.MIN_SAFE_INTEGER) && parsed <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(parsed)
        : parsed
    } catch {
      return value
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodeCallableValue(entry)]),
  )
}

async function authenticatedUid(
  request: Request,
  verify: (token: string) => Promise<FirebaseIdTokenClaims>,
): Promise<string | null> {
  const authorization = request.headers.get('Authorization')
  if (authorization === null) return null
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(authorization)
  if (!match?.[1]) {
    throw new CallableError('unauthenticated', 'Request had invalid credentials.')
  }
  try {
    const claims = await verify(match[1])
    return claims.sub
  } catch (error) {
    if (error instanceof FirebaseTokenError && /signing keys/i.test(error.message)) {
      throw new CallableError('unavailable', 'Sign-in verification is temporarily unavailable. Please try again.')
    }
    throw new CallableError('unauthenticated', 'Request had invalid credentials.')
  }
}

function clientIp(request: Request): string | null {
  const cloudflareIp = request.headers.get('CF-Connecting-IP')?.trim()
  if (cloudflareIp) return cloudflareIp
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  return forwarded || null
}

export interface CallableHandlerDependencies {
  services: WorkerServices
  verifyIdToken(token: string): Promise<FirebaseIdTokenClaims>
  allowedOrigins: readonly string[]
}

export async function handleCallableRequest(
  request: Request,
  deps: CallableHandlerDependencies,
): Promise<Response> {
  const cors = corsHeaders(request, deps.allowedOrigins)
  if (cors === null) {
    return errorResponse(new CallableError('permission-denied', 'This origin may not call the Booking service.'), new Headers())
  }

  const endpoint = new URL(request.url).pathname.split('/').filter(Boolean).at(-1) ?? ''
  if (!ENDPOINT_SET.has(endpoint)) {
    return errorResponse(new CallableError('not-found', 'The requested Booking endpoint does not exist.'), cors)
  }

  if (request.method === 'OPTIONS') {
    const headers = new Headers(cors)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Firebase-Instance-ID-Token, X-Firebase-AppCheck')
    headers.set('Access-Control-Max-Age', '86400')
    headers.set('Vary', 'Origin, Access-Control-Request-Headers')
    return new Response(null, { status: 204, headers })
  }

  try {
    if (request.method !== 'POST') {
      throw new CallableError('unimplemented', 'Booking endpoints require POST.')
    }
    const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? ''
    if (!contentType.startsWith('application/json')) {
      throw new CallableError('invalid-argument', 'Booking endpoints require a JSON request.')
    }

    const authUid = await authenticatedUid(request, deps.verifyIdToken)
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      throw new CallableError('invalid-argument', 'The Booking request is too large.')
    }

    let body: unknown
    try {
      body = JSON.parse(text) as unknown
    } catch {
      throw new CallableError('invalid-argument', 'The Booking request is not valid JSON.')
    }
    if (!isPlainObject(body)) {
      throw new CallableError('invalid-argument', 'The Booking request is malformed.')
    }
    const keys = Object.keys(body)
    if (keys.length !== 1 || keys[0] !== 'data') {
      throw new CallableError('invalid-argument', 'The Booking request is malformed.')
    }

    const context: CallableContext = {
      authUid,
      data: decodeCallableValue(body.data),
      ip: clientIp(request),
    }
    const handler = deps.services[endpoint as EndpointName]
    const result = await handler(context)
    return jsonResponse({ result: result === undefined ? null : result }, 200, cors)
  } catch (error) {
    if (error instanceof CallableError) return errorResponse(error, cors)
    console.error(
      '[worker] unhandled callable failure',
      error instanceof Error ? error.name : 'unknown',
      error instanceof FirestoreRestError ? error.status : '',
    )
    return errorResponse(new CallableError('internal', 'INTERNAL'), cors)
  }
}

function configured(env: Env): boolean {
  if (!hasServiceAccountSecret(env)) return false
  try {
    parseWorkerConfig(env)
    return true
  } catch {
    return false
  }
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if ((pathname === '/' || pathname === '/health') && request.method === 'GET') {
    const ready = configured(env)
    return jsonResponse({
      ok: ready,
      service: 'hacienda-de-luisana-api',
      configured: ready,
      endpoints: ENDPOINTS,
    }, ready ? 200 : 503, new Headers())
  }

  let runtime: WorkerRuntime
  try {
    runtime = getRuntime(env)
  } catch (error) {
    console.error('[worker] configuration failure', error instanceof Error ? error.name : 'unknown')
    return errorResponse(new CallableError('internal', 'INTERNAL'), new Headers())
  }

  return handleCallableRequest(request, {
    services: runtime.services,
    verifyIdToken: (token) => runtime.tokenVerifier.verify(token),
    allowedOrigins: runtime.config.allowedOrigins,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env)
  },
}
