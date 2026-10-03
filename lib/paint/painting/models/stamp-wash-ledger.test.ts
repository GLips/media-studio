import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { compileStampPaintRecipe, stampMixedPainting, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';
import { createStampWashLedger } from './stamp-wash-ledger.ts';
import { stampDepositSupport, stampRoundTipsOf, stampRoundTipStatedProfile } from './stamp-tip-support.ts';
import { stampDrying, stampPaintMedia } from './stamp-wetness.ts';

const watercolour = PAINT_MEDIA.watercolour;
const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: watercolour, pigments: WATERCOLOUR_PIGMENTS } };
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
const drop = (x: number, y: number) => ({ kind: 'stamps' as const, brush, size: 60, at: [{ x, y }] });

// Three drops of water, `under` twice on the same spot and `apart` far from them, landed at times the test decides.
const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', {}, (wash) => {
  wash.water('first', drop(200, 100));
  wash.water('under', drop(200, 100));
  wash.water('apart', drop(600, 300));
}))));
const [first, under, apart] = stampPassDeposits(painting.groups[0].passes[0]);
const media = stampPaintMedia(stampMixedPainting(painting), () => watercolour), tips = stampRoundTipsOf();
const drying = stampDrying(watercolour.wetting, painting.paper);
const ledger = () => createStampWashLedger({
  id: 'g/w', medium: watercolour, drying, preparation: null, waterOf: media.waterOf, supportOf: (deposit) => stampDepositSupport(deposit, tips(deposit)), reachOf: () => 0,
});
/** Painting seconds after which the first drop's water has set. */
const setAfter = media.waterOf(first) / drying.rate + drying.openTime;

test('a deposit finds the water under it as it stands at the time it is given, and nothing that never met its box', () => {
  const soon = ledger();
  soon.land(first, 0);
  assert.deepEqual(soon.land(under, 1).finds, { wet: true, workable: true });
  assert.deepEqual(soon.land(apart, 2).finds, { wet: false, workable: false });
  const late = ledger();
  late.land(first, 0);
  assert.deepEqual(late.land(under, setAfter + 1).finds, { wet: false, workable: false });
  assert.throws(() => late.land(apart, setAfter), /runs forward/);
});

test('each drying closes the deposits landed since the last at the time it is given; one with none since makes none', () => {
  const book = ledger();
  book.land(first, 0);
  book.land(under, 1);
  book.dry(setAfter + 1, 'set', 1.5);
  book.dry(setAfter + 2, 'set', 1);
  book.land(apart, setAfter + 3);
  book.dry(setAfter + 3, 'end', 1);
  assert.deepEqual(book.dryings.map(({ id, deposits, at, closes, rim }) => [id, deposits.map(({ id: deposit }) => deposit), at, closes, rim]), [
    ['g/w', ['g/w/first', 'g/w/under'], setAfter + 1, 'set', 1.5],
    ['g/w|dry1', ['g/w/apart'], setAfter + 3, 'end', 1],
  ]);
  // The later drying starts from paper long set: only its own water stands.
  assert.equal(book.dryings[1].wettest, Math.min(1, media.waterOf(apart)));
});
