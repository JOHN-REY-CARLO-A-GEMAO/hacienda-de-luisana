import { defineConfig } from 'vitest/config'

// Test harness for the web app (Vite + React + TS).
// Flutter behaviour tests keep living in /test/*.dart and are run by `flutter test`;
// the JS runner only picks up /test/web. `.tsx` is included because a gate that
// decides what a person sees has to be rendered to be believed.
export default defineConfig({
  // The suite asserts demo mode: a developer with real keys in `.env.local` would
  // otherwise run the app against the live project and the "no Firebase in this
  // build" tests would fail. No `.env*` files live here, so the run is hermetic.
  // A test that wants to know about a variable passes `env` in by hand
  // (test/web/firebase-config.test.ts).
  envDir: 'test/web',
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/web/**/*.test.ts', 'test/web/**/*.test.tsx'],
  },
})
