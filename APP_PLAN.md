# Hacienda de LuisAna — Guest App Plan

**Status:** Guest web app (`/app`) + Capacitor Android project are in the repo. Open `android/` in Android Studio to install. See `ANDROID.md`.  
**Audience:** Guests / customers muna  
**Owner dashboard:** mananatili sa web (`/admin`) — hindi featured sa app

---

## 1. Recommendation (bakit ito)

**Huwag mag-React Native rewrite.**  
Gamitin ang existing **React + Vite + TypeScript + Tailwind + Firebase**, tapos:

| Layer | Choice | Bakit |
|---|---|---|
| Codebase | Same repo, bagong guest-app shell | Reuse `site.ts`, booking form, Firestore, images |
| Mobile UX | Bottom-tab guest app | Hindi lang “website sa WebView” |
| Install | **Capacitor** (Android APK muna) | Totoong app icon, splash, Play Store-ready |
| Bonus | PWA (Add to Home Screen) | Libre, same build, walang store review |
| Backend | Existing Firebase | Bookings, later Auth + FCM |

**Hindi PWA-only** kasi gusto mo ng bagong features (push, offline, native call/maps).  
Mas reliable ang Capacitor + FCM kaysa browser push, lalo na sa iOS later.

**Hindi Expo/RN** kasi 2–3× ang work para sa same booking flow, at duplicate UI.

**Android muna.** iOS (TestFlight / App Store) phase 3 — kailangan Apple Developer account (~$99/yr).

```
┌─────────────────────────────────────────────────────────┐
│  GUEST APP (phone)          WEBSITE (desktop / SEO)     │
│  Capacitor / PWA            existing landing page       │
│  start URL: /app            /  /book  /admin            │
└──────────────────┬──────────────────┬───────────────────┘
                   │                  │
                   ▼                  ▼
            Firebase Auth · Firestore · Storage · (later FCM + Functions)
```

---

## 2. Ano ang meron na (reuse, huwag i-rewrite)

Website ngayon:

- Marketing landing (Hero, Stay, Amenities, Experience, Nearby, Gallery, Location, FAQ, Contact)
- Booking **inquiry** form → Firestore (`cloudBookingsDB`)
- Owner admin `/admin` (auth, real-time list, calendar, status)
- Content source of truth: `src/config/site.ts`
- Contact shortcuts: phone, Messenger, Google Maps

**App = bagong shell + extra guest features, same data.**

---

## 3. Guest app — information architecture

Bottom tabs (5). Owner/admin **hindi** lalabas.

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│   Home   │   Stay   │  Explore │   Book   │  Account │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

| Tab | Screens | Notes |
|---|---|---|
| **Home** | Welcome, stats, featured photos, CTAs | “Book” + Call + Directions |
| **Stay** | Main House, Camping units, amenities, rates | → Book with preselected accommodation |
| **Explore** | Gallery, Nearby (Hulugan, Aliw, etc.), Map | Offline-friendly gallery later |
| **Book** | Inquiry form + estimate + success | Same Firestore write as website |
| **Account** | My bookings, contact host, FAQs, policies | Guest login optional in v1.1 |

**Native shortcuts (always reachable):**

- Call `(0925) 850 7707`
- Facebook Messenger
- Open in Google Maps / Directions
- Share the Hacienda

**Hindi kasama sa guest app:** `/admin`, login ng owner, seed demo, Firebase status panel.

---

## 4. Phased delivery

### Phase 0 — Foundation (walang store pa)

- App routes under `/app/*`
- Mobile app chrome: bottom tabs, safe-area, status bar color (forest)
- Capacitor config + Android project
- App icon + splash (HDL mark, cream/forest)
- Hide website header/footer/sticky CTA **inside the app shell**
- Website sa browser **hindi nagbabago** (SEO + desktop)

**Exit:** `npx cap run android` → app opens Hacienda guest UI.

### Phase 1 — MVP guest app (shippable APK)

Dapat magawa ng guest **nang hindi binubuksan ang Chrome:**

1. Tumingin ng rooms + photos + amenities  
2. Mag-booking inquiry (dates, guests, contact)  
3. Tumawag / Messenger / Maps sa 1 tap  
4. Basahin FAQ + location  
5. Makita ang success + reference number  

**New vs website**

- Bottom navigation (app feel)
- Full-screen gallery lightbox, swipe
- Sticky “Call host” / “Message” on Stay & Book
- Deep link: `hdl://book?accommodation=main-house`
- Android back button = in-app back (hindi exit)

**Exit:** signed debug/release APK na pwede i-install sa phone ng guests (sideload or internal testing).

### Phase 2 — “Plus features” (ito ang pinili mong scope)

| Feature | Paano | Dependency |
|---|---|---|
| **Guest accounts** | Firebase Email + Google (meron na sa project). `users/{uid}` with `role: 'guest'`. Booking saves `uid`. | Auth rules update |
| **My Bookings** | Guest reads **own** inquiries only (status: Pending / Confirmed / …) | Firestore rules by `uid` |
| **Push notifications** | FCM: “Request received”, “Confirmed”, “Check-in tomorrow” | Cloud Functions (Blaze) + `booking_status` trigger |
| **Offline gallery** | Cache `/images/gmaps` + nearby via service worker **or** Capacitor Preferences + filesystem | Phase 0 PWA/SW or `@capacitor/filesystem` |
| **Call / Maps / Share** | `@capacitor/browser` + native `tel:` / geo / Share API | Capacitor plugins |
| **Check-in reminder** | Local notification 1 day before confirmed stay | `@capacitor/local-notifications` (works even without Functions) |

**Guest vs owner Auth (importante)**

Ngayon, kahit sino naka-login ay pasok sa `/admin` (kung configured). Kailangan:

```
users/{uid}: { role: 'admin' | 'guest', email, displayName }
```

- `/admin` → `role === 'admin'` only (email whitelist as backup)
- Guest app Account tab → `role === 'guest'`
- Bookings: guest `create` + `read` own; admin `read/update/delete` all

### Phase 3 — Store + iOS (optional)

- Play Store listing (privacy policy, screenshots, content rating)
- iOS via Capacitor (`npx cap add ios`) kapag may Apple account
- App Store review notes: booking is **inquiry**, not instant pay

---

## 5. Feature split — website vs app

| Feature | Website | Guest app |
|---|---|---|
| Marketing landing, SEO | ✅ | Home tab (condensed) |
| Accommodations | ✅ | Stay tab |
| Gallery / Nearby / Map | ✅ | Explore tab |
| Booking inquiry | `/book` | Book tab |
| Owner dashboard | `/admin` | ❌ hidden |
| Guest “My bookings” | later, optional | ✅ Phase 2 |
| Push / local notifs | ❌ | ✅ Phase 2 |
| Offline photos | ❌ | ✅ Phase 2 |
| Native call / maps / share | links | ✅ native |

Isang Firebase project. Dalawang front door.

---

## 6. Tech checklist

**Keep**

- React 18, Vite, TypeScript, Tailwind, React Router
- `src/config/site.ts` as content source of truth
- `src/lib/firestoreBookings.ts` (extend with `uid`, `userId`)
- Firebase Auth / Firestore / Storage

**Add (Phase 0–1)**

```
@capacitor/core
@capacitor/cli
@capacitor/android
@capacitor/status-bar
@capacitor/splash-screen
@capacitor/app          # back button, app URL
@capacitor/browser
```

**Add (Phase 2)**

```
@capacitor/push-notifications     # FCM
@capacitor/local-notifications
@capacitor/share
firebase-functions                # status → push (Blaze plan)
vite-plugin-pwa                   # optional, web install + image cache
```

**Do not add unless kailangan**

- React Native / Expo
- Separate Node API (Firebase is enough)
- Payments (inquiry muna — “no payment at this step” sa existing form)

---

## 7. Data / security changes (Phase 2)

Current: anyone can **create** a booking; only signed-in users can read/update.

Proposed:

```
bookings/{id}
  guest_name, phone, email
  check_in, check_out, guests, accommodation, special_requests
  status: Pending | Confirmed | Cancelled | Completed
  uid?: string          # set if logged-in guest
  created_at, updated_at
  fcmToken?: string     # optional, or store on users/{uid}

users/{uid}
  role: 'guest' | 'admin'
  email, displayName
  fcmTokens: string[]
```

Rules sketch:

- `create` booking: public **or** signed-in guest
- `read` booking: admin **or** (`uid == request.auth.uid`)
- `update/delete`: admin only (guest cannot self-confirm)

---

## 8. UX notes (para hindi “website in a box”)

- Cream / forest / serif look **manatili** (brand)
- Bottom tab bar: cream-50, forest icons, 1 accent (olive) on Book
- Safe areas (notch, Android nav bar)
- Book tab = primary (filled icon / badge)
- Success screen: reference # + “Message host” + “View my request”
- Empty Account: “Book without an account” + “Save this stay — sign in”
- No horizontal tables (admin table is web-only)
- Images: existing `/public/images/gmaps` + `/nearby` — compress later if APK size > ~30MB

---

## 9. Out of scope (v1)

- Instant booking / payments / GCash
- Multi-property / channel manager (Airbnb sync)
- Chat inside the app (Messenger muna)
- Owner app (pwedeng Phase 4: separate `/app/owner` or PWA)
- Changing prices in-app (owner still edits `site.ts` or future CMS)

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Guest login nakakalusot sa `/admin` | Role check + email whitelist sa rules |
| Push kailangan Blaze (Cloud Functions) | Phase 1 without push; Phase 2 local notifs first |
| Malaking images = malaking APK | Remote images (Hosting/Storage) + cache; huwag i-bundle lahat |
| iOS later | Capacitor supports it; huwag mag-RN “just in case” |
| Inquiry ≠ confirmed reservation | Copy manatili: host confirms; no payment in-app |

---

## 11. Suggested build order (kapag mag-code na)

1. `/app` route + tab layout (web preview muna — walang Android pa)  
2. Port Home / Stay / Explore / Book into tab screens (reuse sections)  
3. Capacitor Android + icon/splash + `tel:` / maps / share  
4. Guest Auth + My Bookings + rules  
5. Local check-in notification  
6. FCM + Cloud Function on status change  
7. Offline gallery cache  
8. Play Store (optional)

**Unang concrete milestone:** buksan sa phone preview ang `/app` with 5 tabs, working booking, call/maps — still a website, but *app-shaped*. Then wrap with Capacitor.

---

## 12. Decision log

- 2026-08-27 — App type: **recommend Capacitor + mobile guest shell** (user chose “irekomenda mo”)
- 2026-08-27 — Audience: **guests**
- 2026-08-27 — Scope: **app + new features** (push, offline gallery, native shortcuts, maybe guest login)
- Owner dashboard: **web only** for now
