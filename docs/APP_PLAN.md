# Hacienda de LuisAna — App Plan (v2: two roles, two apps)

**Status:** Implemented. Dalawang application, dalawang role — wala nang iba.  
**Guest / Client:** Website (`src/`, React + Vite) — booking, KYC, payment proof, tracking ng sariling booking.  
**Admin:** Flutter mobile app (`lib/`, Android) — buong management ng hacienda.  
**Decision record:** [ADR-0007](adr/0007-two-roles-two-apps-admin-on-mobile-guest-on-the-web.md).

> Ang lumang bersyon ng file na ito (Aug 2026) ay plano para sa isang **Capacitor guest app** na
> naka-wrap sa `/app/*` routes ng website, habang nasa web `/admin` ang owner. **Hindi na iyon ang
> architecture.** Tinanggal na ang Capacitor, ang `/app/*` at `/admin/*` routes, at ang Staff / Host
> roles. Nasa §9 ang decision log kung bakit.

---

## 1. Ang final na hugis (bakit ito)

| | Guest / Client | Admin |
|---|---|---|
| **App** | Website — `src/` (React 18, Vite, TypeScript, Tailwind) | Flutter mobile app — `lib/` (Android) |
| **Sino** | Sinumang bisita; optional na account para sa "My bookings" | Ang may-ari / operator ng hacienda — **isang role lang** |
| **Pwedeng gawin** | Tingnan ang rooms, rates, availability · mag-book · mag-upload ng ID at resibo (KYC) · pumili ng payment plan at mag-upload ng proof · i-withdraw ang sariling booking · makipag-chat sa Admin · mag-iwan ng review pagkatapos ng stay | **Lahat** ng dating Admin + Staff + Host: approve / reject, verify payment, refund, check-in → completed, rates & cancellation policy, rooms, smart lock, chat inbox, CRM, analytics |
| **Hindi pwede** | Walang management screen; hindi mababasa ang booking ng iba | Walang guest booking flow sa app (booking = website lang) |
| **Auth** | Firebase Auth (email / Google) + anonymous guest identity sa booking | Firebase Auth; papasok lang kung nasa admin allowlist **o** `profiles/{uid}.role == 'admin'` |

**Bakit hindi Staff / Host roles:** iisang tao (o iisang team na may iisang access) ang nagpapatakbo ng hacienda. Ang RBAC sa pagitan ng Admin / Staff / Host ay dagdag na code, dagdag na rules, dagdag na bug surface — nang walang tunay na pangangailangan. Kung kailanganin ng pangalawang operator, bigyan lang ng Admin role ang account niya (allowlist o Profile), hindi bagong role.

**Bakit Flutter para sa Admin, hindi web `/admin`:** ang Admin ay kailangang nasa bulsa — notifications ng papasok na guest, smart lock, chat, approve habang nasa labas. Ang website ay para sa guest na nagsi-search at nagbu-book mula sa browser (SEO, desktop, Messenger link).

```
┌──────────────────────────────┐      ┌──────────────────────────────┐
│  GUEST WEBSITE  (src/)       │      │  ADMIN APP  (lib/, Flutter)  │
│  /  /book  /track            │      │  Dashboard · Bookings        │
│  /messages                   │      │  Chat · Stays · More →       │
│  /login  /guest/auth         │      │  Rates · Smart Lock ·        │
│  /account  (My bookings)     │      │  Analytics · Rooms · CRM     │
└───────────────┬──────────────┘      └───────────────┬──────────────┘
                │   role: guest                        │   role: admin
                ▼                                      ▼
        Firebase Auth · Firestore (bookings, profiles, site_config/rates,
        access_logs) · Storage (kyc/)
        firestore.rules / storage.rules = dalawang role lang
```

---

## 2. Guest website — ano ang meron

Routes (`src/App.tsx`):

| Route | Screen | Notes |
|---|---|---|
| `/` | Marketing landing | Hero, Stay, Amenities, Gallery, Nearby, Location, FAQ, Contact |
| `/book` | Booking form → Firestore `bookings` | 24h date hold (`hold_expires_at`), anonymous guest uid, `ref_id` |
| `/track` | Track a booking by reference | Read-only status para sa guest |
| `/login`, `/guest/auth` | Guest sign-in / sign-up | Email / Google; Admin account → sinasabihang gamitin ang app |
| `/account` | My bookings | Status, hold countdown, KYC upload, payment plan + proof, cancel, activity log |
| `/admin/*`, `/app/*` | `AdminMoved` | Signpost lang: "Admin uses the mobile app" |

Guest actions (`src/lib/booking/actions.ts`): `UploadKyc`, `ChoosePaymentPlan`, `UploadPaymentProof`, `Cancel`. Lahat ng approval / verification ay **wala** sa website.

---

## 3. Admin app — ano ang meron

`lib/main.dart` → `AuthGate` → `AdminLoginScreen` → `MainShellScreen` (5 tabs + More sheet).

| Screen | Ginagawa |
|---|---|
| **Dashboard** | Metrics, approaching guests, pending review count, quick actions |
| **Bookings** → **Booking detail** | Lahat ng bookings; Approve / Reject / Reject ID / Verify payment / Reject proof / Cancel / Mark refunded / Check-in / Begin stay / Check-out / Complete / Purge KYC / Revoke key; activity log |
| **Chat** | Guest conversations (`conversations`, `messages`) |
| **Stays** | Kasalukuyang naka-stay, check-out progress |
| **Rates** | Publish `site_config/rates`: nightly rate, security deposit, down-payment %, refund tiers — dito kinukuha ng website ang quote |
| **Smart Lock** | Access log + simulation (ESP32 not yet wired) |
| **Rooms** | Availability at status ng units |
| **Guest CRM** | Profiles at history ng guests |
| **Analytics** | Occupancy, revenue, funnel |

Lifecycle logic: `lib/services/booking_lifecycle.dart` (`applyAdminAction`, `findDateConflicts`, `settleRefund`, `validatePublishedRates`) — parehong status table ng web `src/lib/booking`.

---

## 4. Data at security (as built)

```
bookings/{id}
  guest_name, phone, email, check_in, check_out, guests, accommodation
  status: Pending | KYC Submitted | Approved | Payment Pending | Payment Verified |
          Reserved | Checked-In | Staying | Checked-Out | Completed |
          Rejected | Cancelled | Expired
  uid, ref_id, source, created_at, hold_expires_at
  kyc_status, kyc_id_url, kyc_receipt_url, kyc_reject_reason
  payment_plan, payment_status, payment_proof_url, amount_claimed, amount_verified,
  stay_total, amount_due, security_deposit, balance_due
  refund_status, refund_total, refund_breakdown
  rejection_reason, cancellation_reason, policy_version, policy_effective_date
bookings/{id}/activity/{n}   # append-only: action, from_status, to_status, actor, at, reason

profiles/{uid}   role: 'guest' | 'admin'   (walang ibang value)
site_config/rates
access_logs/{n}
```

Rules (`firestore.rules`, `storage.rules`):

- **Guest:** `create` booking; `read` / limited `update` ng sariling booking (`uid == request.auth.uid`); upload sa `kyc/{bookingId}/…`
- **Admin** (`adminEmails()` allowlist o `profiles.role == 'admin'`): lahat ng iba — approve, verify, refund, rates, purge
- Walang `staff`, walang `host`, walang `owner` sa rules

Bootstrap admins: nasa `firestore.rules adminEmails()`, `storage.rules isAdminEmail()`, `src/lib/auth/profile.ts`, at Flutter `AuthStore.kAdminEmails` — **i-mirror kapag nagbago**.

---

## 5. Paano i-run

```bash
# Guest website
npm install && npm run dev        # http://localhost:5173
npm run lint && npx vitest run && npm run build

# Admin app (Flutter 3.27+)
flutter pub get
flutter run                        # naka-connect na Android device / emulator
flutter test
flutter build apk --release
```

Firebase setup: [FIREBASE_SETUP.md](FIREBASE_SETUP.md). Android specifics: [ANDROID.md](ANDROID.md).

---

## 6. Susunod na pwedeng gawin (hindi pa built)

| Feature | Saan | Notes |
|---|---|---|
| Push notifications sa guest (approved / verified / check-in bukas) | Cloud Functions (Blaze) + FCM sa website | Local notifications sa Admin app meron na (`notification_service.dart`) |
| Tunay na ESP32 / RFID / BLE mobile key | Admin app Smart Lock | Ngayon simulation + `access_logs` read lang |
| Transactional Approve sa app | `booking_lifecycle.dart` | Web protocol nasa ADR-0006; app gumagamit ng latest snapshot check |
| Damage report + cleaning records bilang documents | Admin app Stays | Ngayon deposit settlement lang ang nirerecord |
| iOS build ng Admin app | `flutter create --platforms=ios .` | Kailangan Apple Developer account |
| Play Store internal testing | `flutter build appbundle` | Privacy policy + screenshots |

---

## 7. Hindi kasama (by design)

- Staff role, Host role, Super Admin, RBAC sa pagitan ng operators — **hindi babalik**
- Admin screens sa website
- Guest booking flow sa Flutter app
- Capacitor / WebView wrapper ng website
- Instant payment / GCash integration (proof upload + manual verify pa rin)

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Admin account nag-login sa website | Website nag-re-redirect sa signpost; walang admin screen na maaabot |
| Guest account sumubok sa Admin app | `AuthStore.isAdmin` gate → sign out + "Guests book on the website" |
| Allowlist hindi na-mirror sa apat na lugar | Nakalista sa §4; `profiles.role` ang long-term source of truth |
| Dart hindi na-compile sa CI ng repo | Run `flutter analyze && flutter test` bago mag-release |

---

## 9. Decision log

- 2026-08-27 — Unang plano: Capacitor guest app sa `/app/*`, owner dashboard sa web `/admin`.
- 2026-09 — Flutter app na-prototype bilang guest app; web `/app` at `/admin` parehong buhay; Staff / Host / Owner roles lumitaw sa docs at rules.
- **2026-09-24 — Superseded (ADR-0007):** dalawang role lang (Guest, Admin), dalawang app lang (Website = Guest, Flutter = Admin). Tinanggal ang Capacitor, `/app/*`, `/admin/*` web dashboard, Staff / Host roles at lahat ng RBAC sa pagitan nila. Admin app ang sumipsip ng lahat ng management functionality.
