#!/bin/sh
# The showcase's integration pass: re-render the bars named (studio render --frames, into out/wip/bars/0N.mp4), join
# every bar render into the WIP cut under the mix (studio render --join, which refuses a bar rendered on another
# timeline), run every check on the cut, each into out/qa/<check>.txt, and print the flags to act on. Runs
# `studio mix`, so nothing else may be mixing.
#   sh projects/2026-09-motion-showcase/tools/integrate.sh [N ...]
set -eu
T=$(cd "$(dirname "$0")" && pwd)
P=$(dirname "$T")
D=$P/out/qa
CUT=$P/out/wip/reel-cut.mp4
mkdir -p "$D"
CLOCK=$(studio clock "$P")
for n in "$@"; do
  span=$(echo "$CLOCK" | jq -r --argjson n "$n" '.bars[] | select(.n == $n) | "\(.from):\(.to - 1)"')
  [ -n "$span" ] || { echo "no bar $n" >&2; exit 1; }
  studio render "$P" --frames="$span" --out="out/wip/bars/0$n.mp4"
done
studio render "$P" --join=out/wip/bars --out="$CUT" > "$D/join.txt"
studio mix --check "$P" > "$D/sound-check.txt"
node "$T/sfx-sync.ts" > "$D/sfx-sync.txt"
python3 "$T/attacks.py" "$P/out/mix.wav" > "$D/attacks.txt"
# Only the picture between the HUD's rows (boxes at y 61–97 and 983–1019): its timecode changes every frame.
studio look "$P" --video "$CUT" --motion --crop=0,120,1920,840 --out "$D/motion-frames.txt" > "$D/motion.txt"
node "$T/hud-legibility.ts" "$CUT" > "$D/hud.txt"

echo "cut: $CUT"
echo "bars cut in on the music's beats (1 is its downbeat): $(echo "$CLOCK" | jq -r '[.bars[].musicBeat] | join(" ")')"
# A flagged row starts with its sound's id (bar/role) or its frame; the legend lines name the flags too.
LOUD='^ *[a-z0-9-]+/[a-z0-9-]+ .*(FLAM|BURIED|OVER)' SYNC='^ *[0-9]+ .*(FLAM|SILENT)'
echo "sound: $(grep -cE "$LOUD" "$D/sound-check.txt" || true) flagged in sound-check (FLAM/BURIED/OVER)," \
  "$(grep -cE "$SYNC" "$D/sfx-sync.txt" || true) in sfx-sync (FLAM/SILENT)"
grep -E "$LOUD" "$D/sound-check.txt" || true
grep -E "$SYNC" "$D/sfx-sync.txt" || true
echo "attacks under 8 dB:"
awk 'NR > 1 && $4 < 8 { print "  " $0 }' "$D/attacks.txt"
sed -n '/still runs/,/^$/p' "$D/motion.txt"
echo "hud:"
tail -n +3 "$D/hud.txt"
