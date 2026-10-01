import { defineConfig } from 'vitest/config'
import { assertIsolatedProcess } from './scripts/phase0/boundary.mjs'

assertIsolatedProcess()
export default defineConfig({
  envDir: 'test/phase0/empty-env',
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom', globals: true, fileParallelism: false, maxWorkers: 1,
    include: process.env.HDL_PHASE0_ACTION === 'invariants'
      ? ['test/phase0/**/*.invariants.test.{ts,tsx}']
      : ['test/phase0/**/*.characterization.test.{ts,tsx}'],
    exclude: ['test/phase0/emulator/**'],
    setupFiles: ['test/phase0/setup.ts'],
    testTimeout: 20_000, hookTimeout: 20_000,
  },
})
