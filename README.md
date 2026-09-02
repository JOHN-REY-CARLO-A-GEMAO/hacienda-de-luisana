# Hacienda de LuisAna - Quiet Luxury Guest Prototype

A Flutter mobile application designed for **Hacienda de LuisAna** located in Luisiana, Laguna — featuring a slow living / quiet luxury theme, online booking flow with KYC verification, guest dashboard, and simulated ESP32 Smart Lock integration.

## Tech Stack & Architecture

- **Flutter 3.44.4 / Dart 3.12**
- **State Management**: `provider: ^6.1.2`
- **Typography & Theme**: `google_fonts: ^6.2.1` (Cormorant Garamond + Inter), Material 3 Design
- **Animations & Indicators**: `flutter_spinkit: ^5.2.1`
- **Utilities**: `url_launcher: ^6.2.5`, `image_picker: ^1.1.2`, `intl: ^0.19.0`

## Quiet Luxury Theme Palette (`lib/theme/app_theme.dart`)

- `forest900`: `#0F1C11`
- `forest800`: `#243B26`
- `olive`: `#8A9A5B`
- `cream50`: `#FBF9F3`
- `cream100`: `#F3EFE0`
- `goldAccent`: `#C5A059`

## Application Structure

- **AppShell (`lib/main.dart:34`)**: 5-Tab NavigationBar (`IndexedStack` + `NavigationBar`)
  1. **Home (`lib/main.dart:65`)**: 380px SliverAppBar with PageView hero gallery (`assets/images/gmaps/img-03/05/07.jpg`), overlay gradient, dot indicator, CTA buttons, stats bar (12 guests / 2 camping decks / 4.9★ rating), horizontal featured stay cards.
  2. **Stay (`lib/main.dart:152`)**: ChoiceChip filters (All, Main House, Camping Units), accommodation cards list (Main House 12 guests @ PHP 8,500/night; Camping A Forest Deck 4 guests @ PHP 1,800/night; Camping B Riverside 4 guests @ PHP 1,500/night), and detailed modal view with amenities wrap.
  3. **Explore (`lib/main.dart:183`)**: TabBar with Nearby Attractions (`nearbyList`: Hulugan Falls, Aliw Falls, Caliraya Lake, Kamay ni Hesus) + `url_launcher` "Open in Maps →", and 2-column Photo Gallery with filter chips and fullscreen dialog preview.
  4. **Book (`lib/main.dart:214`)**: 2-step booking flow with form validation, dropdown selection, `showDatePicker` check-in/out, guest count slider (1-12), phone/name/notes -> creates `Booking:HDL-xxx` (`lib/models/booking.dart`).
  5. **Key / Guest Dashboard (`lib/main.dart:317` & `lib/main.dart:337`)**: `BookingStore` integration (`provider`), status badge (Pending / Confirmed / Checked-in), check-in/out summary, "My Digital Key" button (disabled until booking confirmed), host direct contact buttons (`tel:+639258507707` + Messenger).

- **KYC & Confirmation (`lib/main.dart:260`)**: `KycScreen` with image picking for Govt ID & deposit receipt, terms agreement, submission -> `BookingStore.confirm()` -> `BookingConfirmationScreen` with Ref ID and summary.

- **ESP32 Smart Lock (`lib/services/esp32_service.dart`)**: Simulated Bluetooth 5.0 smart lock with 800ms unlock delay, auto re-lock after 5s. On `DigitalKeyScreen`, features a 1.2s circular press & hold gesture (`GestureDetector`), `CircularProgressIndicator` (0.0 -> 1.0 progress), `SpinKitPulse` ripple animation, and SnackBar alerts.

## Running the App

To run on an Android device or emulator:
```bash
flutter run
```

To run on Web:
```bash
flutter run -d chrome
```
