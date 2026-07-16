#!/usr/bin/env bash
# Headless-Chrome capture helper for the sprite-machine dev app.
#
# The app runs an infinite requestAnimationFrame loop, so headless Chrome never
# exits on its own — it must be force-killed or it leaks. This script wraps the
# launch + guaranteed pkill + temp-dir cleanup in one place so callers never
# need a bare `rm -rf` (which forces a manual permission confirm every time).
#
# Usage:
#   tools/capture.sh shot <url> <out.png>   # screenshot -> out.png
#   tools/capture.sh dom  <url>             # print serialized DOM to stdout
#
# Examples:
#   tools/capture.sh shot 'http://localhost:5173/?sample=1&lowpoly=1&rotate=0' /tmp/shot.png
#   tools/capture.sh dom  'http://localhost:5173/?sample=1&lowpoly=1&diag=1&rotate=0'
set -euo pipefail

MODE="${1:?usage: capture.sh shot|dom <url> [out.png]}"
URL="${2:?missing url}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DIR="$(mktemp -d /tmp/cr-cap.XXXXXX)"
cleanup() { pkill -f "user-data-dir=$DIR" 2>/dev/null || true; rm -rf "$DIR"; }
trap cleanup EXIT

COMMON=(--headless=new --disable-gpu --use-gl=angle --use-angle=swiftshader
  --hide-scrollbars --window-size=1000,850 --virtual-time-budget=4000
  --user-data-dir="$DIR")

case "$MODE" in
  shot)
    OUT="${3:?missing out.png}"
    "$CHROME" "${COMMON[@]}" --screenshot="$OUT" "$URL" >/dev/null 2>&1 || true
    echo "shot -> $OUT"
    ;;
  dom)
    "$CHROME" "${COMMON[@]}" --dump-dom "$URL" 2>/dev/null || true
    ;;
  *)
    echo "unknown mode: $MODE (expected shot|dom)" >&2; exit 2 ;;
esac
