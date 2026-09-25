#!/bin/sh
# The showcase's WIP cut: the nine bar renders (out/wip/bars/0N.mp4, from render-bars.ts) joined under the mastered
# mix, so the placed sounds play at the joins too. Checks every clip and the cut for their frame counts: a short clip
# shifts every later bar off its beat. The frames are tools/bar-clock.ts's. Runs `studio mix`, which writes out/mix.wav.
#   sh projects/2026-09-motion-showcase/tools/join-bars.sh [out.mp4]
set -eu
P=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$P/out/wip/reel-cut.mp4}
LIST=$(mktemp)
frames() { ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of default=nw=1:nk=1 "$1"; }
CLOCK=$(node "$P/tools/bar-clock.ts")
for clip in $(echo "$CLOCK" | jq -r '.bars[] | "0\(.n):\(.to - .from)"'); do
  n=${clip%%:*} want=${clip##*:}
  got=$(frames "$P/out/wip/bars/$n.mp4")
  [ "$got" = "$want" ] || { echo "bar $n: $got frames, expected $want" >&2; exit 1; }
  echo "file '$P/out/wip/bars/$n.mp4'" >> "$LIST"
done
END=$(echo "$CLOCK" | jq .end)
studio mix "$P" > /dev/null
ffmpeg -y -v error -f concat -safe 0 -i "$LIST" -i "$P/out/mix.wav" -map 0:v -map 1:a -c:v libx264 -crf 16 -preset medium \
  -pix_fmt yuv420p -c:a aac -b:a 256k -af apad -t "$(echo "$CLOCK" | jq '(.end + 0.5) / .fps')" "$OUT"
[ "$(frames "$OUT")" = "$END" ] || { echo "the cut has $(frames "$OUT") frames, expected $END" >&2; exit 1; }
echo "$OUT"
