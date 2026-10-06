import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampMixedPainting, stampPassDeposits, type CompiledStampPass } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPassageOptions, StampPassageScope } from './stamp-paint-recipe-types.ts';
import { stampDrying, type StampWetness, stampPaintMedia } from './stamp-wetness.ts';
import { compileStampWetness } from './stamp-wash-waits.ts';
import { stampRoundTipsOf, stampRoundTipStatedProfile } from './stamp-tip-support.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };

const brush: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
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
brush.profile = stampRoundTipStatedProfile(brush);
const watercolour = PAINT_MEDIA.watercolour;
const paper = { color: '#ffffff' } as const;
const rate = stampDrying(watercolour.wetting, paper).rate;
const drop = (at: { x: number; y: number }) => ({ kind: 'stamps' as const, brush, size: 60, at: [at] });
const sheet = { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 0, y: 400 }] };

/** One wash painted by `body`, its wetness in `medium`, and the wash's compiled pass. */
function washed(body: (wash: StampPassageScope) => void, options: StampPassageOptions = {}, medium: PaintMedium = watercolour) {
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', options, body))));
  const pass = painting.groups[0].passes[0];
  return { pass, wetness: compileStampWetness(painting, stampPaintMedia(stampMixedPainting(painting), () => medium), stampRoundTipsOf()) };
}
/** The landing of `pass`'s deposit `id`. */
const landing = (wetness: StampWetness, pass: CompiledStampPass, id: string) => wetness.landings.get(stampPassDeposits(pass).find((deposit) => deposit.id === `g/w/${id}`)!)!;

test('waits last in closed form: two waits are one as long, and what a deposit finds is the water whose box meets its own', () => {
  const probe = (waits: number[]) => {
    const { pass, wetness } = washed((wash) => {
      wash.water('drop', drop({ x: 200, y: 100 }));
      for (const seconds of waits) wash.wait({ seconds });
      wash.lift('lift', { ...drop({ x: 200, y: 100 }), strength: 0.5 });
      wash.water('far', drop({ x: 600, y: 300 }));
    });
    return { lift: landing(wetness, pass, 'lift'), far: landing(wetness, pass, 'far') };
  };
  const once = probe([60]), twice = probe([20, 40]);
  assert.equal(once.lift.tau, 60);
  assert.deepEqual(twice.lift, once.lift);
  assert.deepEqual(once.lift.finds, { wet: true, workable: true });
  assert.deepEqual(once.far.finds, { wet: false, workable: false });
});

test("wait('damp') lasts until the wettest paper is damp, and wait('set') until no paint is workable, open time included", () => {
  const { damp } = watercolour.wetting.sheen;
  const { pass, wetness } = washed((wash) => {
    wash.stamps('wet', { ...drop({ x: 600, y: 300 }), well: { paint: { kind: 'color', color: '#336699' }, water: 1 } });
    wash.wait('damp');
    wash.water('damp', drop({ x: 100, y: 100 }));
    wash.wait('set');
    wash.water('dry', drop({ x: 100, y: 100 }));
  }, { preparation: { region: sheet } });
  const atDamp = landing(wetness, pass, 'damp');
  assert.ok(Math.abs(atDamp.tau - (1 - damp) / rate) < 1e-6);
  // The damp drop is 1 wet and dries last; what it lands on then has set.
  const dry = landing(wetness, pass, 'dry');
  assert.ok(Math.abs(dry.tau - (atDamp.tau + 1 / rate)) < 1e-6);
  assert.deepEqual(dry.finds, { wet: false, workable: false });
  const open: PaintMedium = { ...watercolour, wetting: { ...watercolour.wetting, openTime: 500 } };
  const slow = washed((wash) => {
    wash.water('wet', drop({ x: 100, y: 100 }));
    wash.wait({ seconds: 1 / rate });
    wash.water('dry', drop({ x: 130, y: 100 }));
    wash.wait('set');
    wash.water('set', drop({ x: 600, y: 300 }));
  }, {}, open);
  assert.deepEqual(landing(slow.wetness, slow.pass, 'dry').finds, { wet: false, workable: true });
  assert.ok(Math.abs(landing(slow.wetness, slow.pass, 'set').tau - (1 / rate + 500 + 1 / rate)) < 1e-6);
});

test("a dry brush's paint in a wash carries no water, and refuses water stated for it", () => {
  const crayon: StampBrush = { ...brush, media: 'dry' };
  const { pass, wetness } = washed((wash) => wash.stamps('drag', { ...drop({ x: 200, y: 100 }), brush: crayon, well: { paint: { kind: 'color', color: '#336699' } } }));
  assert.equal(landing(wetness, pass, 'drag').water, 0);
  assert.throws(() => washed((wash) => wash.stamps('drag', { ...drop({ x: 200, y: 100 }), brush: crayon, well: { paint: { kind: 'color', color: '#336699' }, water: 1 } })), /drag states water/);
});
