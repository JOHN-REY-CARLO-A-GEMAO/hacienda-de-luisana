// ----------------------------------------------------------------------------
// The CARTO key lives in `.env.local` once, and reaches Dart through one script.
//
// The web app reads `.env.local` through Vite. The Flutter app cannot: Dart has
// no dotenv loader, and `--dart-define-from-file` wants JSON, not a `.env`. So a
// key that a person naturally puts in `.env.local` — beside the Firebase keys
// already there — would silently not reach the map, and the only symptom would
// be a watermark nobody could explain.
//
// `scripts/flutter-web.mjs` closes that gap by reading the file and passing the
// value as a `--dart-define`. This suite holds the parts of it that are easy to
// break: the parse, the precedence, and the fact that a missing key does not
// stop the build.
// ----------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, '../../scripts/flutter-web.mjs')

/** A throwaway project: a `.env.local`, a script copy, and a fake `flutter`. */
function harness(envBody: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'carto-env-'))
  mkdirSync(join(dir, 'scripts'))
  writeFileSync(join(dir, 'scripts', 'flutter-web.mjs'), readFileSync(SCRIPT, 'utf8'))
  if (envBody !== null) writeFileSync(join(dir, '.env.local'), envBody)
  const fake = join(dir, 'flutter')
  // Echo the arguments so the test can assert on exactly what Flutter was told.
  writeFileSync(fake, '#!/bin/sh\necho "ARGS: $@"\n')
  chmodSync(fake, 0o755)
  return dir
}

function run(dir: string, args: string[]) {
  // Both streams: the warning about a missing key goes to stderr, and the child's
  // echoed arguments go to stdout. A test that saw only one would pass while the
  // person running the build saw nothing.
  const result = spawnSync('node', [join(dir, 'scripts', 'flutter-web.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

describe('the key can live in .env.local and still reach the app', () => {
  it('passes CARTO_KEY from .env.local to flutter', () => {
    const out = run(harness('CARTO_KEY=abc123\n'), ['run', '-d', 'chrome'])
    expect(out).toContain('--dart-define=CARTO_KEY=abc123')
  })

  it('accepts the key quoted, as a .env file often is', () => {
    const out = run(harness('CARTO_KEY="abc123"\n'), ['run'])
    expect(out).toContain('--dart-define=CARTO_KEY=abc123')
    expect(out).not.toContain('"abc123"')
  })

  it('also accepts VITE_CARTO_KEY, so it can sit with the other VITE_ lines', () => {
    const out = run(harness('VITE_CARTO_KEY=svg999\n'), ['run'])
    expect(out).toContain('--dart-define=CARTO_KEY=svg999')
  })

  it('lets an explicit --dart-define on the command line win', () => {
    // A key typed on the command is never an accident; it must not be silently
    // replaced by one from a file.
    const out = run(harness('CARTO_KEY=fromenv\n'), ['run', '--dart-define=CARTO_KEY=mine'])
    expect(out).toContain('CARTO_KEY=mine')
    expect(out).not.toContain('CARTO_KEY=fromenv')
  })

  it('passes every other flutter argument through untouched', () => {
    // It is a drop-in for the command already being typed, not a wrapper with
    // its own opinions about which subcommands exist.
    const out = run(harness('CARTO_KEY=k\n'), ['build', 'apk', '--release', '--flavor', 'prod'])
    expect(out).toContain('build apk --release --flavor prod')
  })

  it('runs anyway when the key is missing, and says what to do', () => {
    // The app draws a watermarked map without a key. Failing the build here
    // would turn a licensing nicety into "the app will not start".
    const out = run(harness('VITE_FIREBASE_API_KEY=x\n'), ['run'])
    expect(out).toContain('watermarked')
    expect(out).toContain('CARTO_KEY=')
    expect(out).toMatch(/ARGS: run/)
    expect(out).not.toContain('--dart-define')
  })

  it('says the file is missing, rather than pretending the key is wrong', () => {
    const out = run(harness(null), ['run'])
    expect(out).toContain('.env.local does not exist')
  })

  it('explains itself when called with no flutter arguments', () => {
    const out = run(harness('CARTO_KEY=k\n'), [])
    expect(out).toContain('usage:')
  })

  it('is wired into npm so nobody has to remember the path', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'))
    expect(pkg.scripts['app:run']).toContain('scripts/flutter-web.mjs')
    expect(pkg.scripts['app:build']).toContain('scripts/flutter-web.mjs')
  })

  it('documents the variable in .env.example, so it is discoverable', () => {
    const example = readFileSync(join(__dirname, '../../.env.example'), 'utf8')
    expect(example).toMatch(/^CARTO_KEY=$/m)
  })
})
