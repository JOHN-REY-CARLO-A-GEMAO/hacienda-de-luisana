import { defineConfig } from 'vitest/config'

/**
 * The worker's own test run.
 *
 * `environment: 'node'` because there is no DOM here: the worker only ever sees
 * a `Request` and returns a `Response`, both of which Node provides. Nothing in
 * the suite touches Cloudflare — the KV namespace is a fake with the two methods
 * the worker uses, and `fetch` is stubbed per test for Turnstile and Resend.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
})
