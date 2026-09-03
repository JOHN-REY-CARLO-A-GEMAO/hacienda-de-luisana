#!/usr/bin/env bash
set -euo pipefail
DEST="public/images/nearby"
mkdir -p "$DEST"

# name => image token
declare -a IMGS=(
  "hulugan|AHRPTWllL3r8-CB1BZPhiG_unwYyMV6FiWsvlQKw9fOhkOZWfddFto6TX60IPn2LEyEQlSRfxskhGd6e-ubRxcEqtvFYYqKlDEbbwqOqI_crHX3YDQl8ASav8Y2Y_B8vIlJRfmBpepn9wEaZ-uji"
  "sumucab|AHRPTWnzFb4Nbsz93DMjbgtg1HLDHr2FvxVf8YxMiyhruwTrv8SXupnygXMy-3vXdGv0sb7w40UcqN0wzLtKZrnmtd6hvSYPA2dzAwsZEBEJjOcLSAurwHzUPc4rJcStfQxF6ikE-a_1"
  "aliw|AHRPTWnddXRZSNQ1ToFUMf_8qNXeck_ikVvwDxkalOG5voZGdK2A6M635t_DzEHNoIFbyVjiLFqsh6sNcT3zz0nAl2xmNiV230AYnEPuaXIxAeXtZkzjPCiKlAf7cBHsL0IBilW3DlcEQQ"
  "kamay|AHRPTWl5798k3AwzhZdY0Sj1NTVidhDtbDfroTSMrnaurfvX4y4xHiN51XkLqTz1Haxanck95j-4dIU-NNjznBboj6SShU1VjuXugdJUrSuzKkU_xp445bDAY1eWV3MuDJDipsxIO1E"
  "caliraya|AHRPTWkIZ983wGcXiWd_uj9MESeDTSQAQubiLM8En0s7K1ptFSVoeI2vkLAa0vlG1GNRZMng_dQeLTbkVROYude3o5SBWdHZezJQaTRfcxl3B_Hj5wWtNe01dIuNwePRCcFBSEZNVt4"
  "cavinti|AHRPTWmlEkL6Kf1sBW9dzEYPIvVrZMiAVjtcAM7xSiZeCkA8Oq0A6s4LtnaDq39gWsyAFgQJdjS_kSBZfxCm55K9Iql6jNlBLh5wua8LdQkPVn8zCSBrrgxvBbf35zGaiFz89K1cpTj9hQ"
)

for entry in "${IMGS[@]}"; do
  name="${entry%%|*}"
  tok="${entry#*|}"
  url="https://lh3.googleusercontent.com/gps-cs-s/${tok}=w2048-h1536-k-no"
  out="${DEST}/${name}.jpg"
  echo "Downloading ${name} ..."
  curl -sS -A "Mozilla/5.0" -L --max-time 60 "$url" -o "$out"
  size=$(stat -c%s "$out")
  if [ "$size" -lt 5000 ]; then
    echo "  ↳ small, retrying at w1600"
    curl -sS -A "Mozilla/5.0" -L --max-time 60 \
      "https://lh3.googleusercontent.com/gps-cs-s/${tok}=w1600-h1200-k-no" -o "$out"
  fi
  echo "  ✔ $(stat -c%s "$out") bytes"
done
ls -lh "$DEST"
