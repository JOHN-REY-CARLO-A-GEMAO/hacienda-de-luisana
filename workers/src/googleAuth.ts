/**
 * Google service-account OAuth for Firestore REST and Identity Toolkit.
 *
 * The Worker signs the standard JWT-bearer assertion with WebCrypto and
 * exchanges it at Google's token endpoint. The access token is cached only
 * in this isolate's memory and refreshed shortly before expiry.
 */

import { base64ToBytes, bytesToBase64Url, stringToBase64Url } from './encoding'
import type { ServiceAccountCredentials } from './env'
import { bindGlobalFetch } from './fetch'

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/identitytoolkit',
] as const

const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

export interface AccessTokenProvider {
  getAccessToken(forceRefresh?: boolean): Promise<string>
  invalidateAccessToken(): void
}

export interface GoogleAccessTokenProviderOptions {
  fetchFn?: typeof fetch
  now?: () => number
  tokenUrl?: string
  scopes?: readonly string[]
}

function pemToPkcs8(privateKeyPem: string): Uint8Array {
  const base64 = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  if (!base64) throw new Error('The service-account private key is empty.')
  return base64ToBytes(base64)
}

export class GoogleAccessTokenProvider implements AccessTokenProvider {
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly tokenUrl: string
  private readonly scopes: readonly string[]
  private signingKey: Promise<CryptoKey> | null = null
  private cached: { value: string; expiresAt: number } | null = null
  private pending: Promise<string> | null = null

  constructor(
    private readonly credentials: ServiceAccountCredentials,
    options: GoogleAccessTokenProviderOptions = {},
  ) {
    this.fetchFn = bindGlobalFetch(options.fetchFn)
    this.now = options.now ?? Date.now
    this.tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL
    this.scopes = options.scopes ?? DEFAULT_SCOPES
  }

  invalidateAccessToken(): void {
    this.cached = null
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) this.invalidateAccessToken()
    if (this.cached && this.cached.expiresAt > this.now()) {
      return this.cached.value
    }
    if (!this.pending) {
      this.pending = this.mintAccessToken().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }

  private async importSigningKey(): Promise<CryptoKey> {
    if (!this.signingKey) {
      this.signingKey = crypto.subtle.importKey(
        'pkcs8',
        pemToPkcs8(this.credentials.privateKeyPem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      )
    }
    return this.signingKey
  }

  private async createAssertion(): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1000)
    const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' }
    if (this.credentials.privateKeyId) header.kid = this.credentials.privateKeyId
    const claims = {
      iss: this.credentials.clientEmail,
      sub: this.credentials.clientEmail,
      aud: this.tokenUrl,
      iat: issuedAt,
      exp: issuedAt + 3600,
      scope: this.scopes.join(' '),
    }
    const signingInput = `${stringToBase64Url(JSON.stringify(header))}.${stringToBase64Url(JSON.stringify(claims))}`
    const key = await this.importSigningKey()
    const signature = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      new TextEncoder().encode(signingInput),
    )
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
  }

  private async mintAccessToken(): Promise<string> {
    const assertion = await this.createAssertion()
    const body = new URLSearchParams({
      grant_type: JWT_BEARER_GRANT,
      assertion,
    })
    const response = await this.fetchFn(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) {
      throw new Error(`Google rejected the service-account token request (${response.status}).`)
    }
    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown }
    if (typeof payload.access_token !== 'string' || payload.access_token === '') {
      throw new Error('Google returned no service-account access token.')
    }
    const expiresInSeconds = typeof payload.expires_in === 'number'
      ? payload.expires_in
      : Number(payload.expires_in ?? 3600)
    const lifetimeMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds * 1000
      : 3600_000
    // Refresh a minute early, but never cache a very short-lived token past
    // half its stated life.
    const usableMs = Math.max(1000, Math.min(lifetimeMs - 60_000, lifetimeMs / 2))
    this.cached = {
      value: payload.access_token,
      expiresAt: this.now() + usableMs,
    }
    return payload.access_token
  }
}
