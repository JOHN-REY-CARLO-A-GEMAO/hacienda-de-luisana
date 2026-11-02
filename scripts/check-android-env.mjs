#!/usr/bin/env node
/**
 * Pre-flight for the Admin app's Android (Flutter) build.
 *
 * `flutter run` sometimes dies at android/app/build.gradle:2 with:
 *
 *   Failed to apply plugin 'com.android.internal.application'.
 *   > Failed to create service ... AndroidLocationsBuildService
 *      > Could not create provider for value source
 *        AndroidLocationsBuildService.AndroidDirectoryCreator.
 *
 * That happens *before* AGP compiles anything: while applying the Android
 * plugin, AGP resolves the Android preferences folder (`%USERPROFILE%\.android`
 * on Windows, `~/.android` elsewhere) and creates it. It throws an opaque
 * Gradle error when:
 *
 *   - ANDROID_USER_HOME, ANDROID_PREFS_ROOT and/or ANDROID_SDK_HOME disagree.
 *     ANDROID_USER_HOME is the .android folder itself; the other two are its
 *     *parent*, so setting them to the same literal value still conflicts.
 *   - ANDROID_SDK_HOME points at the SDK root (a classic old-tutorial setting).
 *   - the folder is a file, its parent is missing, or it is not writable.
 *   - user.home / USERPROFILE / HOME cannot be resolved (container, redirected
 *     profile, stale `-Duser.home=` in GRADLE_OPTS or JAVA_TOOL_OPTIONS).
 *
 * None of those are project bugs. This script names the cause and prints the
 * commands that repair it. Run it before `flutter run`:
 *
 *   node scripts/check-android-env.mjs
 *   node scripts/check-android-env.mjs --self-test   # pure logic checks
 *
 * It only reads the machine, except for creating the preferences folder and a
 * throwaway probe file inside it when that folder is missing (the same thing
 * AGP itself would do).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ANDROID_USER_HOME = the .android folder itself; the deprecated two = parent.
const PREFS_VARS = ['ANDROID_USER_HOME', 'ANDROID_PREFS_ROOT', 'ANDROID_SDK_HOME']
const SDK_VARS = ['ANDROID_HOME', 'ANDROID_SDK_ROOT']
// JVM options that can inject the same names as *system properties*, which AGP
// reads alongside the environment. A stale -Duser.home here causes the same
// opaque failure even when every env var looks fine.
const PROP_CARRIERS = ['GRADLE_OPTS', 'JAVA_TOOL_OPTIONS', 'JAVA_OPTS', '_JAVA_OPTIONS']

// ---------------------------------------------------------------------------
// Pure helpers (also exercised by --self-test)
// ---------------------------------------------------------------------------

/** Case-insensitive lookup: Windows environment variables are case-insensitive. */
function getenv(env, name) {
  const direct = env[name]
  if (direct !== undefined) return direct
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/** Decode java.util.Properties escapes. `\U` becomes `U` — hence the sdk.dir trap. */
function unescapeProperty(raw) {
  const simple = { n: '\n', r: '\r', t: '\t', f: '\f', b: '\b' }
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\' || i === raw.length - 1) { out += raw[i]; continue }
    const c = raw[++i]
    if (c === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16))
      i += 4
    } else {
      out += simple[c] ?? c
    }
  }
  return out
}

/**
 * True when a Windows path was written with single backslashes. Java's
 * Properties reader eats `\U`, `\t`, `\A` ... so `sdk.dir=C:\Users\me\Sdk`
 * becomes `C:UsersmeSdk`. Use `\\` (Flutter does) or forward slashes.
 */
function hasLooseBackslashes(raw) {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') continue
    const next = raw[i + 1]
    if (next === undefined) return true
    if (next === '\\') { i++; continue }          // escaped backslash: fine
    if (next === ':' || next === '=' || next === ' ') continue // valid escapes
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) { i += 5; continue }
    return true
  }
  return false
}

/** Minimal java.util.Properties reader: enough for local.properties / gradle.properties. */
function parseProperties(text) {
  const out = new Map()
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    let sep = -1
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '\\') { i++; continue }
      if (trimmed[i] === '=' || trimmed[i] === ':' || /\s/.test(trimmed[i])) { sep = i; break }
    }
    const rawKey = sep < 0 ? trimmed : trimmed.slice(0, sep)
    const rawValue = sep < 0 ? '' : trimmed.slice(sep).replace(/^\s*[:=]?\s*/, '')
    out.set(unescapeProperty(rawKey), { raw: rawValue, value: unescapeProperty(rawValue) })
  }
  return out
}

/** Every place AGP can read the preferences folder from, normalised to the folder. */
function collectPrefsCandidates(env, gradleProps, p, root) {
  const candidates = []
  const userHomeOverrides = []
  const add = (name, value, from) => {
    if (value === undefined || value === null) return
    const raw = String(value).trim().replace(/^['"]|['"]$/g, '')
    if (!raw) return
    let folder = p.isAbsolute(raw) ? p.normalize(raw) : p.resolve(root, raw)
    if (name !== 'ANDROID_USER_HOME') folder = p.join(folder, '.android')
    candidates.push({ name, from, raw, folder })
  }
  const props = parseProperties(gradleProps)
  for (const name of PREFS_VARS) {
    add(name, getenv(env, name), `env ${name}`)
    const sys = props.get(`systemProp.${name}`)
    if (sys) add(name, sys.value, `android/gradle.properties systemProp.${name}`)
  }
  const option = /-D(ANDROID_USER_HOME|ANDROID_PREFS_ROOT|ANDROID_SDK_HOME|user\.home)=(?:"([^"]*)"|'([^']*)'|(\S+))/g
  for (const carrier of PROP_CARRIERS) {
    const raw = getenv(env, carrier)
    if (!raw) continue
    for (const match of String(raw).matchAll(option)) {
      const value = match[2] ?? match[3] ?? match[4]
      if (match[1] === 'user.home') userHomeOverrides.push({ value, from: `${carrier} -Duser.home` })
      else add(match[1], value, `${carrier} -D${match[1]}`)
    }
  }
  // gradle.properties `systemProp.user.home` also reaches the Gradle daemon.
  const userHomeProp = props.get('systemProp.user.home')
  if (userHomeProp) userHomeOverrides.push({ value: userHomeProp.value, from: 'android/gradle.properties systemProp.user.home' })
  return { candidates, userHomeOverrides }
}

function keyOf(folder, win) {
  return win ? folder.toLowerCase() : folder
}

function add(checks, level, code, title, detail, fix) {
  checks.push({ level, code, title, detail, fix })
}

/**
 * All checks are pure over `ctx` (env, paths, javaVersion) plus `ctx.io`.
 * `io` = { isDirectory, isFile, mkdirp, probe, readFile } so the logic can be
 * tested on Linux with fabricated Windows machines.
 */
function checkAndroidEnv(ctx) {
  const { env, io, win, root, homedir, javaVersion } = ctx
  const p = win ? path.win32 : path.posix
  const checks = []
  const at = (...parts) => p.join(root, ...parts)
  const gradleProps = io.readFile(at('android', 'gradle.properties'))
  const localPropsText = io.readFile(at('android', 'local.properties'))
  const localProps = parseProperties(localPropsText)
  const { candidates, userHomeOverrides } = collectPrefsCandidates(env, gradleProps, p, at('android'))

  const groups = new Map()
  for (const c of candidates) {
    const key = keyOf(c.folder, win)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  const describe = (c) => `${c.name} (${c.from}) = ${c.raw} -> ${c.folder}`

  if (groups.size > 1) {
    add(checks, 'FAIL', 'prefs-conflict', 'Conflicting Android preferences locations',
      [...groups.values()].flat().map(describe).join('\n    '),
      'Keep only ANDROID_USER_HOME (the .android folder itself). Unset ANDROID_PREFS_ROOT and ANDROID_SDK_HOME — they mean the *parent* of .android, so equal-looking values still conflict.')
  } else if (candidates.length > 1) {
    add(checks, 'WARN', 'prefs-duplicate', 'Android preferences location set more than once',
      candidates.map(describe).join('\n    '),
      'Remove the deprecated ANDROID_PREFS_ROOT / ANDROID_SDK_HOME entries; AGP warns about multiple sources and some versions reject them.')
  } else {
    add(checks, 'OK', 'prefs-source', 'Android preferences location is unambiguous',
      candidates.length ? describe(candidates[0]) : 'no override; AGP will use <home>/.android', '')
  }

  // ANDROID_SDK_HOME set to the SDK root is explicitly rejected by AGP. This
  // must be checked before the preflight creates `<sdk>/.android`, because AGP
  // rejects exactly the case where that folder is absent.
  for (const c of candidates.filter((c) => c.name === 'ANDROID_SDK_HOME')) {
    const sdkRoot = p.isAbsolute(c.raw) ? p.normalize(c.raw) : p.resolve(root, c.raw)
    if (io.isDirectory(p.join(sdkRoot, 'platforms')) && io.isDirectory(p.join(sdkRoot, 'platform-tools')) &&
        !io.isDirectory(p.join(sdkRoot, '.android'))) {
      add(checks, 'FAIL', 'sdk-home-is-sdk-root', 'ANDROID_SDK_HOME points at the SDK root',
        `${c.from} = ${c.raw}`,
        'ANDROID_SDK_HOME is deprecated and must be the *parent* of .android, not the SDK. Unset it; use ANDROID_HOME / ANDROID_SDK_ROOT for the SDK and ANDROID_USER_HOME for .android.')
    }
  }

  // A stale -Duser.home is the least obvious cause: it makes AGP resolve
  // "?/.android" or a deleted profile and then fail to create the folder.
  const override = userHomeOverrides[0]
  const home = (override && override.value) || getenv(env, win ? 'USERPROFILE' : 'HOME') ||
    getenv(env, 'HOME') || getenv(env, 'USERPROFILE') || homedir
  const prefsFolder = candidates.length ? candidates[0].folder : p.join(home || '', '.android')

  if (override) {
    const overrideDir = p.isAbsolute(override.value) ? p.normalize(override.value) : p.resolve(root, override.value)
    if (!io.isDirectory(overrideDir)) {
      add(checks, 'FAIL', 'user-home-override', 'A JVM option points user.home at a missing directory',
        `${override.from} = ${override.value}`,
        `Remove ${override.from} (or point it at a real, writable folder). AGP reads user.home from the Gradle daemon, not from your shell.`)
    } else {
      add(checks, 'WARN', 'user-home-override', 'user.home is overridden by a JVM option',
        `${override.from} = ${override.value}. AGP will create .android inside it.`,
        'Only keep this if the folder really is your Android home; otherwise remove it.')
    }
  }
  const homeOk = Boolean(home) && home !== '?' && io.isDirectory(home)
  if (!homeOk) {
    add(checks, 'FAIL', 'home-missing', 'The user home directory cannot be resolved',
      `home = ${home || '(empty)'} (USERPROFILE / HOME / user.home)`,
      'Set USERPROFILE (Windows) or HOME to a real writable directory and restart the terminal. Gradle daemons started before the change keep the old value — run .\\android\\gradlew.bat --stop.')
  } else {
    add(checks, 'OK', 'home', 'User home directory exists', home, '')
  }
  if (/[^\x00-\x7F]/.test(home || '')) {
    add(checks, 'WARN', 'home-nonascii', 'User home path contains non-ASCII characters',
      home,
      'AGP has known failures with non-ASCII Windows paths. Prefer an ASCII profile path; do NOT work around it with android.overridePathCheck=true.')
  }

  // AGP's AndroidDirectoryCreator is what actually fails here: it calls
  // Files.createDirectories(prefsLocation) and throws if the path is a file.
  // If the folder would be derived from a home we already know is broken, one
  // blocker is enough — do not pile on three follow-on errors.
  if (!(candidates.length === 0 && !homeOk)) {
    if (io.isFile(prefsFolder)) {
      add(checks, 'FAIL', 'prefs-is-file', 'Android preferences path is a file, not a folder',
        prefsFolder,
        `Delete/rename that file and create the directory: New-Item -ItemType Directory -Force -Path "${prefsFolder}"`)
    } else if (!io.isDirectory(prefsFolder)) {
      const parent = p.dirname(prefsFolder)
      if (!io.isDirectory(parent)) {
        add(checks, 'FAIL', 'prefs-parent-missing', 'Parent of the Android preferences folder does not exist',
          `${prefsFolder} (parent ${parent})`,
          `Fix ANDROID_USER_HOME / USERPROFILE so the parent exists, or create ${parent}.`)
      } else {
        try {
          io.mkdirp(prefsFolder)
          add(checks, 'OK', 'prefs-created', 'Created the missing Android preferences folder', prefsFolder, '')
        } catch (error) {
          add(checks, 'FAIL', 'prefs-unwritable', 'Cannot create the Android preferences folder',
            `${prefsFolder}: ${error.message}`,
            'Point ANDROID_USER_HOME at a writable folder on an existing drive, or fix the folder permissions.')
        }
      }
    }
    if (io.isDirectory(prefsFolder)) {
      try {
        io.probe(prefsFolder)
        add(checks, 'OK', 'prefs-writable', 'Android preferences folder is writable', prefsFolder, '')
      } catch (error) {
        add(checks, 'FAIL', 'prefs-unwritable', 'Android preferences folder is not writable',
          `${prefsFolder}: ${error.message}`,
          'Grant write access, or set ANDROID_USER_HOME to a folder you own (e.g. %USERPROFILE%\\.android).')
      }
    }
  }

  // --- SDK location (the next failure after the preferences folder) ---
  const sdkDirEntry = localProps.get('sdk.dir')
  if (sdkDirEntry && hasLooseBackslashes(sdkDirEntry.raw)) {
    add(checks, 'WARN', 'sdk-dir-escaping', 'sdk.dir in local.properties uses single backslashes',
      `${sdkDirEntry.raw} is read as ${sdkDirEntry.value}`,
      'Use doubled backslashes or forward slashes. Best: let Flutter rewrite the file with `flutter config --android-sdk <path>` then `flutter pub get`.')
  }
  const sdkSources = []
  if (sdkDirEntry) sdkSources.push({ name: 'sdk.dir', value: sdkDirEntry.value })
  for (const name of SDK_VARS) {
    const value = getenv(env, name)
    if (value) sdkSources.push({ name, value: String(value).trim() })
  }
  const normaliseSdk = (value) => p.isAbsolute(value) ? p.normalize(value) : p.resolve(root, value)
  // AGP reads local.properties *first*. A broken sdk.dir therefore wins over a
  // perfectly good ANDROID_HOME and produces "SDK location not found" later.
  if (sdkDirEntry && !io.isDirectory(normaliseSdk(sdkDirEntry.value))) {
    add(checks, 'FAIL', 'sdk-dir-invalid', 'sdk.dir does not point at an existing SDK directory',
      `${sdkDirEntry.raw} is read as ${sdkDirEntry.value}`,
      'Delete android/local.properties and run `flutter pub get` (Flutter rewrites sdk.dir from `flutter config --android-sdk`). It is gitignored and machine-local.')
  }
  const distinctSdk = new Set(sdkSources.map((s) => keyOf(normaliseSdk(s.value), win)))
  if (sdkSources.filter((s) => s.name !== 'sdk.dir').length === 2 && distinctSdk.size > 1) {
    add(checks, 'WARN', 'sdk-vars-conflict', 'ANDROID_HOME and ANDROID_SDK_ROOT disagree',
      sdkSources.map((s) => `${s.name}=${s.value}`).join('\n    '),
      'Both are read and the first hit wins. Set both to the same SDK directory.')
  }
  const sdkPath = sdkSources.map((s) => normaliseSdk(s.value)).find((candidate) => io.isDirectory(candidate))
  if (!sdkPath) {
    add(checks, 'FAIL', 'sdk-not-found', 'No Android SDK directory exists at the configured paths',
      sdkSources.length ? sdkSources.map((s) => `${s.name}=${s.value}`).join('\n    ') : 'no sdk.dir, ANDROID_HOME or ANDROID_SDK_ROOT is set',
      'Install Android SDK Platform 36 in Android Studio > SDK Manager, then `flutter config --android-sdk "<sdk path>"` and `flutter pub get`.')
  } else {
    add(checks, 'OK', 'sdk', 'Android SDK directory found', sdkPath, '')
    if (!io.isDirectory(p.join(sdkPath, 'platforms', 'android-36'))) {
      add(checks, 'WARN', 'sdk-platform-36', 'Android SDK Platform 36 is missing',
        `compileSdk/targetSdk are 36 in android/app/build.gradle`,
        'SDK Manager > SDK Platforms > Android 16.0 (API 36), then rebuild.')
    }
    if (!io.isDirectory(p.join(sdkPath, 'build-tools'))) {
      add(checks, 'WARN', 'sdk-build-tools', 'Android SDK Build-Tools are missing', sdkPath,
        'SDK Manager > SDK Tools > Android SDK Build-Tools.')
    }
  }
  const flutterSdk = localProps.get('flutter.sdk')
  if (!flutterSdk) {
    add(checks, 'WARN', 'flutter-sdk-missing', 'flutter.sdk is not in android/local.properties',
      'android/settings.gradle asserts this value.',
      'Run `flutter pub get` from the repo root — Flutter regenerates local.properties.')
  } else if (!io.isDirectory(flutterSdk.value)) {
    add(checks, 'WARN', 'flutter-sdk-invalid', 'flutter.sdk points at a missing Flutter SDK',
      flutterSdk.value, 'Run `flutter pub get` from the repo root to rewrite local.properties.')
  }

  if (!io.isFile(at('android', 'app', 'google-services.json'))) {
    add(checks, 'WARN', 'google-services', 'android/app/google-services.json is missing',
      'The Google Services Gradle plugin needs it at :app:processDebugGoogleServices.',
      'Download it from Firebase console > Project settings > Your apps > Android (package com.haciendadeluisana.client2). See docs/FIREBASE_SETUP.md.')
  }

  if (/\s/.test(root)) {
    add(checks, 'WARN', 'project-path-spaces', 'The project path contains spaces', root,
      'Gradle usually copes, but NDK/cmake/aapt2 tooling on Windows sometimes does not. If later steps fail, move the checkout to an ASCII path without spaces (e.g. D:\\hacienda\\hacienda-de-luisana).')
  }
  if (/[^\x00-\x7F]/.test(root)) {
    add(checks, 'WARN', 'project-path-nonascii', 'The project path contains non-ASCII characters', root,
      'AGP refuses non-ASCII project paths. Move the checkout to an ASCII path; android.overridePathCheck=true only turns this into the AndroidLocationsBuildService error.')
  }

  if (javaVersion === null) {
    add(checks, 'WARN', 'java-unknown', 'Could not determine the Java version', '`java -version` did not run.',
      'AGP 8.11.1 / Gradle 8.14 need JDK 17 or newer (Android Studio JBR is fine).')
  } else if (javaVersion < 17) {
    add(checks, 'FAIL', 'java-old', `Java ${javaVersion} is too old`,
      'AGP 8.11.1 requires JDK 17+.',
      'Use the JDK bundled with Android Studio (Settings > Build > Gradle > Gradle JDK).')
  } else {
    add(checks, 'OK', 'java', `Java ${javaVersion} is supported`, 'AGP 8.11.1 needs JDK 17+.', '')
  }

  const gradleUserHome = getenv(env, 'GRADLE_USER_HOME')
  if (gradleUserHome && !io.isDirectory(gradleUserHome)) {
    add(checks, 'WARN', 'gradle-user-home', 'GRADLE_USER_HOME points at a missing directory', gradleUserHome,
      'Gradle will try to create it; if it cannot, configuration fails early. Create it or unset the variable.')
  }

  return { checks, prefsFolder, home, sdkPath: sdkPath || null, win, p, root, homeOverride: override || null }
}

// ---------------------------------------------------------------------------
// Real machine
// ---------------------------------------------------------------------------

const realIO = {
  isDirectory: (f) => { try { return fs.statSync(f).isDirectory() } catch { return false } },
  isFile: (f) => { try { return fs.statSync(f).isFile() } catch { return false } },
  mkdirp: (f) => fs.mkdirSync(f, { recursive: true }),
  probe: (dir) => {
    const probe = path.join(dir, `.hdl-android-preflight-${process.pid}`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
  },
  readFile: (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } },
}

function detectJavaVersion() {
  const result = spawnSync('java', ['-version'], { encoding: 'utf8' })
  const text = `${result.stdout || ''}${result.stderr || ''}`
  const match = text.match(/version\s+"(\d+)(?:\.(\d+))?/) || text.match(/openjdk\s+(\d+)/)
  if (!match) return null
  const major = Number(match[1])
  return major === 1 ? Number(match[2] || 8) : major // "1.8.0_..." -> 8
}

function fixSnippet({ win, home, prefsFolder, sdkPath, p, root, homeOverride }) {
  const sdk = sdkPath || (win ? p.join(home || '', 'AppData', 'Local', 'Android', 'Sdk') : p.join(home || '', 'Android', 'Sdk'))
  // The repair always returns to the default, writable location rather than
  // trusting a possibly broken ANDROID_USER_HOME we were asked to diagnose.
  const prefs = home && home !== '?' ? p.join(home, '.android') : prefsFolder
  const carrier = homeOverride ? String(homeOverride.from).split(' ')[0] : null
  const staleHomeLine = !homeOverride ? '' : PROP_CARRIERS.includes(carrier)
    ? (win
        ? `Remove-Item Env:${carrier} -ErrorAction SilentlyContinue # drop stale -Duser.home; re-add any proxy flags afterwards\n`
        : `unset ${carrier} # drop stale -Duser.home; re-add other flags afterwards\n`)
    : `# Remove ${homeOverride.from} from android/gradle.properties (stale -Duser.home)\n`
  if (win) {
    return `# PowerShell — run from ${root}, then start a NEW terminal afterwards
# (the edits below are for the current session; use System Properties >
#  Environment Variables to make them permanent, then reopen PowerShell)
Remove-Item Env:ANDROID_PREFS_ROOT, Env:ANDROID_SDK_HOME -ErrorAction SilentlyContinue
${staleHomeLine}$env:ANDROID_USER_HOME = "${prefs}"
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME | Out-Null
$env:ANDROID_SDK_ROOT = "${sdk}"
$env:ANDROID_HOME     = $env:ANDROID_SDK_ROOT
flutter config --android-sdk $env:ANDROID_SDK_ROOT
flutter pub get
.\\android\\gradlew.bat --stop     # drop a daemon holding stale env values
flutter clean
flutter run`
  }
  return `# bash / zsh — run from ${root}
unset ANDROID_PREFS_ROOT ANDROID_SDK_HOME
${staleHomeLine}export ANDROID_USER_HOME="${prefs}"
mkdir -p "$ANDROID_USER_HOME"
export ANDROID_SDK_ROOT="${sdk}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
flutter config --android-sdk "$ANDROID_SDK_ROOT"
flutter pub get
./android/gradlew --stop
flutter clean
flutter run`
}

function selfTest() {
  const win = true
  const p = path.win32
  const base = 'D:\\hacienda\\hacienda-de-luisana'
  const home = 'C:\\Users\\dev'
  const sdk = 'C:\\Users\\dev\\AppData\\Local\\Android\\Sdk'
  const fakeIO = ({ dirs = [], files = [], blocked = {}, texts = {} } = {}) => {
    const dirSet = new Set(dirs)
    return {
      isDirectory: (f) => dirSet.has(f),
      isFile: (f) => files.includes(f),
      mkdirp: (f) => { if (blocked.mkdir === f) throw new Error('EACCES'); dirSet.add(f) },
      probe: (f) => { if (blocked.probe === f) throw new Error('EACCES') },
      readFile: (f) => texts[f] || '',
    }
  }
  const goodDirs = [home, p.join(home, '.android'), sdk, p.join(sdk, 'platforms'),
    p.join(sdk, 'platforms', 'android-36'), p.join(sdk, 'platform-tools'),
    p.join(sdk, 'build-tools'), 'C:\\flutter', base]
  const googleServices = p.join(base, 'android', 'app', 'google-services.json')
  const goodTexts = {
    [p.join(base, 'android', 'local.properties')]:
      `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\nflutter.sdk=C\\:\\\\flutter\n`,
  }
  const ctx = (overrides = {}) => ({
    env: { USERPROFILE: home, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
    io: fakeIO({ dirs: goodDirs, files: [googleServices], texts: goodTexts }),
    win, root: base, homedir: home, javaVersion: 21, ...overrides,
  })
  const cases = [
    ['clean machine', ctx(), [], []],
    ['conflicting prefs vars', ctx({ env: { USERPROFILE: home, ANDROID_HOME: sdk, ANDROID_USER_HOME: p.join(home, '.android'), ANDROID_PREFS_ROOT: 'D:\\prefs' } }),
      ['prefs-conflict'], []],
    ['same literal value still conflicts (parent semantics)', ctx({ env: { USERPROFILE: home, ANDROID_HOME: sdk, ANDROID_USER_HOME: home, ANDROID_PREFS_ROOT: home } }),
      ['prefs-conflict'], []],
    ['missing home', ctx({ env: { USERPROFILE: 'C:\\Users\\gone', ANDROID_HOME: sdk } }),
      ['home-missing'], []],
    ['prefs path is a file', ctx({ io: fakeIO({ dirs: goodDirs, files: [googleServices, p.join(home, '.android')], texts: goodTexts }) }),
      ['prefs-is-file'], []],
    ['unwritable prefs folder', ctx({ io: fakeIO({ dirs: goodDirs, files: [googleServices], texts: goodTexts, blocked: { probe: p.join(home, '.android') } }) }),
      ['prefs-unwritable'], []],
    ['stale -Duser.home', ctx({ env: { USERPROFILE: home, ANDROID_HOME: sdk, GRADLE_OPTS: '-Duser.home=C:\\Users\\deleted -Xmx2g' } }),
      ['user-home-override', 'home-missing'], []],
    ['single-backslash sdk.dir', ctx({ io: fakeIO({ dirs: goodDirs, files: [googleServices], texts: { [p.join(base, 'android', 'local.properties')]: `sdk.dir=${sdk}\n` } }) }),
      ['sdk-dir-invalid'], ['sdk-dir-escaping']],
    ['no SDK at all', ctx({ env: { USERPROFILE: home }, io: fakeIO({ dirs: [home, p.join(home, '.android'), base, 'C:\\flutter'], files: [googleServices], texts: {} }) }),
      ['sdk-not-found'], []],
    ['ANDROID_SDK_HOME = SDK root', ctx({ env: { USERPROFILE: home, ANDROID_HOME: sdk, ANDROID_SDK_HOME: sdk } }),
      ['sdk-home-is-sdk-root'], []],
    ['old Java', ctx({ javaVersion: 11 }), ['java-old'], []],
    ['non-ASCII project path', ctx({ root: 'D:\\Proyectos-ñ\\hacienda-de-luisana' }), [], ['project-path-nonascii']],
  ]
  let failed = 0
  // The repair block must stay copy-pasteable PowerShell, including the extra
  // line that clears a stale -Duser.home carrier.
  const snippet = fixSnippet({ win, home, prefsFolder: p.join(home, '.android'), sdkPath: sdk, p, root: base,
    homeOverride: { from: 'GRADLE_OPTS -Duser.home', value: 'C:\\Users\\deleted' } })
  const snippetChecks = [
    snippet.includes('Remove-Item Env:ANDROID_PREFS_ROOT'),
    snippet.includes(`$env:ANDROID_USER_HOME = "${p.join(home, '.android')}"`),
    snippet.includes('Remove-Item Env:GRADLE_OPTS'),
    snippet.includes('flutter config --android-sdk'),
    snippet.includes('.\\android\\gradlew.bat --stop'),
  ]
  if (snippetChecks.every(Boolean)) console.log('ok   PowerShell repair snippet')
  else { failed++; console.log(`FAIL PowerShell repair snippet: ${snippetChecks}`) }
  for (const [name, c, mustFail, mustWarnOrFail] of cases) {
    const { checks } = checkAndroidEnv(c)
    const codes = checks.map((x) => x.code)
    const blockers = checks.filter((x) => x.level === 'FAIL').map((x) => x.code)
    const missing = mustFail.filter((code) => !blockers.includes(code))
    const missingAny = mustWarnOrFail.filter((code) => !codes.includes(code))
    const unexpected = blockers.filter((code) => !mustFail.includes(code) && !mustWarnOrFail.includes(code))
    if (missing.length || missingAny.length || unexpected.length) {
      failed++
      console.log(`FAIL ${name}: missing=[${missing}] missingAny=[${missingAny}] unexpected blockers=[${unexpected}] all=[${codes}]`)
    } else {
      console.log(`ok   ${name}`)
    }
  }
  return failed
}

function main() {
  if (process.argv.includes('--self-test')) {
    const failed = selfTest()
    console.log(failed ? `\n${failed} self-test case(s) failed` : `\nAll self-test cases passed`)
    process.exitCode = failed ? 1 : 0
    return
  }
  const result = checkAndroidEnv({
    env: process.env, io: realIO, win: process.platform === 'win32', root: ROOT,
    homedir: os.homedir(), javaVersion: detectJavaVersion(),
  })
  console.log('Android build pre-flight — AGP 8.11.1 / Gradle 8.14 / compileSdk 36')
  console.log('='.repeat(72))
  const order = { FAIL: 0, WARN: 1, OK: 2 }
  for (const c of [...result.checks].sort((a, b) => order[a.level] - order[b.level])) {
    console.log(`[${c.level.padEnd(4)}] ${c.title}`)
    if (c.detail && c.level !== 'OK') console.log(`        ${c.detail}`)
    if (c.fix && c.level !== 'OK') console.log(`        fix: ${c.fix}`)
  }
  const blockers = result.checks.filter((c) => c.level === 'FAIL')
  const warnings = result.checks.filter((c) => c.level === 'WARN')
  console.log('='.repeat(72))
  console.log(`${blockers.length} blocker(s), ${warnings.length} warning(s).`)
  if (blockers.length || warnings.length) {
    console.log('\nRepair / rebuild (copy the whole block):\n')
    console.log(fixSnippet(result))
    console.log('\nMake the environment-variable changes permanent in System Properties >')
    console.log('Environment Variables (or `setx ANDROID_SDK_ROOT "<path>"`), then open a NEW')
    console.log('terminal so the Gradle daemon inherits the corrected values.')
    console.log('\nStill opaque? Run `flutter run -v` or `.\\android\\gradlew.bat --stacktrace`')
    console.log('to see the underlying AndroidLocationsException, and read docs/ANDROID.md §5.1.')
  } else {
    console.log('Environment looks good. If the build still fails, capture `flutter run -v`')
    console.log('and `--stacktrace` output — that is an AGP/toolchain issue, not a machine path.')
  }
  process.exitCode = blockers.length ? 1 : 0
}

main()
