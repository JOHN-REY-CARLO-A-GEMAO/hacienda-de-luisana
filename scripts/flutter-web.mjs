#!/usr/bin/env node
/**
 * Run the Admin app with the CARTO basemap key taken from `.env.local`.
 *
 * Why this exists: a Dart build flag cannot read a `.env` file. `--dart-define`
 * takes a literal, `--dart-define-from-file` takes JSON, and Flutter has no
 * built-in dotenv loader. The web app reads `.env.local` through Vite, so the
 * key naturally *belongs* there — and the alternative was asking a person to
 * keep the same key in two files, which is how one of them goes stale.
 *
 * So: read `.env.local`, pull `CARTO_KEY` out of it, hand it to Flutter as a
 * `--dart-define`, and never write it anywhere.
 *
 *   node scripts/flutter-web.mjs run -d chrome
 *   node scripts/flutter-web.mjs run                  # the connected device
 *   node scripts/flutter-web.mjs build apk --release
 *
 * Everything after the first argument is passed to `flutter` unchanged, so this
 * is a drop-in for the command you were already typing. A `--dart-define` you
 * pass yourself wins over the one from `.env.local`, because an explicit flag on
 * the command line is never an accident.
 *
 * When `.env.local` has no `CARTO_KEY`, this prints what is missing and runs
 * Flutter anyway: the app draws a watermarked map rather than refusing to start,
 * which is the same trade the app makes everywhere else about this key.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = join(root, '.env.local')

/** Parse a dotenv file the way Vite does, without depending on Vite. */
function readEnv(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Surrounding quotes are optional and are not part of the value.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const env = readEnv(ENV_FILE)

// Either name works. `CARTO_KEY` is the Dart-side name; `VITE_CARTO_KEY` is
// accepted so the key can sit beside the other VITE_ variables a person already
// keeps in this file and not look out of place.
const key = (env.CARTO_KEY ?? env.VITE_CARTO_KEY ?? '').trim()

if (!key) {
  const where = existsSync(ENV_FILE) ? '.env.local has no CARTO_KEY' : '.env.local does not exist'
  process.stderr.write(
    `\n[carto] ${where}.\n` +
      `        The map will draw watermarked. Add a line to .env.local:\n\n` +
      `            CARTO_KEY=your-key      # free: https://carto.com/basemaps/apikey/\n\n` +
      `        Running Flutter anyway.\n\n`,
  )
}

const args = process.argv.slice(2)
if (args.length === 0) {
  process.stderr.write('usage: node scripts/flutter-web.mjs <flutter args...>\n')
  process.exit(2)
}

// An explicit --dart-define on the command line always wins.
const overridden = args.some((a) => a.startsWith('--dart-define=CARTO_KEY='))
const flutterArgs = key && !overridden ? [...args, `--dart-define=CARTO_KEY=${key}`] : args

const child = spawn('flutter', flutterArgs, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
child.on('error', (error) => {
  process.stderr.write(`\n[carto] could not start flutter: ${error.message}\n`)
  process.exit(1)
})
