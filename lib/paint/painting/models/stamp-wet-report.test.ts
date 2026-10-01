import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampWashScope } from './stamp-paint-recipe-types.ts';
import { assertStampWetEffects, stampWetReport, stampWetReportWarnings } from './stamp-wet-report.ts';
import { compileStampWetness } from './stamp-wetness.ts';

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
const medium = PAINT_MEDIA.watercolour;
const sky = { kind: 'polygon' as const, points: [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 360 }, { x: 40, y: 360 }] };

/** The wet report of one wash over a sky, painted by `body`. */
function reported(body: (wash: StampWashScope) => void) {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.wash('w', {}, (wash) => {
    wash.fill('sky', { brush, diameter: 40, application: { kind: 'flood' }, region: sky, material: { kind: 'color', color: '#4466aa' }, appliedAt: 0 });
    body(wash);
  }))));
  return stampWetReport(painting, compileStampWetness(painting, medium, { color: '#ffffff' }, { width: 800, height: 400 }), medium);
}

test('a bloom into damp paint and a backrun along a junction act; the report gives their waits and the drying', () => {
  const report = reported((wash) => {
    wash.bloom('drop', { brush, diameter: 50, at: [{ x: 300, y: 200 }], appliedAt: 1 });
    wash.backrun('edge', { along: [{ x: 500, y: 100 }, { x: 600, y: 300 }], brush, diameter: 24, appliedAt: 1.2 });
  });
  const [wash] = report.washes;
  assert.deepEqual(wash.effects.map(({ kind, id, acting }) => [kind, id, acting]), [['bloom', 'g/w/drop', 'all'], ['backrun', 'g/w/edge', 'all']]);
  const [drop] = wash.effects[0].touches;
  assert.ok(Math.abs(drop.wetness.most - medium.wetting.sheen.damp) < 1e-5 && drop.dryShare === 0);
  assert.deepEqual(wash.waits.map(({ under, effect }) => [under, effect?.id]), [['next', 'g/w/drop'], ['next', 'g/w/edge']]);
  assert.equal(wash.dryings.length, 1);
  assert.equal(wash.dryings[0].closes, 'end');
  assert.doesNotThrow(() => assertStampWetEffects(report));
});

test('a wait judges the next application by default, and one already past its target takes no time, said so', () => {
  const report = reported((wash) => {
    wash.wait('shiny');
    wash.stroke('far', { brush, diameter: 30, path: [{ x: 100, y: 100 }, { x: 200, y: 120 }], material: { kind: 'color', color: '#224488' }, water: 1, appliedAt: 1 });
    // Its water is the wettest paper now; under the next stroke, though, the sky is already past shiny.
    wash.wait('shiny');
    wash.stroke('near', { brush, diameter: 30, path: [{ x: 500, y: 300 }, { x: 600, y: 320 }], material: { kind: 'color', color: '#224488' }, appliedAt: 1.5 });
  });
  const [first, second] = report.washes[0].waits;
  assert.ok(first.seconds === 0 && first.alreadyDrier && first.wetness.before.most <= medium.wetting.sheen.shiny);
  assert.ok(second.seconds === 0 && second.alreadyDrier);
  const wholeWash = reported((wash) => {
    wash.stroke('far', { brush, diameter: 30, path: [{ x: 100, y: 100 }, { x: 200, y: 120 }], material: { kind: 'color', color: '#224488' }, water: 1, appliedAt: 1 });
    wash.wait('shiny', { under: 'wash' });
    wash.stroke('near', { brush, diameter: 30, path: [{ x: 500, y: 300 }, { x: 600, y: 320 }], material: { kind: 'color', color: '#224488' }, appliedAt: 1.5 });
  }).washes[0].waits[0];
  assert.ok(wholeWash.seconds > 0 && Math.abs(wholeWash.wetness.after.most - medium.wetting.sheen.shiny) < 1e-6);
  assert.throws(() => reported((wash) => wash.wait('damp')), /nothing is painted after it/);
  assert.throws(() => reported((wash) => wash.wait('dry', { under: 'next' })), /only a shiny or damp wait judges less than the wash/);
});

test("an effect that certainly won't act is warned of, with the bloom stage's reason, and the strict check throws", () => {
  // Dropped and charged once the sky has dried: nothing there is workable.
  const report = reported((wash) => {
    wash.wait('dry');
    wash.bloom('late', { brush, diameter: 50, at: [{ x: 300, y: 200 }], appliedAt: 1 });
    wash.charge('late-charge', { placement: { kind: 'area', region: sky }, touches: 3, mixtures: { kind: 'set', entries: [{ id: 'a', material: { kind: 'color', color: '#aa4422' }, weight: 1 }] }, brush, diameter: [20, 20], length: [30, 30], when: 'damp', appliedAt: 1, drawnOver: 0.3 });
  });
  const warnings = stampWetReportWarnings(report);
  assert.deepEqual(warnings, [
    "stamp paint: g/w/late (bloom) won't bloom: the paint there has set (or the paper was dry)",
    "stamp paint: g/w/late-charge (charge) won't mingle: the paint under it had set",
  ]);
  assert.throws(() => assertStampWetEffects(report), /2 wet effect\(s\) won't act/);
});

test("the report's dryings are the wash's own, closed where the paper set, whatever the wait was written as", () => {
  const dryings = (wait: (wash: StampWashScope) => void) => reported((wash) => {
    wait(wash);
    wash.stroke('late', { brush, diameter: 30, path: [{ x: 100, y: 100 }, { x: 200, y: 120 }], material: { kind: 'color', color: '#224488' }, appliedAt: 1 });
  }).washes[0].dryings.map(({ closes, deposits, rim }) => ({ closes, deposits, rim }));
  const whenSet = [{ closes: 'wait', deposits: 1, rim: 1 }, { closes: 'end', deposits: 1, rim: 1 }];
  assert.deepEqual(dryings((wash) => wash.wait('dry')), whenSet);
  assert.deepEqual(dryings((wash) => wash.wait({ seconds: 3600 })), whenSet);
  assert.deepEqual(dryings((wash) => wash.wait({ seconds: 1 })), [{ closes: 'end', deposits: 2, rim: 1 }]);
});
