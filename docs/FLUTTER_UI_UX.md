# Flutter UI/UX Refresh — Hacienda de LuisAna (Admin app)

Design-system consolidation, reusable widget library, motion language,
accessibility and rendering-performance pass over the Flutter app (`lib/`),
executed with the `flutter-ui-ux` skill workflow.

## Phase 1 — Requirements analysis

### App structure

- **Entry**: `main.dart` → `AuthGate` → `AdminLoginScreen` (Google / Admin email + password) → `MainShellScreen`. Only the Admin passes the gate (ADR-0007).
- **MainShellScreen**: 9 tabs kept alive in an `IndexedStack` — Dashboard, Bookings, Chat, Stays, Analytics, Smart Lock, Rooms, Guest CRM, Rates, Payment references. The `BottomNavigationBar` exposes 5 items; item 5 ("More") opens a modal bottom sheet to the secondary tabs and Sign out. Bookings push `BookingDetailScreen`.
- **State**: Riverpod stream providers (bookings, smart-lock logs, rooms, guest profiles, published rates, per-Booking activity) + legacy `provider` for the `AuthStore` session.
- **Data**: Firestore (in-memory demo data when Firebase is absent) + simulated ESP32 smart lock (`SimulationBar` one-tap checkpoints).
- **Platform**: Android-first Admin APK, Material 3, deep-green app bars, portrait.

### Design-system review findings

| # | Finding | Impact |
|---|---------|--------|
| 1 | **Two `AppTheme` classes existed.** `core/theme/app_theme.dart` (Cinzel + `AppColors` palette) is wired to `MaterialApp`; a second Cormorant "quiet luxury" theme was only used by the login screen. Login visually disagreed with the rest of the app. | Brand inconsistency; dead token drift. |
| 2 | All 8 views hardcode `GoogleFonts.cinzel/inter` + `AppColors` inline. Component themes (`cardTheme`, `chipTheme`, `dialogTheme`, …) are defined but barely used. | Duplicated magic values (radii 14/16/18/20/22, shadow recipes). |
| 3 | **Zero animation**: no screen entry, no tab transition, no micro-interactions, abrupt alert pop-ins. | Feels flat for a "quiet luxury" product. |
| 4 | **No accessibility semantics**: icon-only buttons (refresh, notifications) have no label; the login visibility toggle has none. | Screen-reader users can't operate the app. |
| 5 | **Rendering**: list items lack `ValueKey`s; the dashboard feed builds a non-builder `ListView` over `.take(5)`. | Jank risk on mid-range Android hardware. |
| 6 | **Responsive**: metric grid fixed at 2 columns; no `LayoutBuilder` anywhere except the login screen. | Wasted space on tablets / landscape. |

Performance constraints: the charts live inside the always-hot
`IndexedStack`; simulation checkpoints push stream updates that rebuild whole
tabs, so all new motion must be paint-only (transforms/opacity) and respect
`MediaQuery.disableAnimations`.

## Phase 2 — Widget architecture

### Unified design system

```
lib/core/theme/app_theme.dart   ← single AppTheme (tokens + ThemeData)
lib/theme/app_theme.dart        ← re-export shim (keeps old imports compiling)
lib/core/constants/app_constants.dart  ← AppColors palette (unchanged)
```

`AppTheme` now owns both token families (the `AppColors`-based ops palette and
the forest/cream/gold quiet-luxury tokens used by login) plus component
themes for `Chip`, `Dialog`, `SnackBar`, `BottomSheet`, `Divider`,
`ProgressIndicator`, `FloatingActionButton` and `ListTile`.

### Component library (`lib/widgets/`)

| Widget | Purpose | Animation / a11y notes |
|--------|---------|------------------------|
| `HaciendaCard` | Brand card: white surface, hairline border, soft shadow, radius 20. Optional accent border (pending bookings, VIP). | Stateless; const-friendly. |
| `StatusPill` | Tinted status chip (12% fill, 40% border, bold 11pt). | `Semantics(label: …)` reads the status. |
| `SectionHeader` | Uppercase letter-spaced section label + optional text action. | Action is a labelled button for TalkBack. |
| `EmptyState` | Icon + title + subtitle + optional action, used by all 5 list screens. | Replaces 4 hand-rolled empty layouts. |
| `PulseDot` | Core dot + expanding ring, repeating 900 ms. | `RepaintBoundary`; static dot when animations disabled. |
| `StaggeredEntrance` | Fade + 14 px slide-up on first build, 60 ms per index. | `RepaintBoundary`-safe (paint-only); skipped when animations disabled. |
| `PressableCard` | 0.985× press-scale micro-interaction on any tappable card. | `AnimatedScale` 150 ms ease-out. |
| `LuxeProgress` | Brand `LinearProgressIndicator` (8 pt, rounded). | Value changes animate implicitly. |
| `AnimatedTabPage` | Wraps each `IndexedStack` tab; fades/slides in the 280 ms the tab becomes active. Paint-only: the child element is passed as `AnimatedBuilder` child so descendants don't rebuild per frame. |
| `AnimatedBadge` | Bottom-nav count badge that pops in/out (`easeOutBack`). | `AnimatedScale` + `AnimatedOpacity`. |

### Motion language (Phase 4 spec)

| Interaction | Curve / duration |
|-------------|------------------|
| Tab entry | `easeOut`, 280 ms, opacity 0→1 + translateY 12→0 |
| Content stagger (dashboard, lists) | `easeOut`, 450 ms, 60 ms/index, opacity 0→1 + translateY 14→0 |
| Alert pulse | linear repeat, 900 ms, scale 1→1.9, ring opacity 0.35→0 |
| Press feedback | `easeOut`, 150 ms, scale 1→0.985 |
| Badge pop | `easeOutBack`, 250 ms, scale 0→1 |
| Reduced motion | All of the above collapse to instant/static via `MediaQuery.disableAnimations` |

### Phase 3–5 wiring map

- **main_shell_screen**: `AnimatedTabPage` per tab, `AnimatedBadge` on Bookings,
  branded "More" sheet (`SectionHeader`, `PressableCard` rows).
- **dashboard_screen**: staggered banner → metrics → quick actions → feed;
  `LayoutBuilder` metric grid (2 cols < 700 dp, 4 cols ≥ 700 dp); `PulseDot`
  in the approaching-guest banner; keyed `ListView.builder` feed; semantics on the notifications button.
- **bookings_screen**: `HaciendaCard` + `StatusPill` + `EmptyState` + staggered cards.
- **stay_duration_screen**: same trio + `LuxeProgress`.
- **smart_lock_screen**: staggered counter tiles, keyed log list (new logs animate in), `EmptyState`.
- **rooms_screen** / **guest_crm_screen**: `HaciendaCard`, `StatusPill` (rooms), `EmptyState`, staggered cards.
- **analytics_screen**: staggered sections.
- **admin_login_screen**: staggered entrance, labelled visibility toggle.
- **booking_detail_screen** / **rates_screen** (added with ADR-0007): `HaciendaCard` sections, `StatusPill` for status / KYC / payment, `SectionHeader` for the Activity log and rate groups; dialogs use the shared `DialogTheme`.

### Verification

- `flutter`/`dart` are not available in this sandbox (Google's SDK hosts are
  unreachable), so `flutter analyze` / `flutter test` were **not** run here.
  Instead, all touched files were verified by: whole-file bracket-balance
  check with string/comment stripping, relative-import resolution across all
  53 dart files, and a manual API audit against Flutter 3.27+
  (`CardThemeData`/`TabBarThemeData`/`DialogThemeData` usage is consistent
  with what the repo already compiles with).
- Dart tests: `test/booking_lifecycle_test.dart`, `test/published_rates_test.dart`,
  `test/booking_model_test.dart` (pure logic; no widget tests yet).
- Run before release: `flutter analyze` and `flutter test` from a Flutter
  3.27+ stable.

### Resolved since

- The unreachable guest-prototype files (`door_key.dart`, `kyc_storage.dart`,
  `esp32_service.dart`, `booking_store.dart`, `cloud_bookings.dart`, the
  `views/admin/` screens and their models) were deleted with ADR-0007; the
  Guest's flow lives on the website.
