import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import { PAINT_BANDS } from '#lib/picture/paint/models/paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/picture/paint/models/paint-watercolour-pigments.ts';
import { stampLinearDynamics, type StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type PaintMaterial, type StampPaintMaterial } from './stamp-paint-recipe.ts';
import { compileStampPigmentPaint, STAMP_PIGMENT_GROUP_SLOTS, type StampPigmentMixing } from './stamp-pigment-paint.ts';

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
  const [sienna, blue] = [of('burntSienna'), of('ultramarine')];
  assert.equal(sienna.amounts[0], 0);
  assert.equal(blue.amounts[1], 0);
  assert.ok(sienna.amounts[1] > 0 && blue.amounts[0] > sienna.amounts[1], 'each end lays its own pigment, the weaker at its strength');
});
