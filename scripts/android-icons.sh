#!/usr/bin/env bash
# Generate Android launcher + splash images from resources/icon.png and resources/splash.png
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/android/app/src/main/res"
ICON="$ROOT/resources/icon.png"
SPLASH_SRC="$ROOT/resources/splash.png"

if [[ ! -f "$ICON" ]]; then
  echo "Missing $ICON" >&2
  exit 1
fi

# Launcher (mdpi=48 … xxxhdpi=192)
declare -A LAUNCHER=([mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192)
# Adaptive foreground (108dp)
declare -A FORE=([mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432)

for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  mkdir -p "$RES/mipmap-$d"
  convert "$ICON" -resize "${LAUNCHER[$d]}x${LAUNCHER[$d]}" PNG32:"$RES/mipmap-$d/ic_launcher.png"
  # Round mask
  s="${LAUNCHER[$d]}"
  r=$((s / 2))
  convert "$ICON" -resize "${s}x${s}" \
    \( +clone -alpha extract -threshold 0 -fill white -draw "circle $r,$r $r,0" \) \
    -alpha off -compose CopyOpacity -composite PNG32:"$RES/mipmap-$d/ic_launcher_round.png"
  convert "$ICON" -resize "${FORE[$d]}x${FORE[$d]}" PNG32:"$RES/mipmap-$d/ic_launcher_foreground.png"
done

splash_one() {
  local w=$1 h=$2 out=$3
  local icon=$(( w < h ? w / 3 : h / 3 ))
  convert -size "${w}x${h}" xc:'#0f1c11' \
    \( "$SPLASH_SRC" -resize "${icon}x${icon}" \) \
    -gravity center -composite PNG32:"$out"
}

splash_one 480 320 "$RES/drawable/splash.png"
splash_one 320 480 "$RES/drawable-port-mdpi/splash.png"
splash_one 480 800 "$RES/drawable-port-hdpi/splash.png"
splash_one 720 1280 "$RES/drawable-port-xhdpi/splash.png"
splash_one 1080 1920 "$RES/drawable-port-xxhdpi/splash.png"
splash_one 1440 2560 "$RES/drawable-port-xxxhdpi/splash.png"
splash_one 480 320 "$RES/drawable-land-mdpi/splash.png"
splash_one 800 480 "$RES/drawable-land-hdpi/splash.png"
splash_one 1280 720 "$RES/drawable-land-xhdpi/splash.png"
splash_one 1920 1080 "$RES/drawable-land-xxhdpi/splash.png"
splash_one 2560 1440 "$RES/drawable-land-xxxhdpi/splash.png"

echo "Android icons and splash written under $RES"
