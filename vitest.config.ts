import { defineConfig } from 'vitest/config'

// Test harness for the web app (Vite + React + TS).
// Flutter behaviour tests keep living in /test/*.dart and are run by `flutter test`;
// the JS runner only picks up /test/web.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/web/**/*.test.ts'],
  },
})
