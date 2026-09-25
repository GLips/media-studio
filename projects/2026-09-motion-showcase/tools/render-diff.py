# What changed between two renders of the showcase's bars, frame by frame, split into the HUD's rows and the picture
# between them: for a change meant to touch only the HUD (or only the picture), the other region must read 0.
#   python3 projects/2026-09-motion-showcase/tools/render-diff.py <before-dir> <after-dir> [bar ...]
# A pixel counts as changed when its luma moves more than STEP. Two renders of the same code aren't bit for bit alike:
# edges jitter a fraction of a pixel and the encoder follows, moving whole bars' mean luma by up to 0.6, but no pixel
# by a fifth of full contrast. Prints each bar's frames where a region's changed share passes 0.1‰, and the most.
# The bars' first frames are the current code's (tools/bar-clock.ts): compare renders of one bar table.
import json
import re
import subprocess
import sys
from pathlib import Path

before, after = sys.argv[1], sys.argv[2]
clock = json.loads(subprocess.run(['node', str(Path(__file__).with_name('bar-clock.ts'))], capture_output=True, text=True, check=True).stdout)
FROM = {f"{b['n']:02d}": b['from'] for b in clock['bars']}
bars = [f'{int(n):02d}' for n in sys.argv[3:]] or list(FROM)
# The HUD's rows (boxes y 61–97 and 983–1019) with their plates' margin and the lens's fringe to spare.
REGIONS = {'hud-top': 'crop=1920:80:0:40', 'hud-bottom': 'crop=1920:80:0:960', 'picture': 'crop=1920:840:0:120'}
STEP, SHOWN = 48, 0.1


def changed_per_mille(bar, crop):
    graph = f"[0:v][1:v]blend=all_mode=difference,{crop},format=gray,lut=y='gt(val,{STEP})*255',signalstats,metadata=print:file=-"
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{before}/{bar}.mp4', '-i', f'{after}/{bar}.mp4', '-filter_complex', graph, '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stdout
    return [float(m.group(1)) / 255 * 1000 for m in re.finditer(r'lavfi\.signalstats\.YAVG=([\d.e+-]+)', out)]


for bar in bars:
    per = {name: changed_per_mille(bar, crop) for name, crop in REGIONS.items()}
    changed = {name: [(FROM[bar] + i, d) for i, d in enumerate(ds) if d > SHOWN] for name, ds in per.items()}
    summary = '  '.join(f'{name}: {len(c)} frames (max {max((d for _, d in c), default=0):.1f}‰)' for name, c in changed.items())
    print(f'bar {bar}  {summary}')
    for name, c in changed.items():
        if c:
            print(f'  {name}: ' + ' '.join(f'{f}:{d:.1f}' for f, d in c[:40]) + (' …' if len(c) > 40 else ''))
