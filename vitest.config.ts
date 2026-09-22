import { defineConfig } from 'vitest/config'

// Test harness for the web app (Vite + React + TS).
// Flutter behaviour tests keep living in /test/*.dart and are run by `flutter test`;
// the JS runner only picks up /test/web. `.tsx` is included because a gate that
// decides what a person sees has to be rendered to be believed.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/web/**/*.test.ts', 'test/web/**/*.test.tsx'],
  },
})
