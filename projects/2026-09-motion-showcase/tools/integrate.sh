#!/bin/sh
# The showcase's integration pass, once the bar renders in out/wip/bars/ are current (render-bars.ts): join them into
# the WIP cut under the mix, run every check on it, each into out/qa/<check>.txt, and print the flags to act on. Runs
# `studio mix`, so nothing else may be mixing.
#   sh projects/2026-09-motion-showcase/tools/integrate.sh
set -eu
T=$(cd "$(dirname "$0")" && pwd)
P=$(dirname "$T")
D=$P/out/qa
CUT=$P/out/wip/reel-cut.mp4
mkdir -p "$D"
sh "$T/join-bars.sh" "$CUT" > "$D/join.txt"
studio mix --check "$P" > "$D/sound-check.txt"
node "$T/sfx-sync.ts" > "$D/sfx-sync.txt"
python3 "$T/attacks.py" "$P/out/mix.wav" > "$D/attacks.txt"
python3 "$T/motion-stats.py" "$CUT" > "$D/motion.txt"
node "$T/hud-legibility.ts" "$CUT" > "$D/hud.txt"

echo "cut: $CUT"
echo "bars cut in on the music's beats (1 is its downbeat): $(node "$T/bar-clock.ts" | jq -r '[.bars[].musicBeat] | join(" ")')"
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
