/**
 * The two KV operations this worker uses, named structurally.
 *
 * Deliberately **not** `KVNamespace`: the website's test project imports this
 * module (through the client/worker contract test), and that project has the DOM
 * lib and no Cloudflare globals. A real `KVNamespace` satisfies this interface —
 * the worker's own `tsc` proves that when `index.ts` passes the binding in — so
 * the narrow type costs nothing and keeps the module loadable in both places.
 */
export interface RateLimitKv {
  get(key: string, type?: 'json'): Promise<unknown>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

/**
 * What the worker is given by Cloudflare (bindings and vars), in one type.
 *
 * Kept out of `index.ts` so the modules that need a binding can name it without
 * importing the handler, and so a missing binding is a type error rather than a
 * `undefined` at 3 a.m.
 */
export interface Env {
  /** The KV namespace the rate-limit counters live in. */
  RATE_LIMIT_KV: RateLimitKv
  /** Non-secret configuration from `[vars]` in wrangler.toml. */
  ENVIRONMENT?: string
  ALLOWED_ORIGIN?: string
  NOTIFICATION_EMAIL?: string
  FROM_EMAIL?: string
  /** Secrets, set with `wrangler secret put` (or `.dev.vars` locally). */
  TURNSTILE_SECRET_KEY?: string
  RESEND_API_KEY?: string
  /** Local development only; refused unless ENVIRONMENT is "development". */
  TURNSTILE_SKIP_VERIFY?: string
  /** "true" makes an unreachable Cloudflare a refusal instead of a pass. */
  TURNSTILE_FAIL_CLOSED?: string
}

/** Is this run a local `wrangler dev`, as opposed to a deployment? */
export function isDevelopment(env: Env): boolean {
  return (env.ENVIRONMENT ?? 'production').trim().toLowerCase() === 'development'
}
