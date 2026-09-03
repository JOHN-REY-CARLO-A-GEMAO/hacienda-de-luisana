#!/usr/bin/env bash
# Download the real Hacienda de LuisAna property photos from the Google Maps
# listing. We request each image at high resolution (=w2048 variant).
set -euo pipefail

DEST="public/images/gmaps"
mkdir -p "$DEST"

# id => image path token (from the !6s URL param, minus size suffix)
declare -a IMGS=(
  "01|AHRPTWk0BkaDPbhk1Br4m9ZRYGeiV4fWeSd3k5pHgmidqnd0OHytYaDKmxeIYYX06jqrSvE7SSk4zVzkjaf-0-WGWliDPI20sIcx8i3Dzwatq14je-PJ26pnIabNaIgekOcIz0nb_w3p"
  "02|AHRPTWka0x-TtV7SR7ZCdeSSGoXG9ArUe1VnCspUmHE7Z0uyBVwX0X8T1wV4qdoBLmUAfLZTh15m7_QmMQzplniH539eSDYOVSr5pFdXvn8qWXmvcxGQpa4ctWPkS9qU47zOyC6eWtFm"
  "03|AHRPTWnpkVIC6KRW_MVSJk6J0cifeu5Dslrz0TIg5chwhXhFvAcaaQtBp6Vwz7eXbQs6OjFomBRnXt4tO6DlAnQXfVCejf292rVI-LaFJ9OZz0sQgefC81nG-pPwTa4G2O7GAiXkbCVi"
  "04|AHRPTWkEJV-XR-t-Ngp_jQj-qZk3CL6zK12wz9nKQ2vWfNrASwuIjVqIK0C3m_MVY6jHHu-oOXPLo4CCIGAoMPhaoEB5THlJZfvKcZiTi4LBgdDGa7n8Yqq_SyTJvY0O_GwwhUqZydDU"
  "05|AHRPTWl9MNTmY8t6S129H6XEmaPoMYL3IXHBYQmYupmdnuXCRThS4KICQiOSUurhAC6-AVLqlCqdLCXZTgmD_QdKGtumC3SpwavVx02onQ2jK_57oR0985DBhDwwAxMPxEGzuj4n84l6Vw"
  "06|AHRPTWmncfA9-71LwX0_qIGGx5rVQ0err728FKiOqQKxLNoXxHca3_H5zJ6AeoF_FtlLQbGoNbkmYXfifNbLoKnwMVhuPbqyD2qOuqqVSuRox3W7z9VnR6Ij2a_t_02vps9Z02SmHepe"
  "07|AHRPTWnRVWoFkszo9RMiLJs8HuTQAOlSolpYAu3_MQeAUBYrxLHbYBcJ7ayBAMA-pa4jViy6Wygsko7Qy2q8vRc9Ai7OKgCD6WrL0Zqbf1ZO2XMT2XoXAW1eA_QLE9e7Pf6AavGtJjUY"
  "08|AHRPTWk0bf4SXKLHz3BaAQT1MJ4Vyh-C__dlnXrjro_1cxXEO5Ot_P1TBD6IKyeAb7eICrNonPDDIthBYAKfGq8VWXnw6hvmiCiZ--LPB9GQS7CbHTCG3Zi9gjKSzx4mwElmDPqIS6jcYQ"
  "09|AHRPTWks5LyAevs_ahedEDAnKZlB5mWa-PteX-JwEwMazBbQc1sDxeDv2vUEUYDB1TVqMURHzLUIX9k_vX40ru2HzTDbsLSSPoj-uaCGXIJitdnpHSz3d3e2H3i5-NrC9ZHP1dyHrox1USTjXgdK"
  "10|AHRPTWkIndddLHnLht2NBBlbCWuE3653q4gge-SOaQ79q12tUUUTAaoqU2gq--Q2GENI0o25UfJtMYZEGkA2zgHm9-Sv7DDgd9TD4qJJcIGK80nSSUljkOrKEezFvSzoLgZGOBfmG17g8l1IZfw"
  "11|AHRPTWmepdOyovLFHz1dbu0h--wrAaaLBhPxLco-gTwqhUyVHZ_n-vzs8RZgbUbWncx-482MytKoWTrH7CeCULL8ub8MdyyKt3Yuq6QU7OPB-0yw3jfxcfGHFbbAp7YpTameYEuJcEAGJ_5HriPH"
  "12|AHRPTWlXkBuS5LIKoAV5edneRYR1P-C10Lz3OdMMvpebHQUm5igZKkmqxgB9bdGYP1I9vozL9yXPxk8sPO9UzuHOScQ3d67ntheO0DnjUCuEGmc-JEhByCsbrgnX7Jb1oe-EiSV5jgP2"
  "13|AHRPTWk8w2QzzCXqBZJSKS3Js4Pb8qJD-ra2oUoH9t25S3n_MYs0yihnX1OjHwhHWfO2gZhxfdrfjXTZVbeZ88n__k3TLqo-_zbCsV2vPI2cAzZP41PoBJUXIuf5xZW2NveXr41AbKp1aC2f8gsb"
  "14|AHRPTWmfL4KAN0dn0W-8CFLf2_4t4Xm49PPvRYJNrrquwo2isPhzHTNM_2u4ejgQg0I-PRvnroFeypX_pPDKJCwRy8skmySFT7z-YahW7mitI4bCPY9wDNLQKf6brg8O7uqkI7fdKT1YXMNgzATf"
)

for entry in "${IMGS[@]}"; do
  id="${entry%%|*}"
  tok="${entry#*|}"
  url="https://lh3.googleusercontent.com/gps-cs-s/${tok}=w2048-h1536-k-no"
  out="${DEST}/img-${id}.jpg"
  echo "Downloading ${id} ..."
  curl -sS -A "Mozilla/5.0" -L --max-time 60 "$url" -o "$out"
  # If we got very small file, fall back to lower res
  size=$(stat -c%s "$out")
  if [ "$size" -lt 5000 ]; then
    echo "  ↳ small (${size}b), retrying at w1600"
    curl -sS -A "Mozilla/5.0" -L --max-time 60 \
      "https://lh3.googleusercontent.com/gps-cs-s/${tok}=w1600-h1200-k-no" -o "$out"
  fi
  echo "  ✔ $(stat -c%s "$out") bytes"
done

echo
echo "Done."
ls -lh "$DEST"
