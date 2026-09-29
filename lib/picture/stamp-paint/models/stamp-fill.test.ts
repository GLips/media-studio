import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampBrush } from './stamp-brush.ts';
import { stampFillBrush, stampFillPath } from './stamp-fill.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type StampRegion } from './stamp-paint-recipe.ts';

const brush: StampBrush = {
  name: 'Wash',
  blend: 'normal',
  accumulation: 'glaze',
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/wash.png' }, roundness: 1 },
  spacing: 0.2,
  stepping: 'spread',
  jitter: { lateral: 0, size: 0, opacity: 0, flow: 0 },
  scatter: { count: 1, countJitter: 0, radius: 0 },
  rotation: { angle: 0, follow: 1, jitter: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 0.4,
  pressure: { size: 0.5, opacity: 0.5, flow: 0 },
};

test('a fill covers a concave region in one stroke, lifting across its notch rather than painting it', () => {
  // A U: two arms 100 wide, a notch 200 wide between them from the top down to y 200.
  const u: StampRegion = { kind: 'polygon', points: [0, 0, 100, 0, 100, 200, 300, 200, 300, 0, 400, 0, 400, 300, 0, 300].reduce<{ x: number; y: number }[]>(
    (points, v, i, all) => (i % 2 ? points : [...points, { x: v, y: all[i + 1] }]), []) };
  const deposits = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.pass('p', {}, (pass) => pass.stroke('fill', { brush: stampFillBrush(brush), material: { kind: 'flat', color: '#406585' }, diameter: 40, path: stampFillPath(u, 40) }))))).groups[0].passes[0].deposits;
  assert.equal(deposits.length, 1);
  const { stamps } = deposits[0];
  const inNotch = stamps.filter(({ x, y }) => x > 110 && x < 290 && y < 190);
  assert.deepEqual(inNotch, []);
  // Both arms and the bar under them are painted, every stamp at full size.
  for (const [x, y] of [[50, 50], [350, 50], [200, 260]]) assert.ok(stamps.some((stamp) => Math.hypot(stamp.x - x, stamp.y - y) < 20), `nothing near ${x},${y}`);
  assert.ok(stamps.every((stamp) => stamp.diameter === stamps[0].diameter));
});
