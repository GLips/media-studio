import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeStrokeStamps, type StampPlacementBrush, type StampStrokePoint } from './stamp-placement.ts';

// A brush whose every diameter-read part is live: size jitter, scatter in stamps, count growth and falloff.
const brush = (stepping: 'spread' | 'eachStamp'): StampPlacementBrush => ({
  tip: { roundness: 1, sampling: 'isotropic' },
  spacing: 0.3,
  stepping,
  dynamics: { size: { random: { kind: 'linear', amount: 0.5 } } },
  scatter: { count: 3, radius: 0.4, lateral: 0.2, reachIn: 'stamp', countGrowth: { diameter: 40, exponent: 0.7 } },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0.05,
  flow: 1,
});

test('a stroke at scale 0.5 places its stamps as a stroke half its diameter does', () => {
  const path: StampStrokePoint[] = [{ x: 0, y: 0 }, { x: 140, y: 30 }, { x: 260, y: -20 }];
  for (const stepping of ['spread', 'eachStamp'] as const) {
    const halved = placeStrokeStamps(path.map((p) => ({ ...p, scale: 0.5 })), brush(stepping), 64, 'half');
    assert.deepEqual(halved, placeStrokeStamps(path, brush(stepping), 32, 'half'), stepping);
  }
});
