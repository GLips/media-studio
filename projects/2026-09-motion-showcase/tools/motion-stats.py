# How much a cut moves, frame by frame, and where it breaks "always moving": each bar's mean frame difference (its
# energy), the runs of near-still frames, and every beat frame's luma. The HUD's bands are cropped off, since its
# timecode changes every frame and would count as motion.
#   python3 projects/2026-09-motion-showcase/tools/motion-stats.py <cut.mp4> [still-threshold, default 3.5]
import re
import subprocess
import sys

cut = sys.argv[1]
STILL = float(sys.argv[2]) if len(sys.argv) > 2 else 3.5
CROP = 'crop=1800:920:60:80'
BARS = [0, 86, 146, 206, 266, 326, 386, 446, 506, 592]
FADE = 584  # the final fade to black: stillness there is the ending


def yavg(vf):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', cut, '-vf', f'{vf},signalstats,metadata=print:file=-', '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stdout
    return [float(m.group(1)) for m in re.finditer(r'lavfi\.signalstats\.YAVG=([\d.e+-]+)', out)]


luma = yavg(CROP)
# tblend's frame k is the difference between frames k and k+1: credit it to k+1.
diff = [0.0] + yavg(f'{CROP},tblend=all_mode=difference')

print('bar  frames    mean diff  mean luma')
for i in range(9):
    a, b = BARS[i], BARS[i + 1]
    print(f'{i + 1:3d}  {a:3d}–{b - 1:3d}  {sum(diff[a + 1:b]) / (b - a - 1):9.1f}  {sum(luma[a:b]) / (b - a):9.1f}')

print(f'\nstill runs (7+ frames each under {STILL} from the one before, before the fade):')
run = []
for f in range(1, FADE):
    if diff[f] < STILL and f not in BARS:
        run.append(f)
        continue
    if len(run) >= 6:
        print(f'  {run[0] - 1}–{run[-1]}  ({len(run) + 1} frames, max diff {max(diff[j] for j in run):.1f})')
    run = []

print('\nbeat frames (26 + 15n): luma, diff')
print('  ' + '  '.join(f'{f}:{luma[f]:.0f}/{diff[f]:.1f}' for f in range(11, 582, 15)))
