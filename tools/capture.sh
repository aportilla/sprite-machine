#!/usr/bin/env bash
# Headless-Chrome capture helper for the sprite-machine dev app.
#
# The dev app runs an infinite requestAnimationFrame loop and, under
# --headless=new, Chrome does not reliably exit on its own — so cleanup is
# defence-in-depth. An agent harness may background this script and then SIGKILL
# it, and SIGKILL cannot be trapped, so a plain `trap ... EXIT` is not enough (it
# used to leak dozens of Chrome processes + /tmp temp dirs). The layers:
#   1. shot mode kills Chrome the instant the screenshot lands — fast, no hang;
#   2. a DETACHED watchdog reaps THIS run's Chrome + temp dir after a deadline;
#      being a separate process, it survives even a SIGKILL of this script;
#   3. an EXIT/INT/TERM trap cleans up on the normal / soft-kill path;
#   4. every run first REAPS stale prior runs (age-gated, so concurrent runs are
#      safe) — self-healing any leak an earlier hard-killed run left behind;
#   5. `capture.sh clean` reaps everything on demand.
#
# Usage:
#   tools/capture.sh shot <url> <out.png>   # screenshot -> out.png
#   tools/capture.sh dom  <url>             # serialized DOM -> stdout
#   tools/capture.sh clean                  # reap all capture Chrome + temp dirs
#
# Examples:
#   tools/capture.sh shot 'http://localhost:5173/?sample=car&lowpoly=1&rotate=0' /tmp/shot.png
#   tools/capture.sh dom  'http://localhost:5173/?sample=car&diag=1&rotate=0'
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
ROOT="/tmp/cr-cap"                 # one root for all runs, so a sweep is trivial
DEADLINE="${CAPTURE_DEADLINE:-25}" # hard seconds before a run's Chrome is SIGKILLed
STALE_MIN=2                        # a run dir untouched this long (min) is orphaned
mkdir -p "$ROOT"

# Kill every process whose command line references this run dir (main browser +
# any crashpad/helper carrying the path) and remove the dir. Idempotent.
reap_run() {
  pkill -9 -f "$1" 2>/dev/null || true
  rm -rf "$1" 2>/dev/null || true
}

# Reap runs abandoned by a previous (possibly SIGKILLed) invocation. Age-gated on
# the dir's mtime so a live or concurrent run (Chrome keeps writing to it) is
# never clobbered.
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

# CAPTURE_VTB overrides the virtual-time budget: async work that races the dump
# (e.g. ?diag=1's dynamic import writing document.title) gets more scheduler
# turns under a bigger budget. The default stays 4000 — shots are pinned to it
# (a different budget can change the dumped frame).
COMMON=(--headless=new --disable-gpu --use-gl=angle --use-angle=swiftshader
  --hide-scrollbars --window-size=1000,850 --virtual-time-budget="${CAPTURE_VTB:-4000}"
  --force-device-scale-factor="${CAPTURE_DSF:-1}"
  --no-first-run --no-default-browser-check --user-data-dir="$DIR")

ARGS=("${COMMON[@]}")
case "$MODE" in
  shot)
    OUT="${3:?missing out.png}"
    mkdir -p "$(dirname "$OUT")"
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

# Launch Chrome in the background (stderr hushed). `dom` mode's stdout (the DOM)
# is captured to a file so it can be validated non-empty before we hand it to the
# caller — a dead dev server or a Chrome failure otherwise prints nothing and still
# exits 0, a false success. The watchdog is a DETACHED subshell: if THIS script is
# SIGKILLed it is reparented and still runs, guaranteeing this run is reaped.
DOMOUT="$DIR/dom.html"
if [ "$MODE" = "dom" ]; then
  "$CHROME" "${ARGS[@]}" >"$DOMOUT" 2>/dev/null &
else
  "$CHROME" "${ARGS[@]}" 2>/dev/null &
fi
CHROME_PID=$!
( sleep "$DEADLINE"; reap_run "$DIR" ) 2>/dev/null &
WATCHDOG=$!

# shot mode: stop Chrome the moment the file lands rather than waiting out the
# deadline (Chrome may keep the rAF loop running after the screenshot).
if [ "$MODE" = "shot" ]; then
  for _ in $(seq 1 $((DEADLINE * 2))); do
    if [ -s "$OUT" ]; then break; fi
    if ! kill -0 "$CHROME_PID" 2>/dev/null; then break; fi
    sleep 0.5
  done
  pkill -9 -f "$DIR" 2>/dev/null || true
fi

wait "$CHROME_PID" 2>/dev/null || true
kill "$WATCHDOG" 2>/dev/null || true # normal path: cancel the watchdog

if [ "$MODE" = "shot" ]; then
  [ -s "$OUT" ] && echo "shot -> $OUT" || { echo "capture failed: no $OUT written" >&2; exit 1; }
elif [ "$MODE" = "dom" ]; then
  # Validate before handing the DOM to the caller (the cat runs before the EXIT
  # trap removes $DIR), so a failed capture is a non-zero exit, not a false success.
  if [ ! -s "$DOMOUT" ]; then
    echo "capture failed: empty DOM (Chrome produced no output)" >&2
    exit 1
  fi
  # A failed navigation (dev server down, bad URL) still dumps a DOM — Chrome's
  # net-error interstitial, identifiable by the stable Chromium error-page id.
  # Reject it rather than hand back a bogus page that looks like success.
  if grep -q 'id="main-frame-error"' "$DOMOUT"; then
    echo "capture failed: Chrome error page (dev server down or bad URL?)" >&2
    exit 1
  fi
  cat "$DOMOUT"
fi
# The EXIT trap reaps this run's Chrome + temp dir.
