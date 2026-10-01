import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampWashScope } from './stamp-paint-recipe-types.ts';
import { compileStampWetness } from './stamp-wetness.ts';
import { stampStage } from './stamp-stage.ts';
import { stampGridAt } from './stamp-region.ts';
import { stampDryingWettest } from './stamp-wet-rim.ts';

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

/** One wash painted by `body`, compiled. */
const washOf = (body: (wash: StampWashScope) => void) =>
  compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.wash('w', {}, body))));

/** The wetness of `painting` in watercolour, and its one wash's dryings. */
function dried(painting: ReturnType<typeof washOf>) {
  const wetness = compileStampWetness(painting, () => PAINT_MEDIA.watercolour, { color: '#ffffff' }, stampStage({ width: 800, height: 400 }));
  return { wetness, dryings: wetness.washes.get(painting.groups[0].passes[0])!.dryings };
}

/** The wettest a one-drying wash painted by `body` in watercolour got. */
function wettestOf(body: (wash: StampWashScope) => void) {
  const { wetness, dryings: [drying] } = dried(washOf(body));
  return stampDryingWettest(drying, wetness);
}

test('a puddle reads as wet as it was right up to its edge, and damp brushwork beside it as its own brush', () => {
  const grid = wettestOf((wash) => {
    wash.fill('puddle', { brush, diameter: 60, application: { kind: 'flood' }, region: { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 100 }, material: { kind: 'color', color: '#336699' }, water: 1 });
    wash.stroke('damp', { brush, diameter: 40, material: { kind: 'color', color: '#336699' }, water: 0.4, path: [{ x: 550, y: 200 }, { x: 700, y: 200 }] });
  });
  assert.ok(grid);
  // Just inside the puddle's edge, where a footprint averaged onto the lattice would read half as wet.
  assert.ok(stampGridAt(grid, 318, 200) > 0.95, `puddle edge ${stampGridAt(grid, 318, 200)}`);
  assert.ok(Math.abs(stampGridAt(grid, 640, 200) - 0.4) < 0.05, `damp stroke ${stampGridAt(grid, 640, 200)}`);
});

test('a wash dries at each wait for dry that follows paint, and at its end', () => {
  const stroke = (wash: StampWashScope, id: string) => wash.stroke(id, { brush, diameter: 40, material: { kind: 'color', color: '#336699' }, path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] });
  const painting = washOf((wash) => {
    wash.wait('dry');
    stroke(wash, 'a');
    wash.wait('dry');
    wash.wait('dry');
    stroke(wash, 'b');
    stroke(wash, 'c');
  });
  const { dryings } = dried(painting);
  assert.deepEqual(dryings.map(({ id, deposits }) => [id, deposits.map((deposit) => deposit.id)]), [['g/w', ['g/w/a']], ['g/w|dry1', ['g/w/b', 'g/w/c']]]);
});

test('a seconds wait the whole wash has set by closes the same drying as a wait for dry; a shorter one closes none', () => {
  const stroke = (wash: StampWashScope, id: string) => wash.stroke(id, { brush, diameter: 40, material: { kind: 'color', color: '#336699' }, water: 1, path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] });
  const dryingsOf = (wait: (wash: StampWashScope) => void) => dried(washOf((wash) => {
    stroke(wash, 'a');
    wait(wash);
    stroke(wash, 'b');
  })).dryings.map(({ id, deposits, closes }) => [id, deposits.map((deposit) => deposit.id), closes === 'end' ? 'end' : closes.until]);
  const set = dried(washOf((wash) => {
    stroke(wash, 'a');
    wash.wait('dry');
  })).wetness.washes.values().next().value!.duration;
  assert.deepEqual(dryingsOf((wash) => wash.wait('dry')), [['g/w', ['g/w/a'], 'dry'], ['g/w|dry1', ['g/w/b'], 'end']]);
  assert.deepEqual(dryingsOf((wash) => wash.wait({ seconds: set + 1 })), [['g/w', ['g/w/a'], { seconds: set + 1 }], ['g/w|dry1', ['g/w/b'], 'end']]);
  // Still workable, though past damp: the two strokes dry together at the end.
  assert.deepEqual(dryingsOf((wash) => wash.wait({ seconds: set - 1 })), [['g/w', ['g/w/a', 'g/w/b'], 'end']]);
});

/** One wash at rim strength `rim` (the medium's when undefined) painted by `body`, compiled. */
const rimmed = (rim: number | undefined, body: (wash: StampWashScope) => void) =>
  compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.wash('w', { ...(rim !== undefined && { rim }) }, body))));

test("a wash's rim strength is every drying's, its end's too, unless a wait for dry gives its own; out of range or on another wait it's refused", () => {
  const stroke = (wash: StampWashScope, id: string) => wash.stroke(id, { brush, diameter: 40, material: { kind: 'color', color: '#336699' }, path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] });
  const dryings = (rim: number | undefined) => dried(rimmed(rim, (wash) => {
    stroke(wash, 'a');
    wash.wait('dry', { rim: 0 });
    stroke(wash, 'b');
    wash.wait('dry');
    stroke(wash, 'c');
  })).dryings.map((drying) => drying.rim);
  assert.deepEqual(dryings(undefined), [0, 1, 1]);
  assert.deepEqual(dryings(2), [0, 2, 2]);
  assert.throws(() => rimmed(2.5, (wash) => stroke(wash, 'a')), /rims at 2.5/);
  assert.throws(() => rimmed(undefined, (wash) => wash.wait('damp', { rim: 1 })), /only a wait for dry takes a rim/);
  // A seconds wait that sets the paper closes its drying at the wash's strength: an authored rim names its drying.
  assert.throws(() => rimmed(undefined, (wash) => wash.wait({ seconds: 600 }, { rim: 1 })), /only a wait for dry takes a rim/);
});
