import { defineConfig } from 'vitest/config'

/**
 * The emulator-backed rules suite. It is not part of `npm test`: it needs the
 * Firebase Emulator Suite (Java plus a one-time ~200 MB download) running with
 * this repository's rules files. `npm run test:emulator` starts it and runs this
 * config inside `firebase emulators:exec`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/emulator/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
