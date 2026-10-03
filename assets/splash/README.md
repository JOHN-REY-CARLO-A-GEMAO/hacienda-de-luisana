# Native Splash — Hacienda de LuisAna

`pubspec.yaml` → `flutter_native_splash` reads these. Regenerate the native
launch screens after `flutter pub get`:

```bash
dart run flutter_native_splash:create
```

| File | What it is |
|------|------------|
| `splash.png` | **As supplied.** 1024×1024, the cream house mark centred on the dark-green field (`srgb(15,32,16)`). Used for Android ≤11 and iOS. |
| `splash-android12.png` | The same artwork padded losslessly onto the **1152×1152** canvas Android 12+ specifies for a centre icon with no icon background, the mark well inside the 768px safe circle. Nothing is scaled, so the line weight is unchanged. |

Android 12 and later ignore the general `color`/`image` keys entirely — they
compose a window colour, a centre icon and an optional icon background, and clip
the icon to a circle. Skipping the `android_12:` block is what leaves a
device on API 31+ showing the plain white default, which is why it exists here.

## Rebuilding `splash-android12.png`

Canvas first, then the artwork centred — padding, never a resize:

```bash
convert -size 1152x1152 xc:"#0f2010" assets/splash/splash.png \
  -gravity center -composite -depth 8 -strip assets/splash/splash-android12.png
```

The pad colour is sampled from `splash.png`'s own corner, so the extension is
invisible. `splash.png` is not a flat fill — the field carries a fine grain — so
a one-point difference between the two files at the same coordinate is expected,
not a bug:

```bash
identify -format "%f %[pixel:p{4,4}]\n" assets/splash/splash.png assets/splash/splash-android12.png
# splash.png             srgb(14,32,16)
# splash-android12.png   srgb(15,32,16)
md5sum assets/splash/splash-android12.png
# 0d6fe42758974ccce62b6575162e4f95
```

## Colours

`#0f2010` is sampled from the artwork, not taken from the palette — the nearest
token, Tailwind/`AppColors` forest-950 `#0f1c11`, differs by 4 points of green,
which is enough to see a square seam behind the image on a tall screen. The
splash field and the image must be the same number.

No `color_dark`/`image_dark`: `lib/core/theme/app_theme.dart` pins
`Brightness.light`, so a dark splash would be the one place the app contradicted
its own theme.
