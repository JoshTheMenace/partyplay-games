#!/bin/sh
# Regenerate Starship Scramble art. Usage: sh art/render-all.sh [ships] [backdrops] [icons]  (default: all)
# BLENDER overrides the Blender binary; contact sheets land in output/ss-dev/art (ignored by git).
set -e
ART=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$ART/../../../.." && pwd)
PUB="$ROOT/public/games/starship-scramble"
BLENDER=${BLENDER:-$(command -v blender)}  # a full path: Blender locates its Metal kernels from argv[0]
LOG="$ROOT/output/ss-dev/art/blender.log"; mkdir -p "$(dirname "$LOG")"
blend() {
  script=$1; shift
  "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$ART/$script.py" -- "$@" > "$LOG" 2>&1 || { cat "$LOG"; exit 1; }
  grep -E 'Saved|WARNING' "$LOG" || true
}
for stage in ${*:-ships backdrops icons}; do
  case $stage in
    ships)
      (cd "$ROOT" && node --import tsx -e "import('./packages/games/starship-scramble/src/defs/hulls.ts').then(m => console.log(JSON.stringify(m.HULLS)))") > "$ART/hulls.json"
      blend ships "$PUB"; blend contact "$PUB" "$ROOT/output/ss-dev/art" ;;
    backdrops|icons) blend "$stage" "$PUB" ;;
    *) echo "unknown stage $stage" >&2; exit 1 ;;
  esac
done
