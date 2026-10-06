import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: 'test/phase0/empty-env',
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    environment: 'jsdom',
    globals: true,
    include: ['test/web/**/*.test.ts', 'test/web/**/*.test.tsx'],
  },
})