import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampPaint } from './stamp-paint-recipe-compile.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import { stampRoundTipStatedProfile } from './stamp-tip-support.ts';
import { stampAreaBox } from './stamp-area.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };

const brush: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
  name: 'Wet Wash',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/wash.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({ size: { pressure: 0.5, random: 0.3 }, opacity: { pressure: 0.5, random: 0.3 } }),
  scatter: { count: 2, radius: 0.1, lateral: 0.2 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 0.4,
};
brush.profile = stampRoundTipStatedProfile(brush);
const ochre: PaintMaterial = { kind: 'color', color: '#c8902f' };

/** A sky flooded over a fixed region, and a cloud stroked at `cloudX` with a hand pressing by `profile`. */
const sky = (cloudX: number, profile: StampStrokeHand['profile']) => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.passage('wash', { wetHistory: false }, (pass) => {
  pass.fill('blue', { brush, well: { paint: ochre }, size: 40, application: { kind: 'flood' }, region: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }] } });
  pass.stroke('cloud', { brush, well: { paint: ochre }, size: 20, hand: { profile }, path: [{ x: cloudX, y: 80 }, { x: cloudX + 120, y: 90 }] });
}))));
/** Pressure curves: a swell, and a light and a firm hand. */
const swell = (along: number) => Math.sin(Math.PI * along);
const lightly = () => 0.2;
const firmly = () => 1;
const deposit = (painting: CompiledStampPaint, id: string) => stampPassDeposits(painting.groups[0].passes[0]).find((d) => d.id === `sky/wash/${id}`)!;

test('a recompiled painting keeps the marks of what didn\'t change and places afresh what moved', () => {
  const before = sky(50, swell), after = sky(80, swell);
  assert.equal(deposit(after, 'blue').stamps, deposit(before, 'blue').stamps);
  assert.notDeepEqual(deposit(after, 'cloud').stamps, deposit(before, 'cloud').stamps);
});

test('a hand\'s pressure curve is told apart by which function it is, as its content can\'t be read', () => {
  const light = sky(50, lightly), firm = sky(50, firmly);
  const pressures = (painting: CompiledStampPaint) => deposit(painting, 'cloud').stamps.map(({ pressure }) => pressure);
  assert.ok(Math.max(...pressures(light)) < Math.min(...pressures(firm)));
});

test('a brush edited in place, or a region, places by what it holds now, and what\'s placed can\'t be changed', () => {
  const flowing: StampBrush = { ...brush, flow: 1 };
  flowing.profile = stampRoundTipStatedProfile(flowing);
  const region = { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }] };
  const flood = () => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', { wetHistory: false }, (pass) => {
    pass.fill('f', { brush: flowing, well: { paint: ochre }, size: 40, application: { kind: 'flood' }, region });
  }))));
  const first = stampPassDeposits(flood().groups[0].passes[0])[0];
  flowing.flow = 0.2;
  flowing.profile = stampRoundTipStatedProfile(flowing);
  region.points[2] = { x: 300, y: 200 };
  const edited = stampPassDeposits(flood().groups[0].passes[0])[0];
  assert.equal(edited.stamps[0].alpha, 0.2 * first.stamps[0].alpha);
  assert.ok(edited.kind === 'flood' && first.kind === 'flood' && stampAreaBox(edited.flood.barrier).y1 > stampAreaBox(first.flood.barrier).y1 && first.flood.barrier.polygon[2].y === 100);
  assert.throws(() => Object.assign(first.stamps[0], { x: 1 }), TypeError);
});
