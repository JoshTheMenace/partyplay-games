#!/usr/bin/env bash
# Portraits, full-body renders and stage cards for the Reaches, captured from the game's own renderer through the lab server
# (npx vite --config packages/games/sky-clash/tools/lab.vite.config.ts --port 4430 --strictPort). Run from the PartyPlay root:
#   packages/games/sky-clash/tools/crew-art.sh fighter <kind> <head y> <portrait half-height> <body centre y> <body half-height> [portrait x]
#   packages/games/sky-clash/tools/crew-art.sh stage <arena id>
# Writes assets/portraits/<kind>[-1..3].webp (512 square), assets/renders/<kind>[-1..3].webp (640x800) and public/games/sky-clash/maps/<id>.webp (640x360).
set -euo pipefail
GAME=packages/games/sky-clash; TMP=output/skyclash-pass/art; mkdir -p "$TMP"
shoot() { ALPHA=${ALPHA:-} WAIT=230000 node $GAME/tools/lab-shoot.mjs "$TMP" "$1" 2>&1 | grep -v "request failed\|^\]$\|errors: \[$" || true; }
if [ "$1" = fighter ]; then
  kind=$2
  ALPHA=1 shoot "$kind-portraits|/pose-lab/crew.html?kinds=$kind&mode=pose&clip=select&frame=0&yaw=-24&pitch=.02&alpha=1&costumes=0,1,2,3&key=.72&rim=.8&cam=${7:-0},$3,$4&cell=512x512&cols=4|2048x512|ready|0"
  ALPHA=1 shoot "$kind-renders|/pose-lab/crew.html?kinds=$kind&mode=pose&clip=select&frame=0&yaw=-30&pitch=.04&alpha=1&costumes=0,1,2,3&key=.8&cam=0,$5,$6&cell=640x800&cols=4|2560x800|ready|0"
  for i in 0 1 2 3; do
    suffix=$([ $i = 0 ] && echo "" || echo "-$i")
    convert "$TMP/$kind-portraits.png" -crop 512x512+$((i * 512))+0 +repage -quality 88 -define webp:alpha-quality=90 "$GAME/assets/portraits/$kind$suffix.webp"
    convert "$TMP/$kind-renders.png" -crop 640x800+$((i * 640))+0 +repage -quality 88 -define webp:alpha-quality=90 "$GAME/assets/renders/$kind$suffix.webp"
  done
  ls -la $GAME/assets/portraits/$kind*.webp $GAME/assets/renders/$kind*.webp | awk '{print $5, $9}'
else
  id=$2
  shoot "$id-card|/stage-lab/scene.html?stage=$id&fighters=sola,toll,kes,vesper&clean=1&pause=2|1280x720|ready|7000"
  convert "$TMP/$id-card.png" -resize 640x360 -quality 86 "public/games/sky-clash/maps/$id.webp"; ls -la "public/games/sky-clash/maps/$id.webp" | awk '{print $5, $9}'
fi
