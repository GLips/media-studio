import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampWashScope } from './stamp-paint-recipe-types.ts';
import { compileStampWetness } from './stamp-wetness.ts';
import { stampGridAt } from './stamp-region.ts';
import { stampDryingWettest, stampWashDryings } from './stamp-wet-rim.ts';

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

/** The wettest a one-drying wash painted by `body` in watercolour got. */
function wettestOf(body: (wash: StampWashScope) => void) {
  const painting = washOf(body);
  const [drying] = stampWashDryings(painting.groups[0].passes[0]);
  return stampDryingWettest(drying, compileStampWetness(painting, PAINT_MEDIA.watercolour, { color: '#ffffff' }, { width: 800, height: 400 }));
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
  const dryings = stampWashDryings(painting.groups[0].passes[0]);
  assert.deepEqual(dryings.map(({ id, deposits }) => [id, deposits.map((deposit) => deposit.id)]), [['g/w', ['g/w/a']], ['g/w|dry1', ['g/w/b', 'g/w/c']]]);
});

/** One wash at rim strength `rim` (the medium's when undefined) painted by `body`, compiled. */
const rimmed = (rim: number | undefined, body: (wash: StampWashScope) => void) =>
  compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.wash('w', { ...(rim !== undefined && { rim }) }, body))));

test("a wash's rim strength is every drying's, its end's too, unless a wait for dry gives its own; out of range or on another wait it's refused", () => {
  const stroke = (wash: StampWashScope, id: string) => wash.stroke(id, { brush, diameter: 40, material: { kind: 'color', color: '#336699' }, path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] });
  const dryings = (rim: number | undefined) => stampWashDryings(rimmed(rim, (wash) => {
    stroke(wash, 'a');
    wash.wait('dry', { rim: 0 });
    stroke(wash, 'b');
    wash.wait('dry');
    stroke(wash, 'c');
  }).groups[0].passes[0]).map((drying) => drying.rim);
  assert.deepEqual(dryings(undefined), [0, 1, 1]);
  assert.deepEqual(dryings(2), [0, 2, 2]);
  assert.throws(() => rimmed(2.5, (wash) => stroke(wash, 'a')), /rims at 2.5/);
  assert.throws(() => rimmed(undefined, (wash) => wash.wait('damp', { rim: 1 })), /only a wait for dry rims/);
});
