import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The SSR bundle used only by `scripts/prerender.mjs`.
 *
 * Separate from `vite.config.ts` on purpose: the client build has `manualChunks`
 * that name Firebase packages, and Rollup refuses those names in an SSR build
 * (nothing is chunked there). Keeping the two configs apart also means the
 * prerender cannot accidentally alter the bundle Guests download.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: 'src/entry-server.tsx',
    outDir: 'dist-ssr',
    emptyOutDir: true,
    // Readable output helps when a render throws on one route and the stack
    // needs to point at a component rather than at column 48012.
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'entry-server.js' } },
  },
})
