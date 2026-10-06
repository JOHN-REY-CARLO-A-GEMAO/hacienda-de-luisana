import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: 'D:/Downloads/11_hacienda/hacienda-de-luisana',
    include: ['test/web/scratch-probe.test.ts'],
    environment: 'node',
  },
})