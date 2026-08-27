# Android app — Android Studio

The guest app (`/app`) is wrapped with **Capacitor**. Open the `android/` folder in Android Studio, then run it on an emulator or a USB-connected phone.

This sandbox cannot run Android Studio. Do these steps **on your computer**.

---

## 1. One-time setup

1. Install [Android Studio](https://developer.android.com/studio) (Ladybug / 2024.2+ recommended).
2. First launch → **More Actions → SDK Manager** and install:
   - Android SDK Platform **36** (or the version Studio prompts)
   - Android SDK Build-Tools
   - Android Emulator
3. Clone this repo and install JS deps:

```bash
git clone https://github.com/JOHN-REY-CARLO-A-GEMAO/hacienda-de-luisana.git
cd hacienda-de-luisana
git checkout arena/01a0430d-hacienda-de-luisana
npm install
```

Optional Firebase: copy `.env.example` → `.env.local` and fill keys. Without it, bookings still work in local/demo mode.

---

## 2. Build the web app into the Android project

```bash
npm run android:sync
```

This runs `vite build` and copies `dist/` into `android/`. **Re-run this whenever you change React/TS/CSS.**

Then open Android Studio:

```bash
npm run android:open
```

Or in Android Studio: **File → Open** and select the **`android`** folder (not the repo root).

---

## 3. Run / install

1. Wait for **Gradle Sync** (first time downloads a lot).
2. Pick a device:
   - **Emulator:** Device Manager → Create Device → Pixel 6 → system image (e.g. UpsideDownCake / API 34) → Finish → Play.
   - **Physical phone:** enable Developer options + USB debugging, plug in, allow the RSA prompt.
3. Click the green **Run** button (Shift+F10).
4. The app installs as **Hacienda de LuisAna** and opens the guest tabs (Home / Stay / Explore / Book / Account).

Package id: `com.haciendadeluisana.app`

---

## 4. After you change the website/app code

```bash
npm run android:sync
```

Then Run again in Android Studio (or **Build → Rebuild Project**).

If the emulator still shows an old UI: **Run → Edit Configurations** is fine; usually a fresh Run is enough. You can also uninstall the app from the emulator and Run again.

---

## 5. Live reload (optional, while coding)

So the phone/emulator loads your Vite dev server instead of the bundled `dist`:

1. Find your computer’s LAN IP (`ipconfig` on Windows, `ifconfig` / `ip a` on Mac/Linux), e.g. `192.168.1.23`.
2. Phone and computer must be on the **same Wi‑Fi**.
3. Start Vite, then sync with that URL:

```bash
npm run dev
CAP_SERVER_URL=http://192.168.1.23:5173 npx cap sync android
```

Then Run in Android Studio. Cleartext HTTP is allowed only when `CAP_SERVER_URL` is set.

To go back to the bundled app:

```bash
npm run android:sync
```

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| Studio opened the repo root | Close it. **File → Open → `android/`** |
| SDK location not found | Android Studio → Settings → Languages & Frameworks → Android SDK. This writes `android/local.properties` (gitignored). |
| Gradle / Java errors | Capacitor 8 wants **JDK 21**. Studio usually bundles it: Settings → Build → Gradle → Gradle JDK → `jbr-21`. |
| White screen | Chrome on desktop: `chrome://inspect` → inspect the WebView. Re-run `npm run android:sync`. |
| `tel:` / Maps / Messenger don’t open | Use a real device (emulator has no phone/Messenger). Maps should still open. |
| Booking stays in demo mode | Add `.env.local` with `VITE_FIREBASE_*`, then `npm run android:sync` again. |
| Google sign-in (owner admin) | Not used in the guest app. Popups are unreliable inside a WebView. |

---

## 7. What this is / isn’t

- **Is:** an installable Android app of the guest experience at `/app`.
- **Isn’t:** a Play Store release yet (no signing key / store listing). For that: **Build → Generate Signed Bundle / APK**.
- iOS (Xcode) is not set up yet.
