# Property Photos — Hacienda de LuisAna

Two copies of every photo are kept on purpose:

- **`assets/images/gmaps/`** — the originals archive. This is where a client- or
  Google-Maps-supplied photo lands first. Nothing in the Flutter app renders
  these today (`pubspec.yaml` bundles `assets/`, which is not recursive); they
  are the master copies.
- **`public/images/gmaps/`** — the copies the guest website actually serves.
  A photo that exists only here in `assets/` is invisible to a visitor.

## Adding a photo

1. Drop the original in `assets/images/gmaps/`.
2. Copy it to `public/images/gmaps/`. Keep the file web-sized (longest edge
   ≤ 2048px, under ~500KB) — `npm run build` will not resize it for you.
3. Add one entry to `GALLERY` in `src/config/site.ts` (and to an
   `ACCOMMODATIONS[].images` array if it belongs on a house card).
4. `npm run test` — `test/web/gallery-images.test.ts` fails if a config path has
   no file behind it, or if a file in `public/images/` has no config entry.

Names: `img-NN.jpg` is the numbering the download scripts use
(`scripts/download-gmaps.sh` pulls `img-01`–`img-14` from the Google Maps
listing, `scripts/download-nearby.sh` the `public/images/nearby/` set).
Photos supplied directly by the client keep a descriptive snake_case name so
they survive a re-run of those scripts.

## Mapping

| File | Shot | Used in |
|------|------|---------|
| img-01 … img-14 | Google Maps listing photos | `GALLERY`, `ACCOMMODATIONS`, `EXPERIENCES` |
| main_house_facade.jpg | Front of the main house — HDL sign, bench, parasol | `GALLERY` (Main House) |
| main_house_night_lit.jpg | The main house lit at night, above the carport | `GALLERY` (Main House) |
| annex_night_lit.jpg | The Annex lit at night, above its carport and balcony | `ACCOMMODATIONS` (Annex) |
| hdl_sign_wall.jpg | The round wooden HDL sign on the wall | `GALLERY` (Hacienda) |
| entrance_porch_sign.jpg | Entrance porch of the main house, through a Norfolk pine | `GALLERY` (Main House) |
| camping_units_garden.jpg | The two A-frame units seen through the garden | `GALLERY` (Camping) |
| camping_units_stepping_stones.jpg | Stepping-stone paths to each unit | `GALLERY` (Camping) |
| hdl_logo.jpg | The roundel brand mark | `public/images/brand/hdl-logo.jpg` → `og:image` in `index.html` |

## Deliberately not used

These arrived with the batch above and are **not** wired into the site:

| File | Why |
|------|-----|
| `camping_units_stepping_stones_alt.jpg` | Second frame of the same shot (≈0.7% RMSE against `camping_units_stepping_stones.jpg`) — a duplicate tile in the gallery. |
| `aliw_falls.jpg`, `hulugan_falls.jpg` | Carry a `riley.ph` photographer's watermark, and show a tourist in frame. |
| `kamay_ni_hesus.jpg` | Carries a Daily Tribune masthead bug and is 480×270 — too small for the gallery grid. |
| `caliraya_lake.jpg` | 612×408 aerial; the existing `nearby/caliraya.jpg` is cleaner and larger. |

The four attraction photos are third-party work, and the site's own rule is that
every guest-facing asset is either the Hacienda's own or attributed — the
unwatermarked Google Maps versions already live in `public/images/nearby/` and
back the `NEARBY` cards. Keep them out unless the Hacienda supplies its own
shot or grants written permission to reuse someone else's.
