import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampMaterialSet } from './stamp-material-set.ts';
import { compileStampPaintRecipe, stampCompiledPaintPrint, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPaintRecipe, StampPaintRecipeDeposit, StampPaintRecipePass, StampPaintRecipeStep } from './stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { StampRegion } from './stamp-region.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampBloom, stampCharge } from './stamp-wet-techniques.ts';

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
const wells: StampMaterialSet = { kind: 'set', entries: [{ id: 'blue', material: color('#2244aa'), weight: 1 }, { id: 'rose', material: color('#cc5577'), weight: 1 }] };

/** A sky washed, charged and bloomed under a ragged reserve, then a boiled pass of grass: every kind of seed a recipe draws. */
const sky = () => stampPaintRecipe(WET, (paint) => {
  paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => {
    group.mask('sun', { region: { kind: 'ellipse', x: 400, y: 150, radiusX: 40, radiusY: 40 }, edge: { ragged: { amount: 3, scale: 12 } } });
    group.passage('w', { preparation: { region: field } }, (wash) => {
      wash.fill('body', { brush, size: 40, application: { kind: 'flood' }, region: field, well: { paint: color('#88aacc') }, reveal: { at: 0, over: 1 } });
      stampCharge(wash, 'warm', { placement: { kind: 'area', region: field }, touches: 3, well: { paint: wells }, brush, size: [16, 24], length: [20, 40], when: 'damp', reveal: { at: 1, over: 1 } });
      stampBloom(wash, 'drop', { brush, size: 20, at: [{ x: 300, y: 200 }], reveal: { at: 2, over: 0 } });
      wash.wait('set');
    });
  });
  paint.group('grass', { composite: 'opaque', boil: { every: 2 } }, (group) => group.passage('blades', { wetHistory: false }, (pass) => {
    pass.stroke('blade', { brush, size: 8, well: { paint: color('#446633') }, path: [{ x: 100, y: 380 }, { x: 120, y: 330 }], hand: { profile: 'swell', wobble: { pressure: 0.1, position: 0.2 } } });
  }));
});

/** `recipe` with each deposit written anew by `rewrite`, its fluid and waits as they were. */
function rewritten(recipe: StampPaintRecipe, rewrite: (deposit: StampPaintRecipeDeposit) => StampPaintRecipeDeposit): StampPaintRecipe {
  // SAFETY: rewrite keeps a deposit's action, the only part a dry pass narrows.
  const step = <S extends StampPaintRecipeStep>(written: S): S => (written.kind === 'deposit' ? (rewrite(written) as S) : written);
  const pass = <P extends StampPaintRecipePass>(written: P): P => ({ ...written, steps: written.steps.map(step) });
  return {
    ...recipe,
    groups: recipe.groups.map((group) => ({ ...group, passes: group.passes.map(pass) })),
  };
}

const print = (recipe: StampPaintRecipe) => stampCompiledPaintPrint(compileStampPaintRecipe(recipe));

test('provenance never seeds: the same recipe written under applications compiles to the same painting, draw for draw', () => {
  const written = sky();
  assert.equal(print(rewritten(written, (deposit) => ({ ...deposit, provenance: ['sky', 'corners'] }))), print(written));
  // Not a print blind to its deposits: a name is what seeds them.
  const renamed = rewritten(written, (deposit) => (deposit.name.id === 'body' ? { ...deposit, name: { ...deposit.name, id: 'body2' } } : deposit));
  assert.notEqual(print(renamed), print(written));
});

test("a generated child's keys are segments of its name: each refused holding a separator, and an authored ID spelling one collides with it", () => {
  const [washed] = compileStampPaintRecipe(sky()).groups[0].passes;
  assert.deepEqual(stampPassDeposits(washed).map(({ id }) => id), ['sky/w/body', 'sky/w/warm-0', 'sky/w/warm-1', 'sky/w/warm-2', 'sky/w/drop']);
  const slashed = rewritten(sky(), (deposit) => (deposit.name.keys.length ? { ...deposit, name: { ...deposit.name, keys: ['0/1'] } } : deposit));
  assert.throws(() => compileStampPaintRecipe(slashed), /"0\/1" isn't an ID/);
  const spelt = stampPaintRecipe(WET, (paint) => paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', {}, (wash) => {
    stampCharge(wash, 'warm', { placement: { kind: 'area', region: field }, touches: 2, well: { paint: wells }, brush, size: [16, 24], length: [20, 40], reveal: { at: 0, over: 1 } });
    wash.stroke('warm-1', { brush, size: 10, well: { paint: color('#336633') }, path: [{ x: 100, y: 100 }, { x: 200, y: 120 }] });
  })));
  assert.throws(() => compileStampPaintRecipe(spelt), /IDs used twice.*sky\/w\/warm-1/);
});
