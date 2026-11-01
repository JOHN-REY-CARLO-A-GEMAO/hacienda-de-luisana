/**
 * Worker configuration and Google service-account parsing.
 *
 * The production credential is supplied by the project owner as the
 * `FIREBASE_SERVICE_ACCOUNT_JSON` Cloudflare secret. Split
 * `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` secrets are also accepted
 * for operators who prefer that layout. No credential material is committed
 * or returned by the health endpoint.
 */

export interface Env {
  FIREBASE_PROJECT_ID?: string
  FIREBASE_DATABASE_ID?: string
  FIREBASE_SERVICE_ACCOUNT_JSON?: string
  FIREBASE_CLIENT_EMAIL?: string
  FIREBASE_PRIVATE_KEY?: string
  FIREBASE_PRIVATE_KEY_ID?: string
  BOOKING_QUOTES_ENABLED?: string
  QUOTE_TTL_MINUTES?: string
  QUOTE_RATE_LIMIT_PER_MINUTE?: string
  VERIFY_RATE_LIMIT_PER_MINUTE?: string
  SUBMIT_RATE_LIMIT_PER_MINUTE?: string
  ALLOWED_ORIGINS?: string
}

export class WorkerConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerConfigurationError'
  }
}

export interface ServiceAccountCredentials {
  projectId: string
  clientEmail: string
  privateKeyPem: string
  privateKeyId?: string
}

export interface WorkerConfig {
  projectId: string
  databaseId: string
  allowedOrigins: readonly string[]
  quotesEnabled: boolean
  quoteTtlMinutes: number
  quoteLimitPerMinute: number
  verifyLimitPerMinute: number
  submitLimitPerMinute: number
  serviceAccount: ServiceAccountCredentials
}

function nonEmpty(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePrivateKey(value: string): string {
  const trimmed = value.trim()
  // Separate-secret values may be pasted with escaped newlines instead of
  // real line breaks. A downloaded JSON key is normally parsed before here.
  const normalized = trimmed.includes('\n') ? trimmed : trimmed.replace(/\\n/g, '\n')
  if (!normalized.includes('-----BEGIN PRIVATE KEY-----')
    || !normalized.includes('-----END PRIVATE KEY-----')) {
    throw new WorkerConfigurationError('The Firebase service-account private key is malformed.')
  }
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function parseServiceAccount(env: Env): ServiceAccountCredentials {
  const rawJson = nonEmpty(env.FIREBASE_SERVICE_ACCOUNT_JSON)
  if (rawJson) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>
    } catch {
      throw new WorkerConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.')
    }
    const projectId = nonEmpty(typeof parsed.project_id === 'string' ? parsed.project_id : '')
    const clientEmail = nonEmpty(typeof parsed.client_email === 'string' ? parsed.client_email : '')
    const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : ''
    const privateKeyId = nonEmpty(typeof parsed.private_key_id === 'string' ? parsed.private_key_id : '')
    if (!projectId || !clientEmail || !privateKey) {
      throw new WorkerConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key.')
    }
    return {
      projectId,
      clientEmail,
      privateKeyPem: normalizePrivateKey(privateKey),
      ...(privateKeyId ? { privateKeyId } : {}),
    }
  }

  const projectId = nonEmpty(env.FIREBASE_PROJECT_ID)
  const clientEmail = nonEmpty(env.FIREBASE_CLIENT_EMAIL)
  const privateKey = env.FIREBASE_PRIVATE_KEY ?? ''
  const privateKeyId = nonEmpty(env.FIREBASE_PRIVATE_KEY_ID)
  if (!projectId || !clientEmail || !privateKey.trim()) {
    throw new WorkerConfigurationError('Set FIREBASE_SERVICE_ACCOUNT_JSON or the split Firebase service-account secrets.')
  }
  return {
    projectId,
    clientEmail,
    privateKeyPem: normalizePrivateKey(privateKey),
    ...(privateKeyId ? { privateKeyId } : {}),
  }
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  const origins: string[] = []
  for (const candidate of (raw ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    if (candidate === '*') {
      origins.push(candidate)
      continue
    }
    try {
      origins.push(new URL(candidate).origin)
    } catch {
      throw new WorkerConfigurationError(`ALLOWED_ORIGINS contains an invalid origin: ${candidate}`)
    }
  }
  return [...new Set(origins)]
}

function numeric(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  return Number(value)
}

export function parseWorkerConfig(env: Env): WorkerConfig {
  const serviceAccount = parseServiceAccount(env)
  const configuredProjectId = nonEmpty(env.FIREBASE_PROJECT_ID)
  const projectId = configuredProjectId || serviceAccount.projectId
  if (serviceAccount.projectId && serviceAccount.projectId !== projectId) {
    throw new WorkerConfigurationError('FIREBASE_PROJECT_ID does not match the service-account project_id.')
  }

  return {
    projectId,
    databaseId: nonEmpty(env.FIREBASE_DATABASE_ID) || '(default)',
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    quotesEnabled: nonEmpty(env.BOOKING_QUOTES_ENABLED).toLowerCase() === 'true',
    quoteTtlMinutes: numeric(env.QUOTE_TTL_MINUTES, 30),
    quoteLimitPerMinute: numeric(env.QUOTE_RATE_LIMIT_PER_MINUTE, 12),
    verifyLimitPerMinute: numeric(env.VERIFY_RATE_LIMIT_PER_MINUTE, 30),
    submitLimitPerMinute: numeric(env.SUBMIT_RATE_LIMIT_PER_MINUTE, 8),
    serviceAccount: {
      ...serviceAccount,
      projectId,
    },
  }
}

export function hasServiceAccountSecret(env: Env): boolean {
  return Boolean(nonEmpty(env.FIREBASE_SERVICE_ACCOUNT_JSON)
    || (nonEmpty(env.FIREBASE_CLIENT_EMAIL) && nonEmpty(env.FIREBASE_PRIVATE_KEY)))
}
