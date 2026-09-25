# How hard each beat hits in the cut's mixed audio: the loudest 5 ms window of first-difference energy
# 15–75 ms after the frame, minus the median window over the 150 ms before it (dB). Pure Python (no numpy here).
#   python3 projects/2026-09-motion-showcase/tools/attacks.py <cut.mp4 or mix.wav> [frame ...]
# Frames default to every beat's (tools/bar-clock.ts). The median can't see a fill in the music that runs right up to
# the beat and stops on it: read that beat's 5 ms curve too.
import array, json, math, subprocess, sys
from pathlib import Path

cut = sys.argv[1]
frames = [int(f) for f in sys.argv[2:]] or json.loads(subprocess.run(
    ['node', str(Path(__file__).with_name('bar-clock.ts'))], capture_output=True, text=True, check=True).stdout)['beats']
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', cut, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
                     capture_output=True, check=True).stdout
x = array.array('f'); x.frombytes(raw)
WIN = 240  # 5 ms at 48 kHz
db, prev = [], 0.0
for i in range(len(x) // WIN):
    s = 0.0
    for v in x[i * WIN:(i + 1) * WIN]:
        s += (v - prev) ** 2; prev = v
    db.append(10 * math.log10(s / WIN + 1e-12))

def window(t0, t1):
    return db[int(t0 / 0.005):int(t1 / 0.005)]

print('frame  attack dB  floor dB  prominence dB')
for f in frames:
    t = f / 30
    peak = max(window(t + 0.015, t + 0.075))
    before = sorted(window(t - 0.150, t - 0.010))
    floor = before[len(before) // 2]
    print(f'{f:5d}  {peak:9.1f}  {floor:8.1f}  {peak - floor:13.1f}')
