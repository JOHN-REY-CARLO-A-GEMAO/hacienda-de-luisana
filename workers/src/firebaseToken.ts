/**
 * Firebase ID-token verification without the Admin SDK.
 *
 * Signatures are verified against Google's published securetoken JWKS, then
 * the project audience, issuer, subject, expiry, issued-at, and auth-time
 * claims are checked. This mirrors Firebase's documented third-party JWT
 * verification contract for custom backends.
 */

import { base64UrlToBytes, base64UrlToString } from './encoding'
import { bindGlobalFetch } from './fetch'

const DEFAULT_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
const DEFAULT_CLOCK_SKEW_SECONDS = 300

export class FirebaseTokenError extends Error {
  constructor(message = 'The Firebase ID token is invalid.') {
    super(message)
    this.name = 'FirebaseTokenError'
  }
}

export interface FirebaseIdTokenClaims {
  sub: string
  aud: string
  iss: string
  iat: number
  exp: number
  auth_time?: number
  user_id?: string
  email?: string
  email_verified?: boolean
  firebase?: Record<string, unknown>
  [key: string]: unknown
}

interface JsonWebKeyWithKid extends JsonWebKey {
  kid?: string
}

export interface FirebaseTokenVerifierOptions {
  fetchFn?: typeof fetch
  now?: () => number
  jwksUrl?: string
  clockSkewSeconds?: number
}

function parseJsonSegment(segment: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(base64UrlToString(segment)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new FirebaseTokenError()
  }
}

function maxAgeSeconds(response: Response): number {
  const header = response.headers.get('Cache-Control') ?? ''
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(header)
  if (!match) return 300
  const seconds = Number(match[1])
  return Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 86_400) : 300
}

export class FirebaseTokenVerifier {
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly jwksUrl: string
  private readonly clockSkewSeconds: number
  private cachedKeys: { expiresAt: number; keys: Map<string, JsonWebKeyWithKid> } | null = null
  private pendingKeys: Promise<Map<string, JsonWebKeyWithKid>> | null = null

  constructor(
    private readonly projectId: string,
    options: FirebaseTokenVerifierOptions = {},
  ) {
    this.fetchFn = bindGlobalFetch(options.fetchFn)
    this.now = options.now ?? Date.now
    this.jwksUrl = options.jwksUrl ?? DEFAULT_JWKS_URL
    this.clockSkewSeconds = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
  }

  private async loadKeys(force = false): Promise<Map<string, JsonWebKeyWithKid>> {
    if (!force && this.cachedKeys && this.cachedKeys.expiresAt > this.now()) {
      return this.cachedKeys.keys
    }
    if (!force && this.pendingKeys) return this.pendingKeys

    const load = (async () => {
      const response = await this.fetchFn(this.jwksUrl)
      if (!response.ok) throw new FirebaseTokenError('Firebase signing keys could not be loaded.')
      const payload = (await response.json()) as { keys?: unknown }
      if (!Array.isArray(payload.keys)) throw new FirebaseTokenError('Firebase signing keys could not be loaded.')
      const keys = new Map<string, JsonWebKeyWithKid>()
      for (const candidate of payload.keys as JsonWebKeyWithKid[]) {
        if (candidate && candidate.kty === 'RSA' && typeof candidate.kid === 'string' && candidate.kid) {
          keys.set(candidate.kid, candidate)
        }
      }
      if (keys.size === 0) throw new FirebaseTokenError('Firebase signing keys could not be loaded.')
      this.cachedKeys = {
        keys,
        expiresAt: this.now() + maxAgeSeconds(response) * 1000,
      }
      return keys
    })()

    if (!force) {
      this.pendingKeys = load.finally(() => {
        this.pendingKeys = null
      })
      return this.pendingKeys
    }
    return load
  }

  private async keyFor(kid: string): Promise<CryptoKey> {
    let keys = await this.loadKeys()
    let jwk = keys.get(kid)
    if (!jwk) {
      keys = await this.loadKeys(true)
      jwk = keys.get(kid)
    }
    if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
      throw new FirebaseTokenError()
    }
    try {
      return await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      )
    } catch {
      throw new FirebaseTokenError()
    }
  }

  async verify(token: string): Promise<FirebaseIdTokenClaims> {
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some((part) => part === '')) {
      throw new FirebaseTokenError()
    }
    const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string]
    const header = parseJsonSegment(encodedHeader)
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      throw new FirebaseTokenError()
    }
    if (header.typ !== undefined && header.typ !== 'JWT') {
      throw new FirebaseTokenError()
    }

    const key = await this.keyFor(header.kid)
    let signatureValid = false
    try {
      signatureValid = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        base64UrlToBytes(encodedSignature),
        new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
      )
    } catch {
      throw new FirebaseTokenError()
    }
    if (!signatureValid) throw new FirebaseTokenError()

    const claims = parseJsonSegment(encodedClaims) as FirebaseIdTokenClaims
    const nowSeconds = Math.floor(this.now() / 1000)
    const skew = this.clockSkewSeconds
    const expectedIssuer = `https://securetoken.google.com/${this.projectId}`

    if (claims.aud !== this.projectId || claims.iss !== expectedIssuer) {
      throw new FirebaseTokenError()
    }
    if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub.length > 128) {
      throw new FirebaseTokenError()
    }
    if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > nowSeconds + skew) {
      throw new FirebaseTokenError()
    }
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds - skew) {
      throw new FirebaseTokenError()
    }
    if (claims.auth_time !== undefined
      && (typeof claims.auth_time !== 'number' || !Number.isFinite(claims.auth_time) || claims.auth_time > nowSeconds + skew)) {
      throw new FirebaseTokenError()
    }

    return claims
  }
}
