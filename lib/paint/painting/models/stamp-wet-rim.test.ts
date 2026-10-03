import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPassageOptions, StampPassageScope } from './stamp-paint-recipe-types.ts';
import { compileStampWetness, stampPaintMedia } from './stamp-wetness.ts';
import { stampRoundTipsOf, stampRoundTipStatedProfile } from './stamp-tip-support.ts';
import { stampDryingRimBound } from './stamp-wet-rim.ts';
import type { StampFloodEdge } from './stamp-fill.ts';
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

/** One wash painted by `body`, compiled. */
const washOf = (body: (wash: StampPassageScope) => void, options: StampPassageOptions = {}) =>
  compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', options, body))));

/** The wetness of `painting` in watercolour, and its one wash's dryings. */
function dried(painting: ReturnType<typeof washOf>) {
  const wetness = compileStampWetness(painting, stampPaintMedia(painting, () => PAINT_MEDIA.watercolour), stampRoundTipsOf());
  return { wetness, dryings: wetness.washes.get(painting.groups[0].passes[0])!.dryings };
}

/** How a one-drying wash painted by `body` in watercolour bounds its rim, and its one drying. */
function boundOf(body: (wash: StampPassageScope) => void, options: StampPassageOptions = {}) {
  const { wetness, dryings: [drying] } = dried(washOf(body, options));
  return { drying, bound: stampDryingRimBound(drying, wetness) };
}
const blue = { kind: 'color', color: '#336699' } as const;
const region = { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 100 } as const;

test('paint on paper prepared wet bounds a rim as wide as the tool that painted it, though it brought no more water, or none', () => {
  const sheet = { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 0, y: 400 }] };
  for (const water of [1, 0]) {
    const { bound } = boundOf((wash) => {
      wash.fill('paint', { brush, size: 60, application: { kind: 'flood' }, region, well: { paint: blue, water } });
    }, { preparation: { region: sheet } });
    assert.ok(bound && bound.band > 10, `water ${water}: band ${bound?.band}`);
  }
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

test("a drying after the wash has set stands only as wet as its own water, not an earlier drying's", () => {
  const stroke = (wash: StampPassageScope, id: string, water: number, y: number) => wash.stroke(id, { brush, size: 40, well: { paint: blue, water }, path: [{ x: 100, y }, { x: 300, y }] });
  const { dryings } = dried(washOf((wash) => {
    stroke(wash, 'a', 1, 100);
    wash.wait('set');
    stroke(wash, 'b', 0.1, 300);
  }));
  assert.deepEqual(dryings.map(({ wettest }) => wettest), [1, 0.1]);
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

test('a flood its barrier holds stands as wet as a puddle, though it carried less; lost, however little, it stands as wet as its own water', () => {
  const wettest = (edge?: StampFloodEdge) => boundOf((wash) => {
    wash.fill('flood', { brush, size: 60, application: { kind: 'flood', ...(edge && { edge }) }, region, well: { paint: blue, water: 0.7 } });
  }).drying.wettest;
  assert.equal(wettest(), 1);
  for (const reach of [16, 1]) assert.ok(Math.abs(wettest({ kind: 'lost', reach }) - 0.7) < 1e-6, `lost over ${reach} px: ${wettest({ kind: 'lost', reach })}`);
});
