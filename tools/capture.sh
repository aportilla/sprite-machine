#!/usr/bin/env bash
# Headless Chrome capture helper for the dev app.
#
# Headless Chrome does not reliably exit while the app's rAF loop runs, and this
# script may be SIGKILLed, which no trap catches. Cleanup has five layers:
#   1. shot mode kills Chrome as soon as the screenshot is written.
#   2. A detached watchdog reaps this run's Chrome and temp dir after a deadline.
#   3. An EXIT/INT/TERM trap cleans up on a normal exit.
#   4. Each run first reaps stale runs left by earlier ones (age-gated).
#   5. `capture.sh clean` reaps everything.
#
# Usage:
#   tools/capture.sh shot <url> <out.png>   # screenshot -> out.png
#   tools/capture.sh dom  <url>             # serialized DOM -> stdout
#   tools/capture.sh clean                  # reap all capture Chrome + temp dirs
#
# Examples:
#   tools/capture.sh shot 'http://localhost:5173/?sample=car' /tmp/shot.png
#   tools/capture.sh dom  'http://localhost:5173/?sample=car&diag=1'
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
ROOT="/tmp/cr-cap"                 # one root for all runs
DEADLINE="${CAPTURE_DEADLINE:-25}" # seconds before a run's Chrome is SIGKILLed
STALE_MIN=2                        # minutes untouched before a run dir is orphaned
mkdir -p "$ROOT"

# Kill every process whose command line contains this run dir, then remove the
# dir. Idempotent.
reap_run() {
  pkill -9 -f "$1" 2>/dev/null || true
  rm -rf "$1" 2>/dev/null || true
}

# Reap runs left by earlier invocations. Age-gated on the dir's mtime, so a live
# run, which Chrome keeps writing to, is skipped.
reap_orphans() {
  local d
  for d in "$ROOT"/run.*; do
    [ -e "$d" ] || continue
    if [ -z "$(find "$d" -maxdepth 0 -mmin -"$STALE_MIN" 2>/dev/null)" ]; then
      reap_run "$d"
    fi
  done
}

MODE="${1:?usage: capture.sh shot|dom|clean <url> [out.png]}"

if [ "$MODE" = "clean" ]; then
  for d in "$ROOT"/run.*; do [ -e "$d" ] && reap_run "$d"; done
  echo "capture: reaped all runs under $ROOT"
  exit 0
fi

URL="${2:?missing url}"
[ -x "$CHROME" ] || { echo "Chrome not found/executable at: $CHROME (set \$CHROME)" >&2; exit 3; }

reap_orphans
DIR="$(mktemp -d "$ROOT/run.XXXXXX")"
trap 'reap_run "$DIR"' EXIT INT TERM

# CAPTURE_VTB overrides the virtual-time budget (default 4000). Raise it when
# async work, such as ?diag=1 writing document.title, finishes after the dump.
COMMON=(--headless=new --disable-gpu --use-gl=angle --use-angle=swiftshader
  --hide-scrollbars --window-size=1000,850 --virtual-time-budget="${CAPTURE_VTB:-4000}"
  --force-device-scale-factor="${CAPTURE_DSF:-1}"
  --no-first-run --no-default-browser-check --user-data-dir="$DIR")

ARGS=("${COMMON[@]}")
case "$MODE" in
  shot)
    OUT="${3:?missing out.png}"
    mkdir -p "$(dirname "$OUT")"
    # Remove a stale file, or the wait below would see it and kill Chrome
    # before it writes.
    rm -f "$OUT"
    ARGS+=(--screenshot="$OUT")
    ;;
  dom)
    ARGS+=(--dump-dom)
    ;;
  *)
    echo "unknown mode: $MODE (expected shot|dom|clean)" >&2
    exit 2
    ;;
esac
ARGS+=("$URL")

# dom mode writes the DOM to a file so an empty dump can be detected. The
# watchdog is a detached subshell, so it still runs if this script is SIGKILLed.
DOMOUT="$DIR/dom.html"
if [ "$MODE" = "dom" ]; then
  "$CHROME" "${ARGS[@]}" >"$DOMOUT" 2>/dev/null &
else
  "$CHROME" "${ARGS[@]}" 2>/dev/null &
fi
CHROME_PID=$!
( sleep "$DEADLINE"; reap_run "$DIR" ) 2>/dev/null &
WATCHDOG=$!

# shot mode: kill Chrome once the file is written. It may keep running after the
# screenshot.
if [ "$MODE" = "shot" ]; then
  for _ in $(seq 1 $((DEADLINE * 2))); do
    if [ -s "$OUT" ]; then break; fi
    if ! kill -0 "$CHROME_PID" 2>/dev/null; then break; fi
    sleep 0.5
  done
  pkill -9 -f "$DIR" 2>/dev/null || true
fi

wait "$CHROME_PID" 2>/dev/null || true
kill "$WATCHDOG" 2>/dev/null || true # cancel the watchdog

if [ "$MODE" = "shot" ]; then
  [ -s "$OUT" ] && echo "shot -> $OUT" || { echo "capture failed: no $OUT written" >&2; exit 1; }
elif [ "$MODE" = "dom" ]; then
  # Exit non-zero on an empty dump. The cat below runs before the EXIT trap
  # removes $DIR.
  if [ ! -s "$DOMOUT" ]; then
    echo "capture failed: empty DOM (Chrome produced no output)" >&2
    exit 1
  fi
  # A failed navigation still dumps Chrome's error page. Detect it by its id.
  if grep -q 'id="main-frame-error"' "$DOMOUT"; then
    echo "capture failed: Chrome error page (dev server down or bad URL?)" >&2
    exit 1
  fi
  cat "$DOMOUT"
fi
