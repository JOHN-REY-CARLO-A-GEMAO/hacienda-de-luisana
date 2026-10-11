# Directory rename audit — `src/` → `web/` and `lib/` → `app/`

**Audit date:** 2026-10-11
**Repository:** `JOHN-REY-CARLO-A-GEMAO/hacienda-de-luisana`
**Audited commit:** `5f0dc84` (`main`) — working branch `arena/30f1d31d-hacienda-de-luisana`
**Scope:** Phase 1 (audit) and Phase 2 (plan). Findings are stated per request in the order
they were asked for; the Flutter verdict is in §1.5 and the plan in §2.

---

## 0. Verdict in one paragraph

* **`src/` → `web/` (Guest website): SUPPORTED.** Every internal web import is relative, no
  Vite/TS/Tailwind/Vitest alias points at `src/`, and no configuration keys off the directory
  name. The rename is a `git mv` plus **10 functional edit sites** and **zero** changes to the
  contents of the 110 renamed web source files — which the repository's own characterization
  fixture can *prove*, because it pins their SHA-256 hashes by path. **Implemented** (Phase 3).
* **`lib/` → `app/` (Flutter Admin app): NOT SUPPORTED without disproportionate tooling
  changes.** `lib/` is not a convention in the Dart/Flutter toolchain, it is hard-coded:
  `package:` URIs for the root package resolve to `<project>/lib/` and `pub` writes that mapping
  into `.dart_tool/package_config.json` on every `pub get`. The repository's 16 Dart test files
  import the app through `package:hacienda_de_luisana/…` (41 import lines). Nothing in
  `pubspec.yaml` can move that. **Stopped before implementing**, per the instruction in the
  brief. §1.5 gives the evidence; §2.6 gives the supported alternative.

---

## 1. Phase 1 — Audit

### 1.1 Repository shape (baseline)

| | Path | Files (tracked) | Runtime |
|---|---|---|---|
| Guest website | `src/` | 143 | React 18 + TS 5.9 + Vite 5.4 + Tailwind 3.4, Vitest 3.2, jsdom |
| Admin app | `lib/` | 75 (57 Dart + assets) | Flutter `>=3.2.0 <4.0.0`, Riverpod, Firebase, Android + iOS |
| Web tests | `test/web`, `test/phase0`, `test/rules`, `test/e2e`, `test/emulator` | 106 `.ts/.tsx` | Vitest (7 configs) |
| Dart tests | `test/*.dart`, `test/phase0/dart/` | 16 `.dart` | `flutter test` |
| Native shells | `android/`, `ios/` | 47 | Flutter tooling (`flutter { source '../..' }`) |
| Rules / backend | `firestore.rules`, `storage.rules`, `database.rules.json`, `supabase/` | 8 | Firebase + Supabase |

Git note: the checkout is a **shallow clone (depth 1)**, one commit
(`5f0dc84`, released as PR #58). History preservation therefore means
`git mv` (rename-detected diff) rather than `git log --follow` continuity to earlier work.

Reference census (whole repo, tracked files, `src/` counted excluding Android's `app/src/`):

| Token | Files | Occurrences |
|---|---|---|
| `src/` | 189 | 738 |
| `lib/` | 229 | 879 |

Most of those are prose. The functional subsets are enumerated below — that distinction is the
whole point of this audit, because a naive global `s/lib/app/` would corrupt `web/lib/`,
`android/app/src/…`, dependency paths inside `package-lock.json`/`pnpm-lock.yaml`, and the
`firebase-tools lib/emulator/…` comment in `scripts/phase0/boundary.mjs`.

### 1.2 Every functional reference to `src/` (web) — must change

| # | Site | Kind | Count | Notes |
|---|---|---|---|---|
| 1 | `index.html:72` | Vite entry | 1 | `<script type="module" src="/src/main.tsx">` |
| 2 | `tailwind.config.js:3` | content glob | 1 | `content: ['./index.html', './src/**/*.{ts,tsx}']` |
| 3 | `tsconfig.app.json` | `include` | 1 | `["src"]` |
| 4 | `tsconfig.test.json` | `include` | 1 | `["test/web", "src", "vitest.config.ts"]` |
| 5 | `tsconfig.phase0.json` | `include` | 1 | `["src", "test/phase0/**/*.ts", …]` |
| 6 | `vite.config.ts` | 4 static imports + build-log strings | 8–11 | imports `./src/lib/{firebaseConfig,firebaseDefaults,supabaseConfig,supabaseDefaults}`; the `[firebase]`/`[supabase]` banners name `src/lib/*Defaults.ts` in operator-facing text |
| 7 | `test/**/*.{ts,tsx}` | relative import specifiers | **214** | 207 × `'../../src/…'`, 7 × `'../../../src/…'` |
| 8 | `test/**/*.{ts,tsx}` | `vi.mock` / `vi.doMock` / dynamic `import(...)` | 20+ | e.g. `test/phase0/doubles/cloud.ts:19`, `test/phase0/emulator/{auth-review,concurrency-harness}.ts` (the `'../../../src/…'` forms) |
| 9 | `test/**/*.{ts,tsx}` | filesystem paths (`join(__dirname, '../../src/…')`, `readdirSync`) | 9 sites / 7 files | `auth-admin-not-on-web`, `auth-roles` (module dir), `booking-module-purity` (`MODULE_DIR`), `date-hold-cloud`, `live-location` (×3), `payment-contract` |
| 10 | `test/phase0/fixtures/production-baseline.json` | 110 hash-table **keys** | 110 | hashes themselves must **not** change |
| 11 | `test/phase0/foundation.characterization.test.ts` | `source('src/…')` literals | 6 | lines 58, 63, 71, 72, 73, 89 |
| 12 | `docs/qa/booking-lead-time-browser-test.mjs` | Vite dev-server module URLs | 3 | `await import('/src/lib/firestoreBookings.ts')`, `'/src/lib/supabase.ts'` |
| 13 | `.github/workflows/deploy.yml` | comments in CI | 2 | non-functional, must not go stale |

**Non-functional `src/` references** (prose only, left alone in the mechanical commit — see §2.4):
comments/messages inside the pinned web files themselves (41 occurrences in ~30 files, e.g.
`web/lib/firebase.ts:127`, `web/pages/StatusPage.tsx:292`), `firestore.rules` (10),
`test/rules/context.ts` (6), `supabase/01-storage.sql` (3), `docs/**` (~250),
`Project_Folders_Structure_Blueprint.md` (48), `AGENTS.md`, `CONTEXT.md`, `docs/agents/domain.md`,
extension READMEs, and `package-lock.json` (2, dependency-internal — must **not** change).

**Vendored agent skills** (`.agents/skills/**`, `.claude/skills/**`): the `src/` hits there are
generic examples about *other* repositories (e.g. `src/ordering/CONTEXT.md`). **Do not change** —
they are not this repository's paths (only `.claude`/`.agents` are duplicates of each other).

**Explicitly NOT to be touched** although they contain the token `src/`:
`android/app/src/main/**` (Android source set) incl. `.gitignore:57` and
`test/phase0/fixtures/production-baseline.json`'s 17 `android/…` keys; `android/gradlew:60`
(a Gradle URL); `test/phase0/fixtures/production-baseline.json`'s `ios/…` keys.

### 1.3 Vitest / Vite / TS configuration review

* All 7 Vitest configs (`vitest.config.ts`, `.e2e`, `.emulator`, `.local`, `.phase0`, `.probe`,
  `.rules`, `.tmptest`) key off `test/**`, **never** `src` → no change needed.
* No `resolve.alias`, no `tsconfig.paths`, no `@/` prefix anywhere → relative imports only, so
  **file contents under `src/` do not have to change at all** when the directory moves.
* `vitest.local.config.ts`, `vitest.probe.config.ts`, `vitest.tmptest.config.ts` are orphan
  configs (no npm script). `vitest.probe.config.ts` pins a stale absolute Windows path
  (`root: 'D:/Downloads/11_hacienda/hacienda-de-luisana'`) — **pre-existing defect**, out of scope.
* `vite.config.ts` `manualChunks`, `base: '/'`, `allowedHosts`, dev/preview ports → unaffected by
  the directory name.

### 1.4 Firebase / Supabase / deployment review

* `firebase.json` hosting root is `dist` → unaffected. Its `flutter.platforms.dart` key
  (`lib/firebase_options.dart`) is **Flutter-side** and pinned by hash; untouched.
* `firestore.rules`, `storage.rules`, `database.rules.json` reference `src/…` in **comments only**;
  they are hash-pinned (§1.6). Untouched — no rule semantics change, no security change.
* `.firebaserc`, `vercel.json` (`cleanUrls` + rewrite to `/`), `firebase.json` rewrites → no path
  coupling to `src/`.
* `.github/workflows/deploy.yml` runs `npm ci` → `npm run build` (`tsc -b && vite build`) → copies
  `dist/`. No step references `src/` except comments.
* `package.json` scripts all route through `scripts/phase0/run.mjs` with fixed actions; **no script
  names a web source directory**. `scripts/phase0/inside.mjs` touches only `test/**` for the web
  suites.

### 1.5 Flutter verdict: can `lib/` become `app/`? — **No** (evidence)

1. **`pub` hard-codes the package source directory.** In `dart-lang/pub`
   (`lib/src/entrypoint.dart`) the root package entry is written as

   ```dart
   PackageConfigEntry(
     name: package.name,
     rootUri: p.toUri(p.relative(package.dir, from: …)),
     packageUri: p.toUri('lib/'),      // ← hard-coded, no pubspec knob
   ```

   and pub itself refuses any config that disagrees ("Pub always makes a packageUri of lib/",
   same file, ~line 1004). There is **no `lib_dir`-style field in the pubspec format**.
2. **Consequence for this repository:** all 16 Dart test files import the app as
   `package:hacienda_de_luisana/…` (41 lines, e.g. `test/pin_layout_test.dart:30-35`,
   `test/booking_lifecycle_test.dart:7`). Those resolve to `<root>/lib/…`. With the code under
   `app/`, `flutter test` / `flutter analyze` cannot resolve a single one of them, and
   `package:hacienda_de_luisana` becomes an empty package.
3. **The entry point is overridable, the package root is not.** `flutter build apk` defaults
   `--target` to `lib/main.dart` (`packages/flutter_tools/lib/src/runner/options/common_options.dart:26-28`)
   and the Gradle plugin exposes `flutter { target "…" }` for the *entry file*
   (`FlutterExtension.kt`: "Allows to override the target file. Otherwise, the target is
   lib/main.dart"). That fixes the *entry point only* — it does nothing for `package:` resolution,
   asset bundling, or `flutter test`.
4. **`.dart_tool/package_config.json` is regenerated, not configurable.** `scripts/phase0/inside.mjs`
   gates every Flutter action on that file existing, and `flutter pub get` rewrites it. Post-editing
   `packageUri` is not durable and would silently revert on the next `pub get`.
5. **The two workarounds are both disproportionate:**
   * *Symlink `lib/ → app/`:* works on Linux/macOS, but (a) it makes the rename cosmetic — `lib/`
     still exists and every tool still reports `lib/…` paths; (b) it requires Developer Mode or
     admin rights on Windows, and this repository is demonstrably worked on from Windows
     (`vitest.probe.config.ts` pins `D:/Downloads/…`); (c) the analyzer may see the same file under
     two paths (`app/…` and `lib/…`) — a duplicate-declaration class of failure that no test in the
     repo can catch offline.
   * *Shim `lib/` re-exporting `app/`:* ~41 boilerplate files, on top of the entry-point override;
     the app's own classes become second-class (files outside `lib/` are not part of the package's
     public surface), and `flutter analyze` would flag the shim tree.
6. **No tooling assumption in `android/` or `ios/` needs changing** — `android/app/build.gradle`
   uses `flutter { source '../..' }` (the *project* root) and the iOS build phases call
   `xcode_backend.sh`, which reads the target from `Generated.xcconfig`. So a move would fail in
   Dart resolution *before* touching native builds; the failure would appear as hundreds of
   "Target of URI doesn't exist" errors, i.e. it would look like a broken app rather than a path
   error.
7. **Tool-level references that would also need updating** if it were attempted: `firebase.json`
   (`flutter.platforms.dart["lib/firebase_options.dart"]`), `.metadata`
   (`unmanaged_files: ['lib/main.dart']`), `docs/` (every Dart path), and the 57 `lib/…` keys of
   `production-baseline.json`.

8. **This sandbox cannot test the claim either way**, and that was established by probe rather than
   assumed — see §4.7. The verdict above therefore rests on the tool's own source (points 1 and 3),
   not on a failed attempt to run something.

**Verdict:** the Flutter half of the request cannot be supported safely, and the supported
alternative is a different (larger) change — see §2.6. Per the brief, it is **stopped before
implementation** and the Admin app is left byte-identical in this migration.

### 1.6 The characterization fixture is the constraint that shapes the plan

`test/phase0/fixtures/production-baseline.json` (`baselineCommit 5297ec7`, algorithm `sha256`)
pins **210** files by path → hash, asserted by
`test/phase0/foundation.characterization.test.ts` ("all 210 pinned production source/config/lock
files remain byte-identical to the authorized baseline"). Its composition:

| Prefix | Keys | Relevance to this migration |
|---|---|---|
| `src/…` | 110 | paths change, **contents must not** |
| `lib/…` | 57 | Flutter app — untouched |
| `android/…`, `ios/…` | 27 | untouched |
| `supabase/…` | 3 | untouched (comments only) |
| rules + `firebase.json` + `vercel.json` | 5 | untouched — **this is what proves security rules were not weakened** |
| `pubspec.yaml`, `pubspec.lock`, `package-lock.json` | 3 | untouched |
| `.env.example`, `.firebaserc`, `storage.cors.json` | 3 | untouched |
| `vite.config.ts` | 1 | **must change** (its 4 imports) → its hash is legitimately re-recorded |

Everything else the migration touches — `index.html`, `tailwind.config.js`, all `tsconfig*.json`,
`vitest.*.ts`, `package.json`, `test/**`, `docs/**`, `.github/**` — is **not** pinned, so it can be
edited without weakening the gate. Files that are pinned and *not* functionally required to change
are left byte-identical on purpose: after this migration the fixture will show exactly **one**
content change among 210 pinned files (`vite.config.ts`, four import specifiers plus operator-facing
log text), and the other 109 pinned hashes will continue to match.

---

## 2. Phase 2 — Migration plan (`src/` → `web/`)

### 2.1 Step list (exact)

**Step 0 — preconditions.** Working tree clean; branch `arena/30f1d31d-hacienda-de-luisana`.
Baseline recorded (§3.1).

**Step 1 — move (history-preserving).**
```bash
git mv src web          # 143 files, rename-detected, no content change
```

**Step 2 — functional edits (all outside `web/`).**

| File | Edit |
|---|---|
| `index.html` | `/src/main.tsx` → `/web/main.tsx` |
| `tailwind.config.js` | `'./src/**/*.{ts,tsx}'` → `'./web/**/*.{ts,tsx}'` |
| `tsconfig.app.json` | `"include": ["src"]` → `["web"]` |
| `tsconfig.test.json` | `"include": ["test/web","src",…]` → `[…,"web",…]` |
| `tsconfig.phase0.json` | `"include": ["src", …]` → `["web", …]` |
| `vite.config.ts` | 4 imports `./src/lib/…` → `./web/lib/…`; same for the `src/lib/*Defaults.ts` names inside the `[firebase]`/`[supabase]` banner text |
| `test/**/*.{ts,tsx}` | `'../../src/` → `'../../web/`; `'../../../src/` → `'../../../web/` (mechanical; identical depth, so every specifier stays valid) |
| `test/phase0/fixtures/production-baseline.json` | re-key `src/…` → `web/…` (110 keys), **hashes untouched**, 210 keeps its length; block re-sorted to keep the key order invariant |
| `test/phase0/foundation.characterization.test.ts` | 6 × `source('src/…')` → `source('web/…')` |
| `docs/qa/booking-lead-time-browser-test.mjs` | 3 × `/src/lib/…` → `/web/lib/…` |
| `.github/workflows/deploy.yml` | 2 comment references |

**Step 3 — assert the invariant.** The 110 `web/**` files must have the same SHA-256 as the old
`src/**` keys (script check, §3.2), and `git diff -M --stat` must show renames with no content
change under `web/`.

**Step 4 — documentation sweep (separate commit, unpinned files only).** `docs/**`, `AGENTS.md`,
`CONTEXT.md`, `Project_Folders_Structure_Blueprint.md`, `docs/agents/domain.md`, extension
READMEs (`assets/**`, `public/**`), `.github/workflows/deploy.yml`, plus the prose in
`test/**`. **Excluded on purpose:** comments/strings *inside* the pinned `web/**` files,
`firestore.rules`/`storage.rules`/`supabase/01-storage.sql`, and `pubspec.yaml`/`.metadata`
(Flutter side) — editing them would invalidate their pinned hashes for cosmetics (§2.4).

### 2.2 What deliberately does not change

* Every byte of `android/`, `ios/`, `lib/`, `pubspec.*`, `firestore.rules`, `storage.rules`,
  `database.rules.json`, `firebase.json`, `vercel.json`, `supabase/**`, `package-lock.json`,
  `pnpm-lock.yaml`.
* Every byte of the 110 moved web files (§3.2 proves it).
* Business logic, booking lifecycle, auth, money handling, chat retention, live-location policy,
  security rules, CI steps, deployment behaviour. The migration is a *name* change.

### 2.3 Compatibility issues found (and their handling)

| Risk | Why it bites | Handling |
|---|---|---|
| Naive `s/lib/app/` corrupts `web/lib/**` | 1000+ tokens | Only edit Dart-side paths; `lib/` is **not** renamed at all |
| Naive `s/src/web/` corrupts `android/app/src/…` | 17 pinned keys + `.gitignore` | Anchor edits to repo-relative prefixes (`./src/`, `'../../src/`, `/src/…`), never bare `src/` |
| `test/phase0/fixtures/production-baseline.json` | would fail with ENOENT for 110 files | re-key, keep hashes |
| `test/web/booking-module-purity.test.ts` | reads a *directory* off disk (`MODULE_DIR`) | path updated with the other fs sites |
| `docs/qa/*.mjs` import Vite dev URLs | browser dynamic import resolves via dev server | 3 URLs updated |
| `tsconfig.app.json` `include: ["src"]` | if missed, `tsc -b` compiles nothing and `npm run lint` passes silently | listed explicitly in Step 2 and re-checked in §3 |
| Two dirs named `web` (`web/` source, `test/web/` tests) | confusing but harmless; no glob intersects | accepted, noted in `docs/MIGRATION…` |
| `.gitignore` has no `src/`/`lib/` rule for app code | nothing to update | verified |
| Orphan `vitest.probe.config.ts` absolute Windows `root` | pre-existing, unrelated | left alone, flagged |

### 2.4 Follow-up (deliberately *not* in this PR)

1. **Comment/string sweep inside the pinned web files** (~41 references in ~30 files, e.g.
   `web/lib/firebase.ts:127`, `web/pages/StatusPage.tsx:292`, `web/lib/firebaseConfig.ts:294`).
   These are prose and one `/status` label; changing them means re-recording ~30 baseline hashes,
   which would destroy the byte-identity evidence this migration relies on. Do it as its own
   PR together with a regenerated fixture (and say so in the PR description).
2. Same for `firestore.rules` / `storage.rules` / `supabase/01-storage.sql` comments.
3. `pubspec.yaml`'s comment naming `src/lib/authLocal.ts` (Flutter side, pinned).
4. Fix the pre-existing failures in §3.1 (clock-drifted tests) — unrelated to the rename.

### 2.5 Rollback

* **Whole migration:** `git revert --no-edit <docs-sweep-sha> <rename-sha>` — the directory move
  reverts as a rename, so `src/` comes back with the same blob hashes and the fixture returns to
  its original 210 keys.
* **Rename only, keep docs:** revert just the rename commit.
* **Emergency, no history:** `git mv web src` + `git checkout <sha> -- index.html tailwind.config.js
  tsconfig*.json vite.config.ts test docs .github` restores every edited file; the fixture needs no
  manual work because it is versioned.
* Nothing outside the repository is affected: no hosted config, no Firebase rule deployment, no
  Supabase migration, no DNS. A rollback is a single `git revert` + redeploy.

### 2.6 Flutter alternative — the only supportable shape, and its exact procedure

`lib/` → `app/` as a **source-dir** rename is refused (§1.5). If the Admin app must sit under a
differently-named root, the supportable change is a **project-root move**: the whole Flutter
project — including its `lib/` — moves into `app/`. This is **not implemented here and not
verified**: it requires an SDK this sandbox cannot obtain (§4.7 explains, with the probes).

**The move** (one commit, `git mv`, history preserved):

```
app/lib/**   app/test/*_test.dart   app/test/phase0/dart/**
app/android/**   app/ios/**   app/assets/**
app/pubspec.yaml   app/pubspec.lock   app/.metadata
```

`assets/` is Flutter-only — `pubspec.yaml` declares `assets: - assets/`, the website serves its
images from `public/`, and the only reference from `web/` is a comment at `web/config/site.ts:490`
— so it travels with the project (Flutter does not resolve asset paths outside the project root).

**Then these files must change — exhaustive list, verified by inspection:**

| File | Change |
|---|---|
| `firebase.json` | `flutter.platforms.android.…fileOutput` → `app/android/app/google-services.json`; the `flutter.platforms.dart` key → `app/lib/firebase_options.dart` |
| `.metadata` | `unmanaged_files` → `app/lib/main.dart`, `app/ios/Runner.xcodeproj/project.pbxproj` |
| `.gitignore` | the **root-anchored** Flutter patterns → prefix `app/`: `android/local.properties`, `android/.gradle/`, `android/build/`, `android/app/build/`, `android/captures/`, `android/app/{debug,profile,release}/`, `android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java`, `android/app/google-services.json`. `.dart_tool/`, `.flutter-plugins*` and `**/ios/Flutter/.last_build_id` already match at any depth |
| `scripts/phase0/inside.mjs` | four edits in the `flutter*` branch: the `package_config.json` gate → `ROOT/app/.dart_tool/package_config.json`; `fs.readdirSync(path.join(ROOT,'test'))` → `ROOT/app/test`; the characterization path → `app/test/phase0/dart/characterization_test.dart`; and `cwd: ROOT` → `cwd: ROOT/app` for those runs (the shared `execute()` helper hard-codes `cwd: ROOT`) |
| `scripts/android-icons.sh` | `$ROOT/android/app/src/main/res` → `$ROOT/app/android/app/src/main/res` |
| `test/phase0/fixtures/production-baseline.json` | **86 keys re-keyed** — `lib/` 57, `android/` 17, `ios/` 10, `pubspec.yaml`, `pubspec.lock` → `app/…`; hashes verbatim, key order preserved (110 `web/` keys untouched) |
| `docs/**`, `AGENTS.md`, `CONTEXT.md`, the blueprint, `assets/**/README.md`, `web/config/site.ts:490` | prose |

**Deliberately unchanged, because they are already relative to the project root:**
`android/app/build.gradle` (`flutter { source '../..' }`), `android/settings.gradle`,
`android/gradle.properties`, the iOS build phases (`xcode_backend.sh`), and every
`pubspec.yaml` asset/icon/splash path. `.github/workflows/deploy.yml` builds only the website, so
there is **no CI change — and therefore no workflow-permission obstacle** for this half.

**Verification — mandatory, on a machine with the SDK. None of it can run here (§4.7):**

```bash
cd app && flutter pub get          # expect .dart_tool/package_config.json, root entry packageUri "lib/"
flutter analyze --no-pub           # expect: no issues found
flutter test --no-pub test/        # the 16 Dart test files
cd .. && npm run test:flutter      # the phase0 runner, now pointing at app/
flutter build apk --debug          # Android build
```

Then the same evidence standard used for the website move (§4.1): every moved file
byte-identical to its previous blob (`git cat-file` vs the working tree), all renames detected
`R100`, and the fixture's staleness set unchanged.

**Rollback:** one `git revert` — the move reverts as a rename and the fixture is versioned.
Nothing outside the repository is involved.

**If any of those five commands fails, do not merge.** The failure will be in Dart package
resolution, which is precisely what §1.5 shows cannot be worked around from the pubspec.

---

## 3. Verification

### 3.1 Baseline, before any change (this sandbox)

Environment: Linux, Node 22.22.3 / npm 10.9.8, `unshare` available, **no Flutter/Dart SDK, no Java
runtime, no Android SDK**, outbound network limited to the npm/PyPI/GitHub hosts (emulator JARs and
the Flutter SDK come from `storage.googleapis.com`, which is unreachable here).

| Check | Command | Baseline |
|---|---|---|
| Type check (app) | `npm run lint` (`tsc -b`) | **PASS** |
| Production build | `npm run build` | **PASS** (warns: firebase/supabase defaults, chunk size) |
| Phase-0 type check | `npm run check:phase0` | **FAIL, exit 2** — 3 pre-existing TS errors (`test/phase0/emulator/auth-review…:42`, `test/phase0/identity.characterization…:36`, `test/phase0/location.invariants…:32`); `tsc -b` itself passes |
| Phase-0 build | `npm run build:phase0` | **FAIL, exit 2** — same 3 errors; the Vite step is never reached |
| Web suite | `npm test` | **HANGS** at `test/web/tutorial.test.tsx` (pre-existing; reproducible standalone, even unisolated) |
| Web suite minus that file | `vitest --config vitest.local.config.ts --exclude test/web/tutorial.test.tsx` | 891 tests, **871 pass / 20 fail in 5 files** (clock drift: assertions pinned to "today = 2026-09-20"; `canonical-accommodations`, `official-rates` rate drift) |
| Security rules (offline engine) | `npm run test:rules` | **FAIL** — 7 failed / 308 passed (315) |
| End-to-end | `npm run test:e2e` | **FAIL** — 10 failed / 34 passed (44) |
| Characterization | `npm run test:phase0` | **FAIL** — 12 failed / 90 passed (102) |
| Invariants | `npm run test:invariants` | **FAIL** — 22 failed / 9 passed (31) |
| Safety harness | `npm run test:safety` | **PASS** (44 tests) |
| Flutter analyze/test | `npm run test:flutter:analyze`, `test:flutter` | **BLOCKED, exit 78** — "Flutter/Dart SDK missing" |
| Firebase emulator suite | `npm run test:emulator` | **BLOCKED, exit 78** — "Java runtime missing"; emulator artefacts are not downloadable here |
| Supabase RLS (real Postgres) | `npm run test:supabase:rls` | **BLOCKED, exit 78** — PGlite not prepared |
| Browser QA | `npm run test:qa:*` | **BLOCKED, exit 78** — Playwright/Chromium not installed |
| Android build | `flutter build apk` | **BLOCKED** — no Flutter/Dart SDK, no Java, no Android SDK |

**Baseline conclusion:** this repository is *not* green at `5f0dc84` on any machine-independent
axis — the failures are date-dependent and pre-date this work. Success for this migration is
therefore **"no new failures"**, measured per test name against the recorded baseline, not
"everything passes".

### 3.2 Post-migration checks (run in Phase 4)

1. Byte-identity of the moved tree: every `web/…` file's SHA-256 equals the recorded `src/…` hash
   (scripted, from the fixture itself).
2. `git diff -M --stat` — renames only under `web/`.
3. `npm run lint`, `npm run build` — must stay PASS.
4. Web suite with the identical baseline command — per-test diff, must be **identical**.
5. `npm run test:rules`, `test:e2e`, `test:phase0`, `test:invariants`, `test:safety` — per-test
   diff against the recorded JSON reports.
6. `npm run check:phase0`, `build:phase0` — same 3 pre-existing errors, nothing new.
7. Re-run of the blocked actions (Flutter, emulator, QA, Android) — expected to stay BLOCKED for
   environmental reasons; a *changed* blocked-reason would itself be a regression signal
   (e.g. the Flutter actions must still report "SDK missing", not a path error).
8. `npm run dev` / `vite build` smoke: `dist/index.html` references `assets/…` and no `/src/…`.

---

## 4. Phase 4 — Verification results (implemented part: `src/` → `web/`)

Commits: `a6a4abc` (this audit), `9cbff7b` (the rename), `6b8a7bc` (docs sweep).
Method: identical commands before and after, compared **per test name** (not by totals), plus
byte-level checks.

### 4.1 Movement integrity

| Check | Result |
|---|---|
| Files moved with `git mv` | 143, all detected as `R100` (100 % similarity) |
| Content identity, every renamed file (`git cat-file HEAD:src/…` vs the new working file) | **143/143 identical** |
| Characterization fixture | 210 entries preserved, 110 `src/` keys re-keyed to `web/`, **all 110 hashes byte-for-byte unchanged**, key order still sorted |
| Fixture staleness (pre-existing) | at HEAD: 58 match / 51 mismatch / 1 missing (`src/sections/Contact.tsx` was renamed to `ContactDetails.tsx` after `baselineCommit 5297ec7`); after: **58 / 51 / 1 — the same set**, so the rename added no drift and hid none |
| Production bundle | **bit-for-bit identical**: the same seven content-hashed asset names before and after (`index-QYNKdIcI.css`, `index-WsSizJZr.js`, `firebase-B60niKZF.js`, …) |

### 4.2 Checks that can run here

| Check | Baseline | After | Verdict |
|---|---|---|---|
| `npm run lint` (`tsc -b`) | PASS | PASS | same |
| `npm run build` (`tsc -b && vite build`) | PASS | PASS | same, identical bundle |
| Web suite (891 tests, `vitest.local.config.ts`, excluding the known hang) | 871 pass / 20 fail | 871 pass / 20 fail | **per-test identical** (0 added / 0 removed / 0 changed) |
| `npm run test:rules` (offline rules engine, 315) | 308 / 7 | 308 / 7 | **per-test identical** |
| `npm run test:e2e` (44) | 34 / 10 | 34 / 10 | **per-test identical** |
| `npm run test:phase0` (characterization, 102) | 90 / 12 | 90 / 12 | **per-test identical** |
| `npm run test:invariants` (31) | 9 / 22 | 9 / 22 | **per-test identical** |
| `npm run test:safety` (44) | PASS | PASS | same |
| `npm run check:phase0` / `build:phase0` | FAIL exit 2, 3 errors | FAIL exit 2, **the same 3 errors**, same files | pre-existing, unchanged |
| `npm test` (isolated Phase 0 runner) | never completes in this sandbox (stalls in `test/web/tutorial.test.tsx`); same throughput (≈1 file/min) | identical: same stall, same pre-existing failures, ≈1 file/min | pre-existing, unchanged |
| `npm run dev` smoke | — | `/` serves `<script src="/web/main.tsx">`; `/web/main.tsx`, `/web/App.tsx`, `/web/lib/firebase.ts`, `/web/styles.css` all **200**; `/src/main.tsx` now returns the SPA `index.html` fallback (HTML, not a module) | works |

### 4.3 Checks that cannot run in this sandbox (unchanged, previously blocked)

Re-run after the migration; the *reason* is identical, which is what matters for the Flutter half:

| Check | After |
|---|---|
| `npm run test:flutter:analyze`, `npm run test:flutter`, `test:flutter:invariants` | `BLOCKED` 78 — "Flutter/Dart SDK missing" (unchanged; `lib/` was never touched, so the reason did not become a path error) |
| `npm run test:emulator` | `BLOCKED` 78 — "Java runtime missing" (emulator artefacts are not fetchable here) |
| `npm run test:supabase:rls` | `BLOCKED` 78 — PGlite not prepared |
| `npm run test:qa:*` | `BLOCKED` 78 — Playwright/Chromium not installed |
| `flutter build apk` / Android build | `BLOCKED` — no Flutter, Java or Android SDK, and none can be downloaded here |

**Environment limitation, stated plainly:** the Flutter analyse/test and the Android build were
**not** exercised by this migration — and could not be, on this machine. They do not need to be for
the moved website (which they do not touch), but they *would* be mandatory before any Flutter
`lib/` change (§2.6), which is a second, independent reason that change is not attempted here.

### 4.4 Regressions found by verification, and their fixes

1. **A missed path literal** — `test/web/canonical-accommodations.test.ts:120` used
   `join(__dirname, '../../src')` (no trailing slash), so the mechanical `'../../src/` rewrite did
   not match it. Six "retired Accommodation vocabulary" tests failed (20 → 26 failures) in the
   first post-migration run. Caught by the per-test diff, fixed, re-run: back to 871/20 with zero
   status changes. The lesson is in §2.3 — path rewrites must be anchored on *whole path tokens*,
   and the fixture's own hash table is what makes a miss like this visible.
2. **One over-eager edit** — `test/web/status-page.test.tsx` asserts the literal text the `/status`
   page renders; the sed had rewritten the expected string while the (pinned) page kept rendering
   the old one. Reverted to the page's actual text. This is the reason §2.2 fixes the *contents* of
   the moved files: assertions about rendered strings keep holding.
3. **`tsconfig.app.json`** has its `include` array on three lines; an inline-only pattern left it
   pointing at `src`, and `tsc -b` failed loudly with `TS18003` (no inputs). Fixed before the
   verification run, which is why it does not appear in §4.2 — noted here because it is exactly the
   silent-failure class §2.3 warned about.

### 4.7 Why the Flutter / Android / emulator checks are BLOCKED here — probed, not assumed

The audit asserts an *environmental* limitation, so it was tested rather than declared:

| Channel | Result |
|---|---|
| `storage.googleapis.com` — the real distribution host for both the Flutter and the Dart SDK | not in this sandbox's egress allowlist |
| `github.com/dart-lang/sdk` releases | **none published at all** — `releases/latest` → 404 and the releases list is empty, so no SDK archive is obtainable from GitHub |
| PyPI | no package ships a Dart/Flutter SDK: `dart-sdk`, `dartsdk`, `dart_sdk`, `flutter-sdk`, `py-dart` → 404; `pypi/flutter` is an unrelated 10 KB Python dataclasses helper |
| npm | same: `dart-sdk`, `dartsdk`, `flutter-sdk`, `@dart-lang/sdk` → 404 |
| Java (for the emulator suite) | `scripts/phase0/toolchain.mjs` already documents the workaround it needs (`jdk4py` from PyPI); the emulator JARs come from the blocked host, so only the **offline** rules engine runs |

So `test:flutter*`, `flutter build apk` and the Java emulator suite are blocked by **egress, not by
anything this migration did** — which is why §4.2 treats an unchanged BLOCKED reason as the pass
condition, and why §2.6's Flutter procedure must be executed somewhere else before it is merged.

### 4.5 One edit deliberately **not** carried by this branch

`.github/workflows/deploy.yml` contains two comment references that the audit lists in §1.2
(sites #13). They are **not** in this branch: the GitHub App token that pushes this branch is not
allowed to modify files under `.github/workflows/`, and the push is rejected for that reason alone.
The functional CI steps are untouched either way (`npm ci` → `npm run build` → Pages publish), so
nothing about the deployment changes.

A human, or a token with `workflows` scope, should apply the cosmetic follow-up:

```diff
       # The Firebase project and the Supabase project both come from committed
-      # defaults (`src/lib/firebaseDefaults.ts`, `src/lib/supabaseDefaults.ts`),
+      # defaults (`web/lib/firebaseDefaults.ts`, `web/lib/supabaseDefaults.ts`),
```

The two remaining `src/` strings in §1.2's non-functional list stay as they are for the reason in
§2.4 — they live in files whose bytes the characterization fixture pins.

### 4.6 Existing CI on the pull request

Two checks report on the PR. Both are attributed below; **neither is caused by the rename**, and
neither is left unexplained.

| Check | Status | Attribution |
|---|---|---|
| GitGuardian Security Checks | failure | **False positive**, see below |
| Vercel | failure | **Pre-existing** — the same check failed on the last merged PR (#58); local `npm run build` (what Vercel runs) passes and the bundle is bit-identical |
| Vercel Preview Comments | pass | — |
| GitHub Pages (`deploy.yml`) | not run | the workflow is `on: push: branches: [main]`; its steps are untouched by this PR |

**GitGuardian**, in detail. The check reports *"2 secrets were uncovered from the scan of 4 commits
in your pull request"*, in `test/phase0/fixtures/production-baseline.json`, lines 128 and 187
(`web/context/AuthContext.tsx` and `web/pages/AuthPage.tsx`). Both flagged strings are **SHA-256
digests** and both values are **byte-identical to the ones already in the base commit** under the
old `src/…` keys:

* hashes added that were not already in `5f0dc84`: **0**
* fixture hashes changed by this migration: **0**

The check passed on #58 only because those lines were not part of the diff. Re-keying the fixture
moves 110 lines, so git presents them as additions and the entropy detector fires on the digests.
Nothing was introduced, rotated or exposed. Remediation is a human decision, not one this migration
should take silently: dismiss the two findings as a false positive in the GitGuardian dashboard
(recommended), or add a scoped exclusion for the fixture — which is a *widening* of the security
scan and belongs to the repository owner.
