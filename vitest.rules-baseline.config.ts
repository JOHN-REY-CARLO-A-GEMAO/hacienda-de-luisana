import { defineConfig } from 'vitest/config'
import { assertIsolatedProcess } from './scripts/phase0/boundary.mjs'
assertIsolatedProcess()
/** Original policy, same existing fixtures and evaluator, no working-tree rule replacement. */
export default defineConfig({
  envDir: 'test/phase0/empty-env',
  test: {
    fileParallelism: false, maxWorkers: 1, environment: 'node', globals: true,
    setupFiles: ['test/rules/baseline.setup.ts'],
    include: ['test/rules/**/*.test.ts'],
  },
})
