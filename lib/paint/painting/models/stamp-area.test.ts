import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampAreaCoverageAt } from './stamp-area.ts';
import { stampRegionSeed } from './stamp-fill.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintScope } from './stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { stampGridAt, type StampRegion } from './stamp-region.ts';
import { compileStampWetness, stampWetGrid } from './stamp-wetness.ts';

const brush: StampBrush = {
  name: 'Round', blend: 'normal', media: 'wet',
  accumulation: { kind: 'buildToOpacity' },
  tip: { image: { style: 'test', pack: 'test', file: 'round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'eachStamp', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 0.5,
};
const ochre: PaintMaterial = { kind: 'color', color: '#c8902f' };
const square = (x0: number, y0: number, x1: number, y1: number): StampRegion => ({ kind: 'polygon', points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
const ids = (mask: CompiledStampMask | null): string[] => (mask ? [...ids(mask.under), mask.id] : []);

test("an area's inset moves its edge inward by its distance, and a pass's ragged within is seeded by the pass's ID", () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    group.pass('p', { within: { region: square(0, 0, 100, 100), edge: { ragged: { amount: 3, scale: 10 } } } }, (pass) => pass.stamps('dot', { brush, material: ochre, diameter: 10, at: [{ x: 50, y: 50 }] }));
    group.mask('reserve', { region: square(0, 0, 100, 100), inset: 6, edge: { soft: 4 } });
    group.pass('q', {}, (pass) => pass.stamps('dot', { brush, material: ochre, diameter: 10, at: [{ x: 50, y: 50 }] }));
  })));
  const [p, q] = painting.groups[0].passes;
  assert.equal(p.within?.seed, stampRegionSeed('g/p'));
  const reserve = stampPassDeposits(q)[0].mask!;
  assert.equal(reserve.kind, 'mask');
  if (reserve.kind !== 'mask') return;
  // Halfway across its soft edge 6 px in from the square's side; none at the side; whole past the edge.
  assert.ok(Math.abs(stampAreaCoverageAt(reserve.area, 6, 50) - 0.5) < 1e-9);
  assert.equal(stampAreaCoverageAt(reserve.area, 0.5, 50), 0);
  assert.equal(stampAreaCoverageAt(reserve.area, 9, 50), 1);
  assert.throws(() => compileStampPaintRecipe(stampPaintRecipe((paint) => paint.mask('m', { region: square(0, 0, 10, 10), inset: -1 }))), /m is inset -1 px/);
});

/** A far range on wet paper, then a near hill standing before it: the far's fluid opened by an unmask before it paints. */
const range = (paint: StampPaintScope, standsBefore = ['far']) => {
  paint.group('far', { composite: 'glaze', opacity: 1, depth: 2 }, (group) => group.wash('w', { preparation: { region: square(0, 0, 200, 120) } }, (wash) => {
    wash.mask('glint', { region: square(10, 10, 20, 20) });
    wash.unmask('open', {});
    wash.fill('sky', { brush, material: ochre, diameter: 30, application: { kind: 'flood' }, region: square(0, 0, 200, 120), water: 1 });
  }));
  paint.group('near', { composite: 'glaze', opacity: 1, standsBefore: { groups: standsBefore, shape: square(60, 40, 140, 120), overlap: 3 } }, (group) => group.pass('p', {}, (pass) => {
    pass.fill('hill', { brush, material: ochre, diameter: 20, application: { kind: 'flood' }, region: square(60, 40, 140, 120) });
  }));
};

test("a group standing before earlier groups reserves its shape from them, inset by its overlap, past any unmask of theirs, and their water doesn't land there", () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => range(paint)));
  const [far, near] = painting.groups;
  const sky = stampPassDeposits(far.passes[0])[0], hill = stampPassDeposits(near.passes[0])[0];
  assert.deepEqual(ids(sky.mask), ['far/w/glint', 'far/w/open', 'near/stands-before']);
  assert.ok(sky.mask?.kind === 'mask' && sky.mask.area.inset === 3);
  assert.deepEqual(ids(hill.mask), []);

  const wetness = compileStampWetness(painting, () => PAINT_MEDIA.watercolour, { color: '#ffffff' }, { width: 200, height: 120 });
  const wet = stampWetGrid(wetness.landings.get(sky)!.after, 'wetness');
  assert.equal(stampGridAt(wet, 100, 88), 0);
  assert.equal(stampGridAt(wet, 24, 88), 1);
});

test('a group stands only before groups that exist, other than itself, painted before it', () => {
  const compile = (standsBefore: string[]) => () => compileStampPaintRecipe(stampPaintRecipe((paint) => range(paint, standsBefore)));
  assert.throws(compile(['hills']), /near stands before "hills", which isn't a group/);
  assert.throws(compile(['near']), /near stands before itself/);
  assert.throws(() => compileStampPaintRecipe(stampPaintRecipe((paint) => {
    range(paint, []);
    paint.group('later', { composite: 'glaze', opacity: 1, depth: -1 }, () => {});
    paint.group('front', { composite: 'glaze', opacity: 1, standsBefore: { groups: ['later'], shape: square(0, 0, 10, 10), overlap: 0 } }, () => {});
  })), /front stands before later, which paints after it/);
});
