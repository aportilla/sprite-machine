#!/usr/bin/env bash
# Golden screenshots: the app's LOOK as a regression gate, over capture.sh.
#
# capture.sh's shots are byte-deterministic (a fixed window, DSF 1, a
# virtual-time budget, a fresh --user-data-dir per run so IndexedDB is empty
# and no machine's saved docs leak into the frame, the model at rest, the
# clock frozen through ?now), so `cmp` between a fresh shot and a committed
# one is a real check. Every "does it look right" question — a dim label, a
# dotted rule, a header's height, the ring's ink, the DITL — lives here, as
# pixels, instead of as geometry assertions in the drive.
#
# Usage:
#   tools/goldens.sh update [port]   # shoot every golden into docs/goldens/<name>.png
#   tools/goldens.sh check  [port]   # shoot into a temp dir, cmp each against docs/goldens/
#                                    # exit 1 naming any mismatch (the fresh shots are kept
#                                    # for an eye: the temp dir is printed)
#
# A golden changes only in a commit that changed the look on purpose, after
# the diff has been eyeballed. A kit bump moves pixels: regenerate after
# review. A shot that differs between two `check` runs on an idle machine is
# not a golden — drop it rather than compare with a tolerance.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOLD="$HERE/../docs/goldens"
CAPTURE="$HERE/capture.sh"

MODE="${1:?usage: goldens.sh update|check [port]}"
PORT="${2:-5173}"
BASE="http://localhost:$PORT/"
# The menu bar's clock is in every frame; one instant for every shot.
NOW="2026-08-24T19:27"

# name|query — the query is everything after the host; ?sample boots the
# deterministic path (no seeding, no greet); ?fresh ignores storage.
#
# Every shot with the application up hides the 3D View (`hide=stage`): its
# header's checkbox row lands one px higher or lower between loads (a
# 20-px row centered on the header's 23 — the kit's whole-px centering
# reads a half px one way or the other), so a shot with it in frame is not
# a golden. Its look is the eye's (docs/SMOKE-TEST.md). The fill shot is
# the contiguous fill: the all-faces replace (`fill=x,y,0,1`) does not
# finish under capture.sh's virtual-time budget.
GOLDENS=(
  "boot-about|?fresh=1&about=1&hide=stage"
  "editor-pencil|?sample=car&edit=front&cursor=7,circle&hide=stage"
  "editor-rect|?sample=car&edit=front&rect=3,3,20,14,2&hide=stage"
  "editor-selection|?sample=car&edit=front&select=3,3,20,14&hide=stage"
  "editor-fill|?sample=car&edit=front&fill=5,5&pick=37&hide=stage"
  "derived-face|?sample=car&edit=right&hide=stage"
  "atlas-strip|?sample=car&edit=front&ring=8,30,45,128,gray&hide=stage"
  "desktop-patterns|?fresh=1&patterns=1"
)

case "$MODE" in
  update) OUT="$GOLD" ;;
  check) OUT="$(mktemp -d /tmp/goldens.XXXXXX)" ;;
  *)
    echo "unknown mode: $MODE (expected update|check)" >&2
    exit 2
    ;;
esac
mkdir -p "$OUT"

failed=0
for entry in "${GOLDENS[@]}"; do
  name="${entry%%|*}"
  query="${entry#*|}"
  url="$BASE$query&now=$NOW"
  shot="$OUT/$name.png"
  if ! "$CAPTURE" shot "$url" "$shot" >/dev/null; then
    echo "  FAIL $name — capture failed ($url)"
    failed=1
    continue
  fi
  if [ "$MODE" = "update" ]; then
    echo "  shot $name -> $shot"
    continue
  fi
  golden="$GOLD/$name.png"
  if [ ! -s "$golden" ]; then
    echo "  FAIL $name — no golden at $golden (run: tools/goldens.sh update $PORT)"
    failed=1
  elif cmp -s "$golden" "$shot"; then
    echo "  ok   $name"
  else
    echo "  FAIL $name — differs from $golden (fresh shot: $shot)"
    failed=1
  fi
done

if [ "$MODE" = "check" ]; then
  if [ "$failed" -ne 0 ]; then
    echo "goldens: FAILED — fresh shots kept in $OUT"
    exit 1
  fi
  rm -rf "$OUT"
  echo "goldens: all ${#GOLDENS[@]} match"
fi
