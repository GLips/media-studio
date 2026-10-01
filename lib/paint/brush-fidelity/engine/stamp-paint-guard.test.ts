import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { PlacedStamp } from '#lib/paint/brush/models/stamp-placement.ts';
import { diffStampPaintingPrints, printStampPainting } from './stamp-paint-guard.ts';

const brush: StampBrush = {
  name: 'Guarded',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/wash.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({ size: { pressure: 0.5 }, opacity: { random: 0.3 }, rotation: { direction: 1, random: 0.5 } }),
  scatter: { count: 1, radius: 0.1, lateral: 0.2 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 0.4,
};

const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => {
  pass.stroke('s', { brush, material: { kind: 'color', color: '#000000' }, diameter: 40, path: [{ x: 0, y: 0 }, { x: 400, y: 60 }] });
}))));

/** `painting` with its one deposit's stamps passed through `edit`. */
function withStamps(edit: (stamps: PlacedStamp[]) => void): CompiledStampPaint {
  const [group] = painting.groups, [pass] = group.passes;
  if (pass.kind !== 'dry') throw new Error('the painting is one dry pass');
  const [deposit] = pass.deposits;
  const stamps = deposit.stamps.map((stamp) => ({ ...stamp }));
  edit(stamps);
  return { groups: [{ ...group, passes: [{ ...pass, deposits: [{ ...deposit, stamps }] }] }] };
}

const before = printStampPainting(painting);

test('two stamps swapping places, or one moving right as another moves left, are caught though their sums hold', () => {
  const swapped = printStampPainting(withStamps((stamps) => {
    [stamps[3].x, stamps[7].x] = [stamps[7].x, stamps[3].x];
  }));
  assert.deepEqual(diffStampPaintingPrints(before, swapped).map((line) => line.split(':')[0]), ['deposits[0].stamps.x[3]', 'deposits[0].stamps.x[7]']);
  const offset = printStampPainting(withStamps((stamps) => {
    stamps[2].y += 5;
    stamps[5].y -= 5;
  }));
  assert.equal(diffStampPaintingPrints(before, offset).length, 2);
});

test('numbers drifting by float order pass, though the hash moves', () => {
  const drifted = printStampPainting(withStamps((stamps) => {
    for (const stamp of stamps) stamp.x *= 1 + 1e-12;
  }));
  assert.notEqual(drifted.hash, before.hash);
  assert.deepEqual(diffStampPaintingPrints(before, drifted), []);
});
