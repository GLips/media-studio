import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import { compileStampPaintRecipe, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';
import { stampMarksList } from '#lib/paint/brush/models/stamp-mark-rows.ts';

const FLAT: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'flat' } };

const D = 20;
/** Right along the top, then a sharp turn down: a corner at (400, 0). */
const corner = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }];
const nearest = <P extends { x: number; y: number }>(points: readonly P[], x: number, y: number) =>
  points.reduce((best, p) => (Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best));

const brush: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 's', pack: 'p', file: 'tip.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({ size: { pressure: 1 } }),
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0, flow: 1,
};

test('in a recipe, a hand stroke thins by its profile', () => {
  const [even, handed] = stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) => {
    pass.stroke('even', { brush, well: { paint: { kind: 'color', color: '#000000' } }, size: D, path: corner });
    pass.stroke('hand', { brush, well: { paint: { kind: 'color', color: '#000000' } }, size: D, path: corner, hand: { profile: 'swell', curvature: 0.3 } });
  })))).groups[0].passes[0]);
  assert.ok(stampMarksList(even.stamps).every((s) => s.diameter === D));
  assert.ok(stampMarksList(handed.stamps)[0].diameter < 0.5 * D && nearest(stampMarksList(handed.stamps), 400, 0).diameter > 0.9 * D);
});
