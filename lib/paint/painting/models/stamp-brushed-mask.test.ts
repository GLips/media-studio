import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampMarkStamps, type StampMark } from './stamp-marks.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampDeposit, type CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';
import { stampPaintingBrushedMasks } from './stamp-brushed-mask.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };
const brush: StampBrush = {
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  grain: { kind: 'canvas', image: { style: 'wash', pack: 'vvds', file: 'grain.png' }, scale: 0.5, depth: 0.8, brightness: 0, contrast: 0, contrastPivot: 'midGrey', tiling: 'repeat', offsetJitter: 1, blend: { family: 'texture', mode: 'multiply' } },
  spacing: 0.1, stepping: 'spread', dynamics: stampLinearDynamics({ size: { random: 0.3 } }), scatter: { count: 2, radius: 0.2, lateral: 0.2 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
  profile: STAMP_BRUSH_UNMEASURED,
};
const mark = (key: string, x: number): StampMark => ({ key, brush, diameter: 20, geometry: { kind: 'stroke', path: [{ x, y: 40 }, { x: x + 60, y: 50 }], hand: { profile: 'swell', wobble: { pressure: 0.1, position: 0.2 } } } });
const paint = { paint: { kind: 'color', color: '#336633' } } as const;

/** The brushed masks a deposit lands under, latest first. */
const brushedOver = (deposit: CompiledStampDeposit) => {
  const found = [];
  for (let op: CompiledStampMask | null = deposit.mask; op; op = op.under) if (op.kind === 'brushed') found.push(op.brushed);
  return found;
};

test('brushed fluid is placed from its mark, as paint built from the same mark is', () => {
  const fluid = mark('fluid', 20);
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => {
    g.mask('fluid', { marks: [fluid] });
    g.passage('dry', { wetHistory: false }, (pass) => pass.stroke('over', { brush, size: 30, well: paint, path: [{ x: 0, y: 45 }, { x: 120, y: 45 }] }));
  })));
  const [deposit] = painting.groups[0].passes.flatMap(stampPassDeposits);
  const [masked] = brushedOver(deposit), placed = stampMarkStamps(fluid, fluid.key);
  assert.equal(masked.id, 'g/fluid');
  assert.equal(masked.resist, null);
  assert.deepEqual(masked.marks[0].stamps, placed.stamps);
  assert.deepEqual(masked.marks[0].dualStamps, placed.dualStamps);
  assert.deepEqual(masked.marks[0].grainOffset, placed.grainOffset);
  assert.deepEqual(stampPaintingBrushedMasks(painting), [masked]);
});

test('wax holds through its group, past an unmask and out of a passage, but not into the next group, and a knockout ignores it', () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (p) => {
    p.group('g', { composite: 'glaze', opacity: 1 }, (g) => {
      g.knockout('lights', {}, (k) => k.water('wet', { kind: 'stamps', brush, size: 30, at: [{ x: 50, y: 50 }] }));
      g.passage('a', { wetHistory: false }, (pass) => pass.stroke('early', { brush, size: 30, well: paint, path: [{ x: 0, y: 45 }, { x: 120, y: 45 }] }));
      g.resist('wax', { marks: [mark('wax', 20)], amount: 0.5 });
      g.unmask('all', {});
      g.passage('b', { wetHistory: false }, (pass) => pass.stroke('late', { brush, size: 30, well: paint, path: [{ x: 0, y: 45 }, { x: 120, y: 45 }] }));
      g.passage('c', { wetHistory: false }, (pass) => pass.stroke('later', { brush, size: 30, well: paint, path: [{ x: 0, y: 45 }, { x: 120, y: 45 }] }));
    });
    p.group('h', { composite: 'glaze', opacity: 1 }, (h) => h.passage('d', { wetHistory: false }, (pass) => pass.stroke('next', { brush, size: 30, well: paint, path: [{ x: 0, y: 45 }, { x: 120, y: 45 }] })));
  }));
  const [knocked, early, late, later] = painting.groups[0].passes.flatMap(stampPassDeposits), [next] = painting.groups[1].passes.flatMap(stampPassDeposits);
  assert.deepEqual([knocked, early, next].map((deposit) => brushedOver(deposit).length), [0, 0, 0]);
  const [wax] = brushedOver(late);
  assert.equal(wax.id, 'g/wax');
  assert.deepEqual(wax.resist, { amount: 0.5 });
  // Deposits under the same fluid and wax share one state of it, which the renderer works out once.
  assert.equal(later.mask, late.mask);
  assert.throws(() => compileStampPaintRecipe(stampPaintRecipe(WET, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => g.resist('wax', { marks: [mark('wax', 20)], amount: 2 })))), /resists 2 of the paint/);
});
