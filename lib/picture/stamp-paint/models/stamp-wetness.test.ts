import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA, type PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, stampPassDeposits, type CompiledStampPass, type StampWashOptions, type StampWashScope } from './stamp-paint-recipe.ts';
import { compileStampWetness, stampDrying, STAMP_WET_CELL, type StampWetness } from './stamp-wetness.ts';
import { stampGridAt } from './stamp-region.ts';

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
const watercolour = PAINT_MEDIA.watercolour;
const size = { width: 800, height: 400 };
const paper = { color: '#ffffff' } as const;
const rate = stampDrying(watercolour.wetting, paper).rate;
const drop = (at: { x: number; y: number }) => ({ kind: 'stamps' as const, brush, diameter: 60, at: [at] });
const sheet = { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 0, y: 400 }] };

/** One wash painted by `body`, its wetness in `medium`, and the wash's compiled pass. */
function washed(body: (wash: StampWashScope) => void, options: StampWashOptions = {}, medium: PaintMedium = watercolour) {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.wash('w', options, body))));
  const pass = painting.groups[0].passes[0];
  return { pass, wetness: compileStampWetness(painting, medium, paper, size) };
}
/** The landing of `pass`'s deposit `id`. */
const landing = (wetness: StampWetness, pass: CompiledStampPass, id: string) => wetness.landings.get(stampPassDeposits(pass).find((deposit) => deposit.id === `g/w/${id}`)!)!;

test('water raises wetness only where its footprint goes, and the paper it leaves covers the painting', () => {
  const { pass, wetness } = washed((wash) => {
    wash.water('drop', drop({ x: 200, y: 100 }));
    wash.stamps('far', { ...drop({ x: 600, y: 300 }), material: { kind: 'color', color: '#336699' } });
  });
  const { before, after } = landing(wetness, pass, 'drop');
  assert.equal(stampGridAt(before.wetness, 200, 100), 0);
  assert.equal(stampGridAt(after.wetness, 200, 100), 1);
  // Its window holds its footprint and a cell round it, not the painting.
  assert.ok(after.wetness.x0 <= 170 - STAMP_WET_CELL && after.wetness.x0 + (after.wetness.columns - 1) * STAMP_WET_CELL >= 230 + STAMP_WET_CELL);
  assert.ok(after.wetness.columns < 20);
  const far = landing(wetness, pass, 'far');
  assert.equal(stampGridAt(far.before.wetness, 600, 300), 0);
  assert.equal(far.water, watercolour.wetting.brushWater);
  const { end } = wetness.washes.get(pass)!;
  assert.deepEqual([end.wetness.x0, end.wetness.y0], [0, 0]);
  assert.ok((end.wetness.columns - 1) * STAMP_WET_CELL >= size.width && (end.wetness.rows - 1) * STAMP_WET_CELL >= size.height);
  assert.equal(stampGridAt(end.wetness, 200, 100), 1);
  assert.ok(Math.abs(stampGridAt(end.wetness, 600, 300) - watercolour.wetting.brushWater) < 1e-6);
  assert.equal(stampGridAt(end.wetness, 400, 200), 0);
  assert.equal(stampGridAt(end.wetness, 200, 300), 0);
});

test('paper dries in closed form: two waits are one wait as long, and a thirsty lift soaks water up', () => {
  const probe = (waits: number[]) => {
    const { pass, wetness } = washed((wash) => {
      wash.water('drop', drop({ x: 200, y: 100 }));
      for (const seconds of waits) wash.wait({ seconds });
      wash.lift('lift', { ...drop({ x: 200, y: 100 }), strength: 0.5 });
    });
    return landing(wetness, pass, 'lift');
  };
  const once = probe([60]), twice = probe([20, 40]);
  assert.equal(once.tau, 60);
  assert.deepEqual(twice.before, once.before);
  assert.ok(Math.abs(stampGridAt(once.before.wetness, 200, 100) - (1 - 60 * rate)) < 1e-6);
  assert.ok(Math.abs(stampGridAt(once.after.wetness, 200, 100) - (1 - 60 * rate) / 2) < 1e-6);
});

test("wait('damp') lasts until the wettest paper is damp, and wait('dry') until no paint is workable, open time included", () => {
  const { damp } = watercolour.wetting;
  const { pass, wetness } = washed((wash) => {
    wash.stamps('wet', { ...drop({ x: 600, y: 300 }), material: { kind: 'color', color: '#336699' }, water: 1 });
    wash.wait('damp');
    wash.water('damp', drop({ x: 100, y: 100 }));
    wash.wait('dry');
    wash.water('dry', drop({ x: 100, y: 100 }));
  }, { preparation: { region: sheet } });
  const atDamp = landing(wetness, pass, 'damp');
  assert.ok(Math.abs(atDamp.tau - (1 - damp) / rate) < 1e-6);
  assert.ok(Math.abs(stampGridAt(atDamp.before.wetness, 600, 300) - damp) < 1e-5);
  assert.ok(Math.abs(stampGridAt(atDamp.before.workable, 600, 300) - 1) < 1e-5);
  // The damp drop is 1 wet and dries last.
  assert.ok(Math.abs(landing(wetness, pass, 'dry').tau - (atDamp.tau + 1 / rate)) < 1e-6);
  const open: PaintMedium = { ...watercolour, wetting: { ...watercolour.wetting, openTime: 500 } };
  const slow = washed((wash) => {
    wash.water('wet', drop({ x: 100, y: 100 }));
    wash.wait({ seconds: 1 / rate });
    wash.water('dry', drop({ x: 130, y: 100 }));
    wash.wait('dry');
    wash.water('set', drop({ x: 600, y: 300 }));
  }, {}, open);
  const dried = landing(slow.wetness, slow.pass, 'dry');
  assert.equal(stampGridAt(dried.before.wetness, 100, 100), 0);
  assert.equal(stampGridAt(dried.before.workable, 100, 100), 1);
  assert.ok(Math.abs(landing(slow.wetness, slow.pass, 'set').tau - (1 / rate + 500 + 1 / rate)) < 1e-6);
});

test('paint that has dried stays dried when water wets it again, until fresh paint covers it', () => {
  const { pass, wetness } = washed((wash) => {
    wash.stamps('sky', { ...drop({ x: 100, y: 100 }), material: { kind: 'color', color: '#3355aa' } });
    wash.lift('blot', drop({ x: 100, y: 100 }));
    wash.wait('dry');
    wash.water('rewet', drop({ x: 100, y: 100 }));
    wash.lift('scrub', drop({ x: 100, y: 100 }));
    wash.stamps('again', { ...drop({ x: 100, y: 100 }), material: { kind: 'color', color: '#3355aa' } });
    wash.lift('fresh', drop({ x: 100, y: 100 }));
  });
  const at = (id: string) => landing(wetness, pass, id).before;
  assert.equal(stampGridAt(at('blot').dried, 100, 100), 0);
  assert.equal(stampGridAt(at('scrub').workable, 100, 100), 1);
  assert.equal(stampGridAt(at('scrub').dried, 100, 100), 1);
  assert.equal(stampGridAt(at('fresh').dried, 100, 100), 0);
});
