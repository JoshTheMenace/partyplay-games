#!/bin/sh
# Rebuild pieces.glb, props.glb and expansions.glb. `./build.sh --preview` also renders art/preview/*.png.
set -e
[ "$1" = --preview ] && PREVIEW=1
ART=$(cd "$(dirname "$0")" && pwd -P)
OUT="$ART/../../../../public/games/island-settlers/models"
BLENDER=${BLENDER:-/opt/homebrew/bin/blender}
for bundle in pieces props expansions; do
  set -- "$OUT/$bundle.glb"
  [ "$PREVIEW" = 1 ] && set -- "$@" --preview "$ART/preview/$bundle.png"
  "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$ART/$bundle.py" -- "$@" | grep -E 'tris|wrote'
done
