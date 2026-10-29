// @vitest-environment node
//
// Why this file exists, and why it is the only `node` environment under
// `test/web/`:
//
// `src/lib/supabase.ts` builds its client at module evaluation. That was
// invisible until `scripts/prerender.mjs` started importing the SSR bundle to
// render 14 pages into HTML — at which point every build constructed a Supabase
// client in Node. `@supabase/realtime-js` needs a native `WebSocket`, which Node
// only has from 22, so under the Node 20 the Pages workflow pins, the build died
// with `Node.js detected but native WebSocket not found`.
//
// The deploy had been failing on every push to `main` for a day. A build that
// only passes on a newer Node than the pipeline uses is not a build.
//
// This test pins the rule rather than the symptom: outside a browser, a
// configured build still reports its configuration (so `/status` is honest) and
// still exposes `supabase === null` (so nothing is constructed).
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const REAL_LOOKING = {
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  // the shape `supabaseConfig.isAnonKeyLike()` accepts: three base64url segments
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl',
}

describe('the Supabase client is a browser object', () => {
  it('is null without a window, even when the project is configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', REAL_LOOKING.url)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', REAL_LOOKING.anonKey)
    vi.resetModules()

    expect(typeof window).toBe('undefined')
    const module = await import('../../src/lib/supabase')

    // The configuration is still resolved and still reported…
    expect(module.isSupabaseConfigured).toBe(true)
    expect(module.supabaseConfigSource).toBe('env')
    expect(module.getSupabaseStatus()).toMatchObject({
      configured: true,
      source: 'env',
      bucket: 'payment-proofs',
    })

    // …and no client was constructed from it.
    expect(module.supabase).toBeNull()
  })

  it('is null in a build with no Supabase project at all', async () => {
    vi.resetModules()
    const module = await import('../../src/lib/supabase')
    expect(module.isSupabaseConfigured).toBe(false)
    expect(module.supabase).toBeNull()
  })
})
