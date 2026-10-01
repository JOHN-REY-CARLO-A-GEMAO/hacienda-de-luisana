import { defineConfig } from 'vitest/config'
import { assertIsolatedProcess } from './scripts/phase0/boundary.mjs'

assertIsolatedProcess()

/**
 * The offline Security Rules suite: the real `firestore.rules` and
 * `storage.rules` evaluated by `test/rules/engine.ts`. It needs no emulator and
 * no network, so it runs anywhere — and in CI it runs next to the emulator
 * suite, which is the canonical one.
 */
export default defineConfig({
  envDir: 'test/phase0/empty-env',
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    environment: 'node',
    globals: true,
    include: ['test/rules/**/*.test.ts'],
  },
})
