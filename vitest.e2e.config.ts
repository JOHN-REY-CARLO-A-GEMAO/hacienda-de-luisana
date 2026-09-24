import { defineConfig } from 'vitest/config'

// The final end-to-end scenario (P8). Its own config so the record can be run
// and reprinted on demand without dragging the whole web suite in:
//
//   npm run test:e2e
//
// jsdom, because the scenario drives the website's real modules on its offline
// adapters (localStorage), and rules, because the security steps execute the
// repository's `firestore.rules` / `storage.rules` text through the in-repo
// evaluator. It does not need Java, so it runs in environments where the
// Firebase Emulator Suite cannot (`npm run test:emulator`).
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 30_000,
  },
})
