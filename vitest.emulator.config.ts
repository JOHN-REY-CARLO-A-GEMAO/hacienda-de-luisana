import { defineConfig } from 'vitest/config'
import { assertEmulatorEnvironment } from './scripts/phase0/boundary.mjs'

assertEmulatorEnvironment()

/**
 * The emulator-backed rules suite. It is not part of `npm test`: it needs the
 * Firebase Emulator Suite (Java plus a one-time ~200 MB download) running with
 * this repository's rules files. `npm run test:emulator` starts it and runs this
 * config inside `firebase emulators:exec`.
 */
export default defineConfig({
  envDir: 'test/phase0/empty-env',
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    environment: 'node',
    globals: true,
    include: process.env.HDL_PHASE0_ACTION === 'emulator-invariants'
      ? ['test/phase0/emulator/**/*.invariants.test.ts']
      : process.env.HDL_PHASE0_ACTION === 'emulator-auth'
        ? ['test/phase0/emulator/**/*.auth-emulator.test.ts']
        : ['test/emulator/**/*.test.ts', 'test/phase0/emulator/**/*.characterization.test.ts'],
    testTimeout: 40_000,
    hookTimeout: 60_000,
  },
})
