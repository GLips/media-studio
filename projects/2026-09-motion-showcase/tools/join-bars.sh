#!/bin/sh
# The showcase's WIP cut: the nine bar renders (out/wip/bars/0N.mp4, from render-bars.ts) joined under the mastered
# mix, so the placed sounds play at the joins too. Checks every clip and the cut for their frame counts: a short clip
# shifts every later bar off its beat. Runs `studio mix`, which writes out/mix.wav.
#   sh projects/2026-09-motion-showcase/tools/join-bars.sh [out.mp4]
set -eu
P=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$P/out/wip/reel-cut.mp4}
LIST=$(mktemp)
frames() { ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of default=nw=1:nk=1 "$1"; }
for clip in 01:86 02:60 03:60 04:60 05:60 06:60 07:60 08:60 09:86; do
  n=${clip%%:*} want=${clip##*:}
  got=$(frames "$P/out/wip/bars/$n.mp4")
  [ "$got" = "$want" ] || { echo "bar $n: $got frames, expected $want" >&2; exit 1; }
  echo "file '$P/out/wip/bars/$n.mp4'" >> "$LIST"
done
studio mix "$P" > /dev/null
ffmpeg -y -v error -f concat -safe 0 -i "$LIST" -i "$P/out/mix.wav" -map 0:v -map 1:a -c:v libx264 -crf 16 -preset medium \
  -pix_fmt yuv420p -c:a aac -b:a 256k -af apad -t 19.7334 "$OUT"
[ "$(frames "$OUT")" = 592 ] || { echo "the cut has $(frames "$OUT") frames, expected 592" >&2; exit 1; }
echo "$OUT"
