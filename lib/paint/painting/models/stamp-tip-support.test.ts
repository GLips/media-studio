import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_BRUSH_PROFILE_PROTOCOL, stampBrushEvenEdge, stampBrushProfileSettingsHash } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';
import { compileStampPaintRecipe, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import { stampDepositMeasuredSupport, stampDepositSupport, stampTipSupportOf, type StampTipFootprint } from './stamp-tip-support.ts';

test('a profile\'s measured support holds every stamp of a turned, off-centre square tip, as its levels place them', () => {
  const size = 32, center = [0.25, 0.5] as const;
  const square: StampTipFootprint = { levels: stampTipLevels({ width: size, height: size, pixels: new Uint8Array(size * size) }), span: 1, center, roundness: 1, pressed: null };
  const plain: StampBrush = {
    profile: STAMP_BRUSH_UNMEASURED,
    name: 'Square', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
    tip: { image: { style: 'wash', pack: 'test', file: 'tips/square.png' }, roundness: 1, sampling: 'isotropic', center },
    spacing: 0.25, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
    rotation: { angle: 0.7, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
    taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
  };
  const support = { main: stampTipSupportOf(square), dual: null };
  const brush: StampBrush = {
    ...plain,
    profile: {
      kind: 'measured',
      key: { protocol: STAMP_BRUSH_PROFILE_PROTOCOL, settings: stampBrushProfileSettingsHash(plain), assets: '', medium: '' },
      provenance: { adapter: 'test', browser: 'test', renderer: 'test', seeds: ['a'], measuredAt: '2026-10-01T00:00:00Z' },
      samples: [{ diameter: 16, edge: stampBrushEvenEdge(8), edgeNoise: 0, support }, { diameter: 64, edge: stampBrushEvenEdge(32), edgeNoise: 0, support }],
    },
  };
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: { color: '#ffffff' }, mixing: { kind: 'flat' } }, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) =>
    pass.stroke('s', { brush, well: { paint: { kind: 'color', color: '#203040' } }, size: 40, path: [{ x: 100, y: 100 }, { x: 300, y: 140 }] })))));
  const [deposit] = painting.groups[0].passes.flatMap(stampPassDeposits);
  const placed = stampDepositSupport(deposit, { main: square, dual: null })!, measured = stampDepositMeasuredSupport(deposit)!;
  assert.ok(measured.x0 <= placed.x0 && measured.y0 <= placed.y0 && measured.x1 >= placed.x1 && measured.y1 >= placed.y1, `${JSON.stringify(measured)} holds ${JSON.stringify(placed)}`);
  // The tip hangs three quarters of its width ahead of its place: half a diameter round each stamp misses it.
  assert.ok(placed.x1 > 300 + 20 + 5, `the tip reaches ${placed.x1}`);
});
