#!/bin/sh
# Build, render and validate fighters. Usage: tools/blender/build_all.sh [kind ...]   (no kinds = every fighters/*.py)
# Writes assets/{fighters,costumes,models,portraits,renders}/<kind>.* and output/sky-clash-v2/models/<kind>-{sheet.png,validate.json}.
set -e
HERE=$(cd "$(dirname "$0")" && pwd -P); GAME=$(cd "$HERE/../.." && pwd -P); BLENDER=${BLENDER:-/opt/homebrew/bin/blender}
KINDS=${*:-$(ls "$HERE/fighters" | sed -n '/^_/!s/\.py$//p')}
run() { "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$@" > "${LOG:-/dev/null}" 2>&1 || { echo "failed: $*"; "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$@" 2>&1 | tail -20; exit 1; }; }
for k in $KINDS; do
  echo "== $k"; run "$HERE/fighters/$k.py"; run "$HERE/render_sheet.py" -- "$k"
done
REPORT=$(mktemp); status=0; "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$HERE/validate.py" -- $KINDS > "$REPORT" 2>&1 || status=$?
grep -E '^\[|error|warning|valid' "$REPORT"; rm -f "$REPORT"; [ "$status" = 0 ] || { echo 'validation failed'; exit 1; }
if [ -z "$*" ]; then run "$HERE/render_sheet.py" -- --lineup "$GAME/../../../../output/sky-clash-v2/models/lineup.png" $KINDS; fi
