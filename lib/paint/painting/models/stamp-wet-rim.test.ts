import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPassageScope } from './stamp-paint-recipe-types.ts';
import { compileStampWetness } from './stamp-wetness.ts';
import { stampStage } from './stamp-stage.ts';
import { stampGridAt } from './stamp-region.ts';
import { stampDryingWettest } from './stamp-wet-rim.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };

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
const washOf = (body: (wash: StampPassageScope) => void) =>
  compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', {}, body))));

/** The wetness of `painting` in watercolour, and its one wash's dryings. */
function dried(painting: ReturnType<typeof washOf>) {
  const wetness = compileStampWetness(painting, () => PAINT_MEDIA.watercolour, stampStage({ width: 800, height: 400 }));
  return { wetness, dryings: wetness.washes.get(painting.groups[0].passes[0])!.dryings };
}

/** The wettest a one-drying wash painted by `body` in watercolour got. */
function wettestOf(body: (wash: StampPassageScope) => void) {
  const { wetness, dryings: [drying] } = dried(washOf(body));
  return stampDryingWettest(drying, wetness);
}

test('a puddle reads as wet as it was right up to its edge, and damp brushwork beside it as its own brush', () => {
  const grid = wettestOf((wash) => {
    wash.fill('puddle', { brush, size: 60, application: { kind: 'flood' }, region: { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 100 }, well: { paint: { kind: 'color', color: '#336699' }, water: 1 } });
    wash.stroke('damp', { brush, size: 40, well: { paint: { kind: 'color', color: '#336699' }, water: 0.4 }, path: [{ x: 550, y: 200 }, { x: 700, y: 200 }] });
  });
  assert.ok(grid);
  // Just inside the puddle's edge, where a footprint averaged onto the lattice would read half as wet.
  assert.ok(stampGridAt(grid, 318, 200) > 0.95, `puddle edge ${stampGridAt(grid, 318, 200)}`);
  assert.ok(Math.abs(stampGridAt(grid, 640, 200) - 0.4) < 0.05, `damp stroke ${stampGridAt(grid, 640, 200)}`);
});

test("a wash dries at each wait('set') that follows paint, and at its end", () => {
  const stroke = (wash: StampPassageScope, id: string) => wash.stroke(id, { brush, size: 40, well: { paint: { kind: 'color', color: '#336699' } }, path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] });
  const painting = washOf((wash) => {
    wash.wait('set');
    stroke(wash, 'a');
    wash.wait('set');
    wash.wait('set');
    stroke(wash, 'b');
    stroke(wash, 'c');
  });
  const { dryings } = dried(painting);
  assert.deepEqual(dryings.map(({ id, deposits }) => [id, deposits.map((deposit) => deposit.id)]), [['g/w', ['g/w/a']], ['g/w|dry1', ['g/w/b', 'g/w/c']]]);
});

test("a seconds wait the whole wash has set by closes the same drying as wait('set'); a shorter one closes none", () => {
  const stroke = (wash: StampPassageScope, id: string) => wash.stroke(id, { brush, size: 40, well: { paint: { kind: 'color', color: '#336699' }, water: 1 }, path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] });
  const dryingsOf = (wait: (wash: StampPassageScope) => void) => dried(washOf((wash) => {
    stroke(wash, 'a');
    wait(wash);
    stroke(wash, 'b');
  })).dryings.map(({ id, deposits, closes }) => [id, deposits.map((deposit) => deposit.id), closes === 'end' ? 'end' : closes.until]);
  const set = dried(washOf((wash) => {
    stroke(wash, 'a');
    wash.wait('set');
  })).wetness.washes.values().next().value!.duration;
  assert.deepEqual(dryingsOf((wash) => wash.wait('set')), [['g/w', ['g/w/a'], 'set'], ['g/w|dry1', ['g/w/b'], 'end']]);
  assert.deepEqual(dryingsOf((wash) => wash.wait({ seconds: set + 1 })), [['g/w', ['g/w/a'], { seconds: set + 1 }], ['g/w|dry1', ['g/w/b'], 'end']]);
  // Still workable, though past damp: the two strokes dry together at the end.
  assert.deepEqual(dryingsOf((wash) => wash.wait({ seconds: set - 1 })), [['g/w', ['g/w/a', 'g/w/b'], 'end']]);
});

/** One wash at rim strength `rim` (the medium's when undefined) painted by `body`, compiled. */
const rimmed = (rim: number | undefined, body: (wash: StampPassageScope) => void) =>
  compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', { ...(rim !== undefined && { rim }) }, body))));

test("a wash's rim strength is every drying's, its end's too, unless a wait('set') gives its own; out of range it's refused", () => {
  const stroke = (wash: StampPassageScope, id: string) => wash.stroke(id, { brush, size: 40, well: { paint: { kind: 'color', color: '#336699' } }, path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] });
  const dryings = (rim: number | undefined) => dried(rimmed(rim, (wash) => {
    stroke(wash, 'a');
    wash.wait('set', { rim: 0 });
    stroke(wash, 'b');
    wash.wait('set');
    stroke(wash, 'c');
  })).dryings.map((drying) => drying.rim);
  assert.deepEqual(dryings(undefined), [0, 1, 1]);
  assert.deepEqual(dryings(2), [0, 2, 2]);
  assert.throws(() => rimmed(2.5, (wash) => stroke(wash, 'a')), /rims at 2.5/);
});
