import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampAreaCoverageAt, type StampWithin } from './stamp-area.ts';
import { stampRegionSeed } from './stamp-fill.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPaintScope } from './stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { stampGridAt, type StampRegion } from './stamp-region.ts';
import { compileStampWetness, stampWetGrid } from './stamp-wetness.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };

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
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    group.passage('p', { within: { region: square(0, 0, 100, 100), edge: { ragged: { amount: 3, scale: 10 } } }, wetHistory: false }, (pass) => pass.stamps('dot', { brush, well: { paint: ochre }, size: 10, at: [{ x: 50, y: 50 }] }));
    group.mask('reserve', { region: square(0, 0, 100, 100), inset: 6, edge: { soft: 4 } });
    group.passage('q', { wetHistory: false }, (pass) => pass.stamps('dot', { brush, well: { paint: ochre }, size: 10, at: [{ x: 50, y: 50 }] }));
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
  assert.throws(() => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.mask('m', { region: square(0, 0, 10, 10), inset: -1 }))), /m is inset -1 px/);
});

/** A far range on wet paper, then a near hill standing before it: the far's fluid opened by an unmask before it paints. */
const range = (paint: StampPaintScope, standsBefore = ['far']) => {
  paint.group('far', { composite: 'glaze', opacity: 1, depth: 2 }, (group) => group.passage('w', { preparation: { region: square(0, 0, 200, 120) } }, (wash) => {
    wash.mask('glint', { region: square(10, 10, 20, 20) });
    wash.unmask('open', {});
    wash.fill('sky', { brush, well: { paint: ochre, water: 1 }, size: 30, application: { kind: 'flood' }, region: square(0, 0, 200, 120) });
  }));
  paint.group('near', { composite: 'glaze', opacity: 1, standsBefore: { groups: standsBefore, shape: square(60, 40, 140, 120), overlap: 3 } }, (group) => group.passage('p', { wetHistory: false }, (pass) => {
    pass.fill('hill', { brush, well: { paint: ochre }, size: 20, application: { kind: 'flood' }, region: square(60, 40, 140, 120) });
  }));
};

test("a group standing before earlier groups reserves its shape from them, inset by its overlap, past any unmask of theirs, and their water doesn't land there", () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => range(paint)));
  const [far, near] = painting.groups;
  const sky = stampPassDeposits(far.passes[0])[0], hill = stampPassDeposits(near.passes[0])[0];
  assert.deepEqual(ids(sky.mask), ['far/w/glint', 'far/w/open', 'near/stands-before']);
  assert.ok(sky.mask?.kind === 'mask' && sky.mask.area.inset === 3);
  assert.deepEqual(ids(hill.mask), []);

  const wetness = compileStampWetness(painting, () => PAINT_MEDIA.watercolour, { width: 200, height: 120 });
  const wet = stampWetGrid(wetness.landings.get(sky)!.after, 'wetness');
  assert.equal(stampGridAt(wet, 100, 88), 0);
  assert.equal(stampGridAt(wet, 24, 88), 1);
});

test('a group stands only before groups that exist, other than itself, painted before it', () => {
  const compile = (standsBefore: string[]) => () => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => range(paint, standsBefore)));
  assert.throws(compile(['hills']), /near stands before "hills", which isn't a group/);
  assert.throws(compile(['near']), /near stands before itself/);
  assert.throws(() => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => {
    range(paint, []);
    paint.group('later', { composite: 'glaze', opacity: 1, depth: -1 }, () => {});
    paint.group('front', { composite: 'glaze', opacity: 1, standsBefore: { groups: ['later'], shape: square(0, 0, 10, 10), overlap: 0 } }, () => {});
  })), /front stands before later, which paints after it/);
});

/** A passage within the square 0..100 whose left side is treated by `boundaries`, compiled, its within read back. */
const treatedWithin = (boundaries: NonNullable<StampWithin['boundaries']>, environment = WET) => {
  const painting = compileStampPaintRecipe(stampPaintRecipe(environment, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) =>
    group.passage('p', { within: { region: square(0, 0, 100, 100), boundaries } }, (pass) => pass.stamps('dot', { brush, well: { paint: ochre }, size: 10, at: [{ x: 50, y: 50 }] })))));
  return painting.groups[0].passes[0].within!;
};

test("a within's merged stretch opens its edge by its reach and a feathered one ramps inside it, each fading past its ends, the kept edge as it was", () => {
  const within = treatedWithin({
    top: { path: [{ x: 0, y: 0 }, { x: 0, y: 50 }], treatment: 'merge', reach: 10 },
    foot: { path: [{ x: 0, y: 50 }, { x: 0, y: 100 }], treatment: 'feather', reach: 12 },
    rest: { path: [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 0 }], treatment: 'keep' },
  });
  // Merged: paint reaches 9 px past the side, halfway at its reach; nothing past it.
  assert.equal(stampAreaCoverageAt(within, -4, 25), 1);
  assert.ok(Math.abs(stampAreaCoverageAt(within, -10, 25) - 0.5) < 1e-9);
  assert.equal(stampAreaCoverageAt(within, -11, 25), 0);
  // Feathered: none at the side, half 6 px in, full from 12 px.
  assert.equal(stampAreaCoverageAt(within, 0, 80), 0);
  assert.ok(Math.abs(stampAreaCoverageAt(within, 6, 80) - 0.5) < 1e-9);
  assert.equal(stampAreaCoverageAt(within, 12, 80), 1);
  // The kept top and right sides cut as an untreated within does: half on the line.
  assert.ok(Math.abs(stampAreaCoverageAt(within, 50, 0) - 0.5) < 1e-9);
  // Along the kept top side, 3 px above it, the merge at its corner fades out over its reach rather than stepping.
  const fading = [0, 3, 6, 9, 12].map((x) => stampAreaCoverageAt(within, x, -3));
  assert.ok(fading.every((c, i) => i === 0 || c <= fading[i - 1]));
  assert.deepEqual([fading[0], fading[3] > 0 && fading[3] < 1, fading[4] < 0.01], [1, true, true]);
});

test('stretches meet at points: overlapping ones treated differently, a point off the outline and a merge without wet history are refused', () => {
  const side = [{ x: 0, y: 0 }, { x: 0, y: 60 }];
  assert.throws(() => treatedWithin({ a: { path: side, treatment: 'merge', reach: 8 }, b: { path: [{ x: 0, y: 40 }, { x: 0, y: 100 }], treatment: 'keep' } }), /boundaries a \(merge\) and b \(keep\) run along the same stretch/);
  assert.throws(() => treatedWithin({ a: { path: [{ x: 0, y: 0 }, { x: 8, y: 60 }], treatment: 'keep' } }), /point at 8, 60 off its area's outline/);
  assert.throws(() => treatedWithin({ a: { path: side, treatment: 'feather' } }), /a feather, which needs a positive reach/);
  const DRY: StampPaintEnvironment = { ...WET, mixing: { kind: 'pigment', medium: PAINT_MEDIA.crayon, pigments: WATERCOLOUR_PIGMENTS } };
  assert.throws(() => treatedWithin({ a: { path: side, treatment: 'merge', reach: 8 } }, DRY), /merged boundary a/);
  // A feather needs no wet history: it's coverage alone.
  assert.equal(treatedWithin({ a: { path: side, treatment: 'feather', reach: 8 } }, DRY).boundaries?.length, 1);
});
