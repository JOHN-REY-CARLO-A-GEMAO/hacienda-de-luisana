# App Icon — Hacienda de LuisAna

`pubspec.yaml` → `flutter_launcher_icons` reads these. Regenerate the native
icons after `flutter pub get`:

```bash
dart run flutter_launcher_icons
```

| File | What it is |
|------|------------|
| `icon.png` | **As supplied by the client.** A 1024×1024 forest-green rounded square with the cream house mark — and a **white corner mat** outside the rounding (no alpha channel). Never wire this into an adaptive icon: Android crops to a circle or squircle and the white corners reappear as notches. |
| `icon-full-bleed.png` | The same artwork with the corner mat replaced by the artwork's own green (`srgb(45,80,47)` = `#2d502f`). This is what the config uses, so whatever a launcher reveals past the mark is green, not white. |

## Rebuilding `icon-full-bleed.png`

Mechanical colour keying — no drawing, no invented art. The corner flood is
connectivity-based, so it can never reach the mark: the cream house is enclosed
by green and is unreachable from any corner.

```bash
convert assets/icons/icon.png -alpha set -fuzz 8% -fill none -depth 8 \
  -draw "matte 2,2 floodfill"     -draw "matte 1021,2 floodfill" \
  -draw "matte 2,1021 floodfill"  -draw "matte 1021,1021 floodfill" \
  -background "#2d502f" -flatten -depth 8 -strip assets/icons/icon-full-bleed.png
```

Check it worked — both corners must read as the green, not the source's white
(`srgb(253,253,252)`), and the file must be byte-identical to the one committed:

```bash
identify -format "%[pixel:p{2,2}] %[pixel:p{1021,2}]\n" assets/icons/icon-full-bleed.png
# srgba(45,80,47,1) srgba(45,80,47,1)
md5sum assets/icons/icon-full-bleed.png
# 47bffa96ca725f4b17c8a28d2d7eb174
```

## Adaptive icons (Android 8+)

`adaptive_icon_foreground` is the full-bleed file itself with
`adaptive_icon_background` set to the same green and a 10% inset, so the mark
sits inside the safe zone and the background is invisible. To give the mark
more air, raise `adaptive_icon_foreground_inset`; do not shrink the artwork into
a smaller square, or the background colour becomes a visible ring.

## Not configured

`ios: true` writes `AppIcon.appiconset`; the App Store also wants a 1024×1024
mark with **no alpha and no rounded corners** — `icon-full-bleed.png` satisfies
both. `web:` and `windows:`/`macos:` are deliberately absent: this Flutter
project has only `android/` and `ios/` targets, and generating for a missing
`web/` folder fails the run.
