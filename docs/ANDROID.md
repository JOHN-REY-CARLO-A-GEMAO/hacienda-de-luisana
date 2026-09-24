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

| Problem | Fix |
|---|---|
| `flutter.sdk not set in local.properties` | Run `flutter pub get` once from the repo root, or open `android/` in Android Studio (it writes `android/local.properties`). |
| Gradle / Java errors | Use the JDK Android Studio bundles (Settings → Build → Gradle → Gradle JDK → `jbr-17` or newer). |
| Google sign-in dies after the account picker | Missing SHA-1 in the Firebase console, or the web OAuth client id in `AuthStore.kServerClientId` does not match the project. Use email + password meanwhile. |
| "Not authorized" after signing in | The account is not the Admin: add it to `adminEmails()` in `firestore.rules` and redeploy, or set `profiles/{uid}.role = 'admin'`. |
| Every list shows the same demo data | Firebase is not initialised (no `google-services.json` / `firebase_options.dart`), or the rules deny the read — check the Firestore rules deploy and that the signed-in account is the Admin. |
| `tel:` / SMS don't open | Use a real device (the emulator has no dialer). |

---

## 6. What this is / isn't

- **Is:** the Admin's operations app — bookings, KYC, payments, refunds, rates, stays, chat, smart-lock logs, rooms, CRM, analytics.
- **Isn't:** a Guest app. There is no Guest sign-in, booking form or Mobile Key screen here; those belong to the website (`src/`).
- iOS is not set up.
