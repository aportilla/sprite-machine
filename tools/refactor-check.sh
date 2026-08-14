#!/usr/bin/env bash
# Refactor safety net: shoot a fixed URL matrix through tools/capture.sh and
# compare byte-for-byte against recorded baselines. Screenshots are
# byte-deterministic (fixed window size, DSF 1, virtual time budget, rotate=0),
# so `cmp` is a real "no visual change" gate — not a judgment call. A couple of
# `dom` snapshots ride along so structural drift shows up as a readable diff.
#
# Usage:
#   npm run dev                      # in another shell
#   tools/refactor-check.sh record   # (re)record baselines into refactor-baselines/
#   tools/refactor-check.sh          # compare current app against the baselines
#   tools/refactor-check.sh check 5174   # non-default dev-server port
#
# refactor-baselines/ is git-ignored: baselines are per-checkout scratch state
# for the component-decomposition refactor, not versioned artifacts.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-check}"
PORT="${2:-5173}"
BASE="refactor-baselines"
HOST="http://localhost:$PORT"

case "$MODE" in
  record | check) ;;
  *)
    echo "usage: refactor-check.sh [record|check] [port]" >&2
    exit 2
    ;;
esac

curl -s -o /dev/null --max-time 3 "$HOST/" || {
  echo "refactor-check: no dev server on :$PORT (npm run dev)" >&2
  exit 3
}

# Warm-up: after an edit, Vite transforms modules on first request, and the
# dynamically-imported diag module can miss the capture's virtual-time budget on
# a cold graph — the DIAG title then never lands. One throwaway page hit makes
# every subsequent capture run against a hot module graph.
tools/capture.sh dom "$HOST/?diag=1&rotate=0" >/dev/null 2>&1 || true

# name|query — every entry pins rotate=0 so the mesh angle is deterministic.
SHOTS=(
  'default|/?rotate=0'
  'edit-front|/?edit=front&rotate=0'
  'palette|/?palette=1&rotate=0'
  'cursor5|/?cursor=5&rotate=0'
  'rect|/?rect=3,3,20,14,4&rotate=0'
  'rect-square|/?rect=3,3,20,14,4,1&rotate=0'
  'fill|/?fill=5,5,1&rotate=0'
  'pick37|/?pick=37&rotate=0'
  'tile24|/?tile=24&rotate=0'
  'lowpoly-off|/?lowpoly=0&rotate=0'
)
DOMS=(
  'default|/?rotate=0'
  'edit-front|/?edit=front&rotate=0'
  'diag|/?diag=1&rotate=0'
)

mkdir -p "$BASE"
fails=0

# Three nondeterministic byte sequences pollute an otherwise stable DOM dump:
# lit stamps its marker comments with a per-page-load random number
# (<!--?lit$NNNNNNNN$-->); Vite cache-busts module URLs with ?t=<mtime> once a
# module has been edited under the running dev server; and the ?diag=1 title is
# written ASYNCHRONOUSLY (a dynamic import racing the virtual-time dump), so
# whether it landed by dump time is a coin flip. Normalize all three so `diff`
# only sees real drift — the diag title is asserted semantically below instead.
normalize_dom() {
  sed -E -e 's/lit\$[0-9]+\$/lit$N$/g' -e 's/\?t=[0-9]+//g' \
    -e 's|<title>[^<]*</title>|<title>TITLE</title>|'
}

if [ "$MODE" = "record" ]; then
  for e in "${SHOTS[@]}"; do
    name="${e%%|*}"
    url="$HOST${e#*|}"
    tools/capture.sh shot "$url" "$BASE/$name.png" >/dev/null
    echo "recorded  $name.png"
  done
  for e in "${DOMS[@]}"; do
    name="${e%%|*}"
    url="$HOST${e#*|}"
    tools/capture.sh dom "$url" | normalize_dom >"$BASE/$name.dom.html"
    echo "recorded  $name.dom.html"
  done
  echo "baselines recorded into $BASE/"
  exit 0
fi

# --- check ------------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for e in "${SHOTS[@]}"; do
  name="${e%%|*}"
  url="$HOST${e#*|}"
  if [ ! -s "$BASE/$name.png" ]; then
    echo "MISS  $name.png (no baseline — run 'refactor-check.sh record')"
    fails=$((fails + 1))
    continue
  fi
  tools/capture.sh shot "$url" "$TMP/$name.png" >/dev/null
  if cmp -s "$BASE/$name.png" "$TMP/$name.png"; then
    echo "ok    $name.png"
  else
    # Keep the differing shot next to the baseline for eyeballing.
    cp "$TMP/$name.png" "$BASE/$name.FAIL.png"
    echo "DIFF  $name.png (differing shot kept at $BASE/$name.FAIL.png)"
    fails=$((fails + 1))
  fi
done

for e in "${DOMS[@]}"; do
  name="${e%%|*}"
  url="$HOST${e#*|}"
  if [ ! -s "$BASE/$name.dom.html" ]; then
    echo "MISS  $name.dom.html (no baseline — run 'refactor-check.sh record')"
    fails=$((fails + 1))
    continue
  fi
  tools/capture.sh dom "$url" | normalize_dom >"$TMP/$name.dom.html"
  if diff -q "$BASE/$name.dom.html" "$TMP/$name.dom.html" >/dev/null; then
    echo "ok    $name.dom.html"
  else
    cp "$TMP/$name.dom.html" "$BASE/$name.FAIL.dom.html"
    echo "DIFF  $name.dom.html (kept at $BASE/$name.FAIL.dom.html — diff it)"
    fails=$((fails + 1))
  fi
done

# The ?diag=1 self-check writes its result into document.title — assert the
# watertight report actually runs (mode-tagged). The write is async against the
# dump timer, so retry a couple of times before calling it a failure.
diag_ok=0
for _ in 1 2 3; do
  if tools/capture.sh dom "$HOST/?diag=1&rotate=0" 2>/dev/null | grep -q 'DIAG lowpoly'; then
    diag_ok=1
    break
  fi
done
if [ "$diag_ok" = 1 ]; then
  echo "ok    diag title reports DIAG lowpoly"
else
  echo "FAIL  diag title missing 'DIAG lowpoly' (self-check did not run?)"
  fails=$((fails + 1))
fi

if [ "$fails" -gt 0 ]; then
  echo "refactor-check: $fails FAILURE(S)"
  exit 1
fi
echo "refactor-check: all identical"
