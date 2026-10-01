import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampMarkStamps, stampScatterMarks, type StampMark } from './stamp-marks.ts';
import type { StampMaterialSet } from './stamp-material-set.ts';
import { compileStampPaintRecipe, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPassageScope } from './stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { stampPolygonDistance, stampRegionPolygon, type StampRegion } from './stamp-region.ts';
import { compileStampWetness, stampDrying } from './stamp-wetness.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampCharge } from './stamp-wet-techniques.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };

const brush: StampBrush = {
  name: 'Round',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({ size: { random: 0.3 }, rotation: { random: 0.5 } }),
  scatter: { count: 2, radius: 0.2, lateral: 0.2 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 1,
};
const field: StampRegion = { kind: 'polygon', points: [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 300 }, { x: 100, y: 300 }] };
const color = (value: `#${string}`): PaintMaterial => ({ kind: 'color', color: value });
const wells: StampMaterialSet = { kind: 'set', entries: [{ id: 'blue', material: color('#2244aa'), weight: 2 }, { id: 'rose', material: color('#cc5577'), weight: 1 }, { id: 'none', material: color('#000000'), weight: 0 }] };

test('a scatter keeps its first marks where they were as it asks for more, inside its area and its weight', () => {
  const half = { kind: 'linear' as const, from: { x: 399, y: 0, value: 0 }, to: { x: 401, y: 0, value: 1 } };
  const scatter = (count: number) => stampScatterMarks({ kind: 'area', region: field, weight: half }, { count, length: [20, 40], diameter: [10, 20], key: 'sky' });
  const few = scatter(5), more = scatter(40);
  assert.deepEqual(more.slice(0, 5), few);
  const polygon = stampRegionPolygon(field);
  for (const mark of more) {
    assert.ok(stampPolygonDistance(polygon, mark.center.x, mark.center.y) > 0);
    // The weight is 0 left of x = 399: nothing lands there.
    assert.ok(mark.center.x > 399);
    assert.ok(mark.length >= 20 && mark.length <= 40 && mark.diameter >= 10 && mark.diameter <= 20);
  }
  assert.deepEqual(more.map((mark) => mark.key).slice(0, 2), ['sky-0', 'sky-1']);
  // Along a path, each runs the way the path does there, within its spread.
  const along = stampScatterMarks({ kind: 'along', path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], spread: 5 }, { count: 30, length: [5, 5], diameter: [4, 4], key: 'edge' });
  for (const { center, angle } of along) {
    const across = angle === 0 ? Math.abs(center.y) : Math.abs(center.x - 100);
    assert.ok([0, Math.PI / 2].includes(angle) && across <= 5);
  }
});

test('a deposit built from a mark is placed from the mark, whatever its ID, and a key names one mark', () => {
  const mark: StampMark = { key: 'leaf', brush, diameter: 30, geometry: { kind: 'stroke', path: [{ x: 50, y: 50 }, { x: 200, y: 80 }], hand: { profile: 'swell', wobble: { pressure: 0.1, position: 0.2 } } } };
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    group.passage('dry', { wetHistory: false }, (pass) => pass.mark('a', { mark, well: { paint: color('#336633') } }));
    group.passage('wet', {}, (wash) => wash.mark('b', { mark, well: { paint: color('#663333'), water: 0.6 } }));
  })));
  const [a, b] = painting.groups[0].passes.flatMap(stampPassDeposits);
  const placed = stampMarkStamps(mark, mark.key);
  for (const deposit of [a, b]) {
    assert.deepEqual(deposit.stamps, placed.stamps);
    assert.deepEqual(deposit.grainOffset, placed.grainOffset);
  }
  assert.equal(b.action.kind === 'paint' && b.action.water, 0.6);
  const twice = () => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', { wetHistory: false }, (pass) => {
    pass.mark('a', { mark, well: { paint: color('#336633') } });
    pass.mark('b', { mark: { ...mark }, well: { paint: color('#336633') } });
  }))));
  assert.throws(twice, /two marks share the key leaf/);
});

/** A charge into a wash over the sky, its painting compiled. */
const charged = (charge: (wash: StampPassageScope) => void) => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', {}, (wash) => {
  wash.fill('sky', { brush, size: 40, application: { kind: 'flood' }, region: field, well: { paint: color('#88aacc') }, reveal: { at: 0, over: 0 } });
  charge(wash);
}))));

test('a charge lays its touches as strokes in order, each loaded from its set by its own key, a new well moving none of them', () => {
  const settings = { placement: { kind: 'area', region: field } as const, touches: 12, brush, size: [20, 30] as const, length: [30, 60] as const, reveal: { at: 1, over: 1.2 } };
  const touches = (mixtures: StampMaterialSet) => stampPassDeposits(charged((wash) => stampCharge(wash, 'warm', { ...settings, well: { paint: mixtures } })).groups[0].passes[0]).slice(1);
  const laid = touches(wells);
  assert.deepEqual(laid.map(({ id }) => id), Array.from({ length: 12 }, (_, k) => `g/w/warm-${k}`));
  assert.deepEqual(laid.map(({ reveal }) => reveal!.at), Array.from({ length: 12 }, (_, k) => 1 + (1.2 * k) / 12));
  const colours = new Set(laid.map(({ action }) => (action.kind === 'paint' && action.material.kind === 'constant' && action.material.value.kind === 'color' ? action.material.value.color : null)));
  assert.ok(colours.has('#2244aa') && colours.has('#cc5577') && !colours.has('#000000'));
  const rewelled = touches({ kind: 'set', entries: [...wells.entries, { id: 'ochre', material: color('#cc9944'), weight: 1 }] });
  assert.deepEqual(rewelled.map(({ stamps }) => stamps), laid.map(({ stamps }) => stamps));
  assert.throws(() => touches({ kind: 'set', entries: [{ id: 'a', material: color('#000000'), weight: 0 }] }), /every entry weighs 0/);
});

test("a charge when damp waits for the paper under its touches, not for wetter paint elsewhere in the wash", () => {
  const painting = charged((wash) => {
    wash.stamps('puddle', { brush, size: 60, at: [{ x: 600, y: 200 }], well: { paint: color('#223366'), water: 1 }, reveal: { at: 0, over: 0 } });
    stampCharge(wash, 'cool', { placement: { kind: 'along', path: [{ x: 150, y: 200 }, { x: 300, y: 200 }], spread: 10 }, touches: 4, well: { paint: wells }, brush, size: [16, 16], length: [20, 30], when: 'damp', reveal: { at: 1, over: 0.5 } });
  });
  const [pass] = painting.groups[0].passes;
  const { wetting } = PAINT_MEDIA.watercolour, paper = { color: '#ffffff' } as const;
  const { waits: [local] } = compileStampWetness(painting, () => PAINT_MEDIA.watercolour, { width: 800, height: 400 }).washes.get(pass)!;
  assert.deepEqual(local.step, { kind: 'wait', until: 'damp', under: { deposits: ['g/w/cool-0', 'g/w/cool-1', 'g/w/cool-2', 'g/w/cool-3'] }, effect: { kind: 'charge', id: 'g/w/cool' } });
  // Until the sky's water under the touches is damp, not the puddle's, which is wetter.
  const { rate } = stampDrying(wetting, paper);
  assert.ok(Math.abs(local.to - local.from - (wetting.brushWater - wetting.sheen.damp) / rate) < 1e-6);
  assert.ok((1 - wetting.sheen.damp) / rate - (local.to - local.from) > 1);
});
