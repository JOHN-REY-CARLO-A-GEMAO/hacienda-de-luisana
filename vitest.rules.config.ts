import { defineConfig } from 'vitest/config'

/**
 * The offline Security Rules suite: the real `firestore.rules` and
 * `storage.rules` evaluated by `test/rules/engine.ts`. It needs no emulator and
 * no network, so it runs anywhere — and in CI it runs next to the emulator
 * suite, which is the canonical one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/rules/**/*.test.ts'],
  },
})
