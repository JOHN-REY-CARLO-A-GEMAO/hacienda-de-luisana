import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // For GitHub Pages project site: https://<user>.github.io/hacienda-de-luisana/
  // If you use a custom domain or user site (username.github.io), change base to "/"
  base: "/hacienda-de-luisana/",
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    hmr: { clientPort: 443 }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true
  }
})
