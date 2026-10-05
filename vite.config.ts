import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveFirebaseConfig } from './src/lib/firebaseConfig'
import { COMMITTED_PROJECT } from './src/lib/firebaseDefaults'
import { resolveSupabaseConfig } from './src/lib/supabaseConfig'
import { COMMITTED_SUPABASE } from './src/lib/supabaseDefaults'

/**
 * Say, in the build log, which Firebase project this bundle is being built for.
 *
 * The failure this is for is a silent one: a deployment built without its
 * Firebase settings is a *working* website whose Guest requests never reach the
 * Admin app. Nothing in the build output used to mention it. This does — and it
 * reads the same resolver the app reads (`src/lib/firebaseConfig.ts`), so the
 * log and the running site cannot disagree.
 *
 * It never fails a build by itself: a demo build is a legitimate thing to want.
 * Set `FIREBASE_ENV_STRICT=1` (Vercel → Environment Variables, or in front of
 * `npm run build`) to make a build with no Firebase *fail* instead — that is the
 * setting to use once the Hacienda's guests are real, so a forgotten dashboard
 * variable breaks a deployment instead of a booking.
 */
function firebaseConfigReport(): Plugin {
  return {
    name: 'hdl:firebase-config-report',
    apply: 'build',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir ?? process.cwd(), 'VITE_')
      const report = resolveFirebaseConfig({
        env,
        defaults: COMMITTED_PROJECT,
        // A build is the production case: this is the bundle that gets deployed.
        allowDefaults: true,
      })
      const names = (fields: readonly string[]) => fields.join(', ')

      if (report.configured) {
        const where =
          report.source === 'env'
            ? 'from VITE_FIREBASE_* environment variables'
            : report.source === 'defaults'
              ? 'from src/lib/firebaseDefaults.ts (this build has no VITE_FIREBASE_* variables)'
              : 'partly from the environment, the rest from src/lib/firebaseDefaults.ts'
        config.logger.info(
          `\n[firebase] Building for project "${report.config.projectId}" — ${where}.`,
        )
        const missingOptional = report.fields.filter((f) => !f.required && !f.value)
        if (missingOptional.length > 0) {
          config.logger.info(
            `[firebase] Not set, so those features stay off: ${names(missingOptional.map((f) => f.field))}.`,
          )
        }
        if (report.refusedEnvKeys.length > 0) {
          config.logger.warn(
            `[firebase] Set but refused (a placeholder, or not a Firebase web API key): ` +
              `${names(report.refusedEnvKeys)}.`,
          )
        }
      } else {
        const banner =
          '[firebase] This build has NO Firebase project. Guest bookings will be saved in the ' +
          'guest’s own browser and will NOT reach the Admin app.\n' +
          '[firebase]   Fix it with VITE_FIREBASE_* variables in the hosting dashboard (Vercel → ' +
          'Settings → Environment Variables, then redeploy), or by filling ' +
          'src/lib/firebaseDefaults.ts.'
        if (process.env.FIREBASE_ENV_STRICT === '1') {
          throw new Error(
            `${banner}\n[firebase] FIREBASE_ENV_STRICT=1, so this build is refused rather than shipped ` +
              'in demo mode.',
          )
        }
        config.logger.warn(`\n${banner}`)
      }
    },
  }
}

/**
 * Say, in the build log, which Supabase project this bundle will upload payment
 * proofs to.
 *
 * The same silent failure as above, one store over: a build with no
 * `VITE_SUPABASE_*` variables is a *working* website whose Guests' downpayment
 * screenshots stay in their own browsers, while their Bookings are created in
 * Firestore pointing at proof paths the Admin cannot open. That was finding F12,
 * and nothing in the build output mentioned it.
 *
 * `SUPABASE_ENV_STRICT=1` makes a production build with no Supabase project
 * *fail*. That is the setting to turn on once real Guests are paying: from then
 * on a forgotten variable breaks the deploy instead of losing a receipt.
 */
function supabaseConfigReport(): Plugin {
  return {
    name: 'hdl:supabase-config-report',
    apply: 'build',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir ?? process.cwd(), 'VITE_')
      const report = resolveSupabaseConfig({
        env,
        defaults: COMMITTED_SUPABASE,
        allowDefaults: true,
      })

      if (report.configured) {
        const where =
          report.source === 'env'
            ? 'from VITE_SUPABASE_* environment variables'
            : report.source === 'defaults'
              ? 'from src/lib/supabaseDefaults.ts (this build has no VITE_SUPABASE_* variables)'
              : 'partly from the environment, the rest from src/lib/supabaseDefaults.ts'
        config.logger.info(
          `\n[supabase] Payment proofs will upload to "${new URL(report.config.url).hostname}" — ${where}.`,
        )
        if (report.refusedEnvKeys.length > 0) {
          config.logger.warn(
            `[supabase] Set but refused (still the placeholder from .env.example): ` +
              `${report.refusedEnvKeys.join(', ')}.`,
          )
        }
      } else {
        const banner =
          '[supabase] This build has NO Supabase project. Payment-proof screenshots will stay in the ' +
          'guest’s own browser and will NOT reach the Admin app.\n' +
          '[supabase]   Fix it with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the hosting ' +
          'dashboard, or by filling src/lib/supabaseDefaults.ts.'
        if (process.env.SUPABASE_ENV_STRICT === '1') {
          throw new Error(
            `${banner}\n[supabase] SUPABASE_ENV_STRICT=1, so this build is refused rather than shipped ` +
              'with proofs that never arrive.',
          )
        }
        config.logger.warn(`\n${banner}`)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), firebaseConfigReport(), supabaseConfigReport()],
  // Custom domain: https://haciendadeluisana.com — must be "/"
  base: '/',
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          react: ['react', 'react-dom', 'react-router-dom'],
        }
      }
    }
  }
})
