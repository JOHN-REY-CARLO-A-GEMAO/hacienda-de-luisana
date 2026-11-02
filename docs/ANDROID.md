# Admin mobile app — Android build

The Admin app is a **Flutter** project (`lib/` + `android/`). It is the Admin's only application: every management function of the system lives here (ADR-0007). Guests never install it — they use the website.

This sandbox cannot run Android Studio or the Flutter SDK. Do these steps **on your computer**.

---

## 1. One-time setup

1. Install [Flutter](https://docs.flutter.dev/get-started/install) (stable, Dart ≥ 3.2) and [Android Studio](https://developer.android.com/studio).
2. In Android Studio → **SDK Manager** install:
   - Android SDK Platform **36**
   - Android SDK Build-Tools, NDK `30.0.14904198` (or let Gradle fetch it)
   - Android Emulator
3. `flutter doctor` until Android is green.
4. Clone and fetch packages:

```bash
git clone https://github.com/JOHN-REY-CARLO-A-GEMAO/hacienda-de-luisana.git
cd hacienda-de-luisana
flutter pub get
```

### Firebase (required to sign in)

The app signs in with Firebase Auth only, so a Firebase Android app is needed to get past the gate:

1. Firebase console → project settings → **Add app → Android**, package name `com.haciendadeluisana.client2` (the `applicationId` in `android/app/build.gradle`).
2. Add the debug **SHA-1** (`cd android && ./gradlew signingReport`) so Google sign-in works. Email + password works without it.
3. Download `google-services.json` to `android/app/` (gitignored), or run `flutterfire configure` to regenerate `lib/firebase_options.dart`.
4. Enable **Email/Password** and **Google** sign-in providers.
5. Make sure the Admin's address is in `firestore.rules` → `adminEmails()` (mirrored in `storage.rules`, `src/lib/auth/profile.ts`, `lib/services/auth_store.dart`), *or* create `profiles/{uid}` with `role: 'admin'` for that account.

Without Firebase the app still starts and shows in-memory demo data behind the gate, but no account can pass the gate.

---

## 2. Run

```bash
flutter devices
flutter run                    # picks the connected device / running emulator
flutter run -d emulator-5554   # or a specific one
```

Or open the **`android/`** folder in Android Studio (not the repo root) and press Run. The app installs as **Hacienda Admin**.

Hot reload: press `r` in the `flutter run` terminal after editing Dart.

---

## 3. Tests

```bash
flutter test                                # all Dart tests
flutter test test/booking_lifecycle_test.dart
```

`test/booking_lifecycle_test.dart` covers the Admin's side of the Booking lifecycle (approve / reject / verify / cancel + refund / stay progression / hold expiry), `test/published_rates_test.dart` the rates document validation, and `test/booking_model_test.dart` the Firestore document mapping.

---

## 4. Release build

```bash
flutter build apk --release          # android/app/build/outputs/apk/release/
flutter build appbundle --release    # for Play Console
```

`android/app/build.gradle` currently signs release with the debug key; generate a keystore and a `key.properties` before a real release.

---

## 5. Troubleshooting

### 5.1 `AndroidLocationsBuildService` / `AndroidDirectoryCreator`

This is the failure that stops `flutter run` at `android/app/build.gradle` line 2
in about four seconds, before a single Dart file is compiled:

```
An exception occurred applying plugin request [id: 'com.android.application']
> Failed to apply plugin 'com.android.internal.application'.
   > Failed to create service '...AndroidLocationsBuildService_...'.
      > Could not create provider for value source
        AndroidLocationsBuildService.AndroidDirectoryCreator.
```

**It is not a bug in this repo.** While applying the Android Gradle Plugin (AGP),
Android's tools resolve the *preferences* folder — `%USERPROFILE%\.android` on
Windows — and try to create it. When that resolution throws an
`AndroidLocationsException`, Gradle hides it behind the message above. `--stacktrace`
shows the real one. The known causes:

| Cause | Why it breaks |
|---|---|
| `ANDROID_USER_HOME`, `ANDROID_PREFS_ROOT` and/or `ANDROID_SDK_HOME` disagree | AGP reads env vars **and** JVM system properties and refuses multiple different paths. `ANDROID_USER_HOME` is the `.android` folder itself; the two deprecated variables are its **parent** — so setting them all to the same literal value *still* conflicts. |
| `ANDROID_SDK_HOME` points at the SDK root | A common old-tutorial setting. AGP expects the parent of `.android` and rejects an SDK root (`platforms/` + `platform-tools/`) without a `.android` child. |
| `.android` is a file, its parent drive is gone, or it is not writable | `AndroidDirectoryCreator` calls `Files.createDirectories(...)`; a redirected/OneDrive profile or a read-only `C:\Program Files` path fails here. |
| A stale `-Duser.home=` in `GRADLE_OPTS`, `JAVA_TOOL_OPTIONS`, `JAVA_OPTS`, `_JAVA_OPTIONS`, or `systemProp.*` in `gradle.properties` | The Gradle daemon resolves `user.home` from the JVM, not from your shell. Containers and deleted profiles produce `?/.android`. |
| Non-ASCII project or profile path | AGP rejects non-ASCII paths. `android.overridePathCheck=true` does **not** fix it — it just turns the failure into this opaque one. |
| A Gradle daemon started before you changed the variables | Daemons keep their old environment. This is a *secondary* cause, not the root one. |

**Diagnose first** — the preflight checks every one of those, plus the SDK,
`local.properties`, Java, `google-services.json`, and prints the exact repair
commands for your machine:

```powershell
npm run check:android                              # or: node scripts/check-android-env.mjs
node scripts/check-android-env.mjs --self-test   # sanity-check the checker itself
```

**Typical repair** (PowerShell, from the repo root). Replace the SDK path if yours
is not the default, and make the changes permanent in *System Properties →
Environment Variables* afterwards — a new terminal is required because the
Gradle daemon inherits its environment at startup:

```powershell
Remove-Item Env:ANDROID_PREFS_ROOT, Env:ANDROID_SDK_HOME -ErrorAction SilentlyContinue
# Only if the preflight reports a stale -Duser.home (do not drop proxy options otherwise):
# Remove-Item Env:GRADLE_OPTS, Env:JAVA_TOOL_OPTIONS, Env:JAVA_OPTS, Env:_JAVA_OPTIONS -ErrorAction SilentlyContinue
$env:ANDROID_USER_HOME = "$env:USERPROFILE\.android"
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME | Out-Null
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_HOME     = $env:ANDROID_SDK_ROOT
flutter config --android-sdk $env:ANDROID_SDK_ROOT
flutter pub get
.\android\gradlew.bat --stop
flutter clean
flutter run
```

`android/local.properties` is gitignored and machine-local: if `sdk.dir` there is
stale or uses single backslashes (`C:\Users\...` is mangled by Java's
`Properties` reader into `C:Users...`), delete the file and let `flutter pub get`
rewrite it. The preflight catches that too.

`android/settings.gradle` now fails early with a readable message when the
preferences variables conflict or `.android` cannot be created, so a fresh
clone says what to fix instead of showing the opaque AGP error.

Two things to expect **after** the environment is fixed:

- `google-services.json` is gitignored, so `:app:processDebugGoogleServices`
  fails until you add it (§ 1, and `docs/FIREBASE_SETUP.md`).
- This checkout lives under a path with spaces. Gradle normally copes, but if a
  later NDK/aapt2/cmake step fails, move it to an ASCII path without spaces such
  as `D:\hacienda\hacienda-de-luisana`.

If the preflight is all green and the build still fails, capture
`flutter run -v` and `.\android\gradlew.bat --stacktrace` — that points at an
AGP/Gradle/Flutter toolchain version mismatch, not a machine path.

### 5.2 Other problems

| Problem | Fix |
|---|---|
| `flutter.sdk not set in local.properties` | Run `flutter pub get` once from the repo root, or open `android/` in Android Studio (it writes `android/local.properties`). |
| `AndroidLocationsBuildService` / `AndroidDirectoryCreator` | § 5.1 — Android preferences folder / environment variables, not project code. |
| `SDK location not found` | `flutter config --android-sdk "<path>"`, then `flutter pub get`. Install SDK Platform 36 in SDK Manager. |
| `File google-services.json is missing` | Download it from the Firebase console into `android/app/` (§ 1). It is gitignored. |
| Gradle / Java errors | Use the JDK Android Studio bundles (Settings → Build → Gradle → Gradle JDK → `jbr-17` or newer). |
| Google sign-in dies after the account picker | Missing SHA-1 in the Firebase console, or the web OAuth client id in `AuthStore.kServerClientId` does not match the project. Use email + password meanwhile. |
| "Not authorized" after signing in | The account is not the Admin: add it to `adminEmails()` in `firestore.rules` and redeploy, or set `profiles/{uid}.role = 'admin'`. |
| Every list shows the same demo data | Firebase is not initialised (no `google-services.json` / `firebase_options.dart`), or the rules deny the read — check the Firestore rules deploy and that the signed-in account is the Admin. |
| `tel:` / SMS don't open | Use a real device (the emulator has no dialer). |

---

## 6. What this is / isn't

- **Is:** the Admin's operations app — bookings, payments, refunds, rates, stays, chat, smart-lock logs, rooms, CRM, analytics.
- **Isn't:** a Guest app. There is no Guest sign-in, booking form or Mobile Key screen here; those belong to the website (`src/`).
- iOS is not set up.
