import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type StampWashScope } from './stamp-paint-recipe.ts';
import { compileStampWetness } from './stamp-wetness.ts';
import { stampGridAt } from './stamp-region.ts';
import { stampWashWettest } from './stamp-wet-rim.ts';

const brush: StampBrush = {
  name: 'Round',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({}),
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 1,
};

/** One wash painted by `body` in watercolour, its first pass and the wettest its paper got. */
function wettestOf(body: (wash: StampWashScope) => void) {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.wash('w', {}, body))));
  const pass = painting.groups[0].passes[0];
  return stampWashWettest(pass, compileStampWetness(painting, PAINT_MEDIA.watercolour, { color: '#ffffff' }, { width: 800, height: 400 }));
}

test('a puddle reads as wet as it was right up to its edge, and damp brushwork beside it as its own brush', () => {
  const grid = wettestOf((wash) => {
    wash.fill('puddle', { brush, diameter: 60, application: { kind: 'flood' }, region: { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 100 }, material: { kind: 'color', color: '#336699' }, water: 1 });
    wash.stroke('damp', { brush, diameter: 40, material: { kind: 'color', color: '#336699' }, water: 0.4, path: [{ x: 550, y: 200 }, { x: 700, y: 200 }] });
  });
  assert.ok(grid);
  // Just inside the puddle's edge, where a footprint averaged onto the lattice would read half as wet.
  assert.ok(stampGridAt(grid, 318, 200) > 0.95, `puddle edge ${stampGridAt(grid, 318, 200)}`);
  assert.ok(Math.abs(stampGridAt(grid, 640, 200) - 0.4) < 0.05, `damp stroke ${stampGridAt(grid, 640, 200)}`);
});

test('a wash that lands nothing has no wettest paper', () => {
  assert.equal(wettestOf((wash) => wash.wait('dry')), null);
});
