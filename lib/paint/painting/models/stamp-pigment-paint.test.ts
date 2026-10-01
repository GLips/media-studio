import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { PAINT_BANDS } from '#lib/paint/materials/models/paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintMaterial } from './stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { compileStampPigmentPaint, STAMP_PIGMENT_GROUP_SLOTS, stampGrainDepthIn, stampPigmentAmountsAt, type StampPigmentMixing } from './stamp-pigment-paint.ts';
import { placeStrokeStamps } from '#lib/paint/brush/models/stamp-placement.ts';

const brush: StampBrush = {
  name: 'Round', blend: 'normal', accumulation: { kind: 'buildToOpacity' },
  tip: { image: { style: 's', pack: 'p', file: 'tip.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25, stepping: 'eachStamp', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};

const washOf = (materials: StampPaintMaterial[]) => compileStampPaintRecipe(stampPaintRecipe((p) => p.group('wash', { composite: 'glaze', opacity: 1 }, (g) => g.pass('strokes', {}, (pass) => {
  materials.forEach((material, i) => pass.stamps(`s${i}`, { brush, material, diameter: 10, at: [{ x: 5, y: 5 }] }));
}))));

const watercolour: StampPigmentMixing = { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W };

test("a wash's palette holds each pigment once, whichever deposits lay it, and refuses one its style lacks or more than a wash holds", () => {
  const paint = compileStampPigmentPaint(washOf([
    { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 1 }], strength: 1 },
    { kind: 'color', color: '#C8305F' },
    { kind: 'mixture', parts: [{ pigment: W.burntSienna, amount: 1 }], strength: 0.5 },
    { kind: 'color', color: '#c8305f' },
  ]), watercolour, PAINT_BANDS);
  assert.deepEqual(paint.groups[0].palette.map(({ id }) => id), ['burntSienna', 'ultramarine', 'color:#c8305f']);
  const slots = [...paint.deposits.values()].map(({ components }) => components.map(({ slot }) => slot));
  assert.deepEqual(slots, [[0, 1], [2], [0], [2]]);

  const colours = Array.from({ length: STAMP_PIGMENT_GROUP_SLOTS + 1 }, (_, i): PaintMaterial => ({ kind: 'color', color: `#${(i * 16).toString(16).padStart(2, '0')}4080` }));
  assert.throws(() => compileStampPigmentPaint(washOf(colours), watercolour, PAINT_BANDS), /13 pigments, over the 12 a wash holds/);
  const sienna: PaintMaterial = { kind: 'mixture', parts: [{ pigment: W.burntSienna, amount: 1 }], strength: 1 };
  assert.throws(() => compileStampPigmentPaint(washOf([sienna]), { ...watercolour, pigments: { ultramarine: W.ultramarine } }, PAINT_BANDS), /burntSienna, which isn't among its style's pigments/);
});

test("a graded wash puts both ends' pigments in its palette and lays each at its amount per end, 0 where an end lacks it", () => {
  const ultramarine: PaintMaterial = { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 1 };
  const rose: PaintMaterial = { kind: 'mixture', parts: [{ pigment: W.burntSienna, amount: 1 }], strength: 0.5 };
  const paint = compileStampPigmentPaint(washOf([
    { kind: 'linear', from: { x: 0, y: 0, value: ultramarine }, to: { x: 0, y: 100, value: rose } },
  ]), watercolour, PAINT_BANDS);
  const palette = paint.groups[0].palette.map(({ id }) => id);
  assert.deepEqual(palette.toSorted(), ['burntSienna', 'ultramarine']);
  const [deposit] = paint.deposits.values();
  assert.deepEqual(deposit.grade, { kind: 1, geometry: [0, 0, 0, 100] });
  const of = (id: string) => deposit.components.find(({ slot }) => slot === palette.indexOf(id))!;
  const [sienna, blue] = [of('burntSienna'), of('ultramarine')].map((component) => stampPigmentAmountsAt(component, 0));
  assert.equal(sienna[0], 0);
  assert.equal(blue[1], 0);
  assert.ok(sienna[1] > 0 && blue[0] > sienna[1], 'each end lays its own pigment, the weaker at its strength');
});

const mixture = (ultramarine: number, sienna: number): PaintMaterial => ({
  kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: ultramarine }, { pigment: W.burntSienna, amount: sienna }].filter(({ amount }) => amount > 0), strength: 0.8,
});

test('a keyed material lays, between its keys, what a mixture of the eased amounts would, and its group says when it recolours', () => {
  const painting = washOf([{ kind: 'keys', keys: [{ at: 1, material: mixture(1, 0) }, { at: 3, material: mixture(0, 1) }] }]);
  assert.deepEqual(painting.groups[0].recolours, { from: 1, to: 3 });
  const paint = compileStampPigmentPaint(painting, watercolour, PAINT_BANDS);
  const [deposit] = paint.deposits.values();
  const laidAt = (t: number) => Object.fromEntries(deposit.components.map((c) => [paint.groups[0].palette[c.slot].id, stampPigmentAmountsAt(c, t)[0]]));
  const still = (material: PaintMaterial) => {
    const fixed = compileStampPigmentPaint(washOf([material]), watercolour, PAINT_BANDS);
    const [only] = fixed.deposits.values();
    return Object.fromEntries(only.components.map((c) => [fixed.groups[0].palette[c.slot].id, stampPigmentAmountsAt(c, 0)[0]]));
  };
  assert.deepEqual(laidAt(0), { ...still(mixture(1, 0)), burntSienna: 0 }, 'held before its first key');
  const between = laidAt(2), half = still(mixture(1, 1));
  for (const id of ['ultramarine', 'burntSienna']) assert.ok(Math.abs(between[id] - half[id]) < 1e-12, `${id} halfway is the even mixture's`);
  assert.deepEqual(laidAt(9), { ...still(mixture(0, 1)), ultramarine: 0 }, 'held after its last');
  assert.equal(washOf([mixture(1, 0)]).groups[0].recolours, undefined);
});

test("a medium on the paper's tooth sets aside a brush's grain depth by pressure, and only that", () => {
  const stick = {
    tip: { roundness: 1, sampling: 'isotropic' }, spacing: 0.5, stepping: 'spread', scatter: { count: 1, radius: 0, lateral: 0 },
    dynamics: { grainDepth: { pressure: { kind: 'linear', amount: 1 }, fade: { kind: 'linear', amount: 0.5, steps: 1 } } },
    rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
    taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
  } as const;
  // Past the first step, a half-pressure stroke's grain depth is half by pressure and half by fade.
  for (const stamp of placeStrokeStamps([{ x: 0, y: 0, pressure: 0.5 }, { x: 200, y: 0, pressure: 0.5 }], stick, 20, 'tooth').slice(1)) {
    assert.ok(Math.abs(stampGrainDepthIn(stamp, PAINT_MEDIA.crayon) - 0.5) < 1e-9);
    assert.ok(Math.abs(stampGrainDepthIn(stamp, PAINT_MEDIA.watercolour) - 0.25) < 1e-9);
    assert.ok(Math.abs(stampGrainDepthIn(stamp, null) - 0.25) < 1e-9);
  }
});

test('a group naming its own medium fits its palette in it, a pigment of one id two pigments in two media', () => {
  const blue: PaintMaterial = { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 0.5 };
  const gouache: StampPigmentMixing = { kind: 'pigment', medium: PAINT_MEDIA.gouache, pigments: W };
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => ['sky', 'wings', 'sea'].forEach((id) => p.group(id, { composite: 'glaze', opacity: 1, ...(id === 'wings' && { mixing: gouache }) }, (g) => g.pass('paint', {}, (pass) => {
    pass.stamps('dab', { brush, material: blue, diameter: 10, at: [{ x: 5, y: 5 }] });
  })))));
  const paint = compileStampPigmentPaint(painting, watercolour, PAINT_BANDS);
  assert.deepEqual(paint.media.map(({ name }) => name), ['watercolour', 'gouache']);
  assert.deepEqual(paint.groups.map(({ medium }) => medium), [0, 1, 0]);
  const [sky, wings, sea] = paint.groups.map(({ palette }) => palette);
  assert.equal(sky[0], sea[0], 'one medium, one pigment');
  assert.notDeepEqual(wings.map(({ id }) => id), sky.map(({ id }) => id), 'gouache lightens with white');
  assert.notDeepEqual(wings.find(({ id }) => id === 'ultramarine')!.S, sky[0].S, 'fitted as masstone in gouache');
  // A medium is one object: a copy under the same name beside it, however alike, is refused rather than merged.
  assert.throws(() => compileStampPigmentPaint(painting, { ...gouache, medium: { ...PAINT_MEDIA.gouache } }, PAINT_BANDS), /two media are named gouache/);
});
