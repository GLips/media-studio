# How much a cut moves, frame by frame, and where it breaks "always moving": each bar's mean frame difference (its
# energy), the runs of near-still frames, and every beat frame's luma. Only the picture between the HUD's rows counts,
# since its timecode changes every frame and would count as motion. Bars and beats are tools/bar-clock.ts's.
#   python3 projects/2026-09-motion-showcase/tools/motion-stats.py <cut.mp4 | 0N.mp4> [still-threshold, default 3.5]
# A render-bars.ts file (0N.mp4) is bar N alone: its first frame is the bar's, and frames print as the video's.
import json
import re
import subprocess
import sys
from pathlib import Path

cut = sys.argv[1]
STILL = float(sys.argv[2]) if len(sys.argv) > 2 else 3.5
# The HUD's rows are boxes at y 61–97 and 983–1019; render-diff.py's picture region, with the plates' margin to spare.
CROP = 'crop=1920:840:0:120'
clock = json.loads(subprocess.run(['node', str(Path(__file__).with_name('bar-clock.ts'))], capture_output=True, text=True, check=True).stdout)
bar_file = re.fullmatch(r'0(\d)\.mp4', Path(cut).name)
bars = [clock['bars'][int(bar_file.group(1)) - 1]] if bar_file else clock['bars']
FIRST, END = bars[0]['from'], bars[-1]['to']
CUTS = {b['from'] for b in bars}
FADE = clock['fade']['from']  # the final fade to black: stillness there is the ending


def yavg(vf):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', cut, '-vf', f'{vf},signalstats,metadata=print:file=-', '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stdout
    return [float(m.group(1)) for m in re.finditer(r'lavfi\.signalstats\.YAVG=([\d.e+-]+)', out)]


# Both indexed by the video's frame. tblend's frame k is the difference between frames k and k+1: credit it to k+1.
luma = dict(enumerate(yavg(CROP), FIRST))
diff = dict(enumerate([0.0] + yavg(f'{CROP},tblend=all_mode=difference'), FIRST))
if len(luma) != END - FIRST:
    sys.exit(f'{cut} has {len(luma)} frames, but bars {bars[0]["n"]}–{bars[-1]["n"]} are {END - FIRST}: re-render it on the current clock')

print('bar  frames    mean diff  mean luma')
for b in bars:
    a, z = b['from'], b['to']
    print(f'{b["n"]:3d}  {a:3d}–{z - 1:3d}  {sum(diff[f] for f in range(a + 1, z)) / (z - a - 1):9.1f}  {sum(luma[f] for f in range(a, z)) / (z - a):9.1f}')

print(f'\nstill runs (7+ frames each under {STILL} from the one before, before the fade):')
run = []
for f in range(FIRST + 1, min(END, FADE) + 1):
    if f < min(END, FADE) and diff[f] < STILL and f not in CUTS:
        run.append(f)
        continue
    if len(run) >= 6:
        print(f'  {run[0] - 1}–{run[-1]}  ({len(run) + 1} frames, max diff {max(diff[j] for j in run):.1f})')
    run = []

print('\nbeat frames: luma, diff')
print('  ' + '  '.join(f'{f}:{luma[f]:.0f}/{diff[f]:.1f}' for f in clock['beats'] if FIRST <= f < min(END, FADE)))
