import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe } from './stamp-paint-recipe.ts';
import { stampFillBody, stampGridAt, stampPolygonDistance, type StampRegion } from './stamp-region.ts';

const brush: StampBrush = {
  name: 'Wash',
  blend: 'normal',
  accumulation: { kind: 'buildToOpacity' },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/wash.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({ size: { pressure: 0.5 }, opacity: { pressure: 0.5 }, rotation: { direction: 1 } }),
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 0.4,
};

const polygon = (...xy: number[]): StampRegion => ({ kind: 'polygon', points: xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1] }])) });

function compiledFill(region: StampRegion, diameter: number) {
  const [deposit] = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.pass('p', {}, (pass) => pass.fill('fill', { brush, material: { kind: 'color', color: '#406585' }, diameter, region }))))).groups[0].passes[0].deposits;
  assert.equal(deposit.kind, 'fill');
  return deposit;
}

test("a fill's edge stroke puts its stamps' edges on the outline, round a disc and into a concave notch's corners, never across it", () => {
  const disc = compiledFill({ kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 }, 50);
  // Untapered at full size, each stamp's centre half a diameter in, so its edge touches the outline all the way round.
  assert.ok(disc.stamps.length > 50);
  for (const { x, y, diameter } of disc.stamps) {
    assert.equal(diameter, 50);
    assert.ok(Math.abs(Math.hypot(x - 200, y - 200) - 95) < 2, `stamp at ${x},${y}`);
  }
  // A U, its notch 200 wide from the top down to y 200: the edge follows the notch's sides, but paints nothing in it.
  const u = compiledFill(polygon(0, 0, 100, 0, 100, 200, 300, 200, 300, 0, 400, 0, 400, 300, 0, 300), 40);
  assert.deepEqual(u.stamps.filter(({ x, y }) => x > 100 && x < 300 && y < 200), []);
  for (const [x, y] of [[80, 20], [320, 20], [120, 220], [280, 220]]) assert.ok(u.stamps.some((s) => Math.hypot(s.x - x, s.y - y) < 6), `no stamp near ${x},${y}`);
});

test("a fill's body paints a feature narrower than a diameter, which its edge stroke leaves out", () => {
  // A slab with a spike 10 px wide rising 200 px from it: far thinner than the 60-px brush.
  const region = polygon(0, 300, 195, 300, 200, 100, 205, 300, 400, 300, 400, 400, 0, 400);
  const fill = compiledFill(region, 60);
  assert.equal(fill.kind === 'fill' && fill.stamps.some(({ y }) => y < 290), false);
  if (fill.kind !== 'fill') return;
  const body = (x: number, y: number) => stampFillBody(stampPolygonDistance(fill.fill.polygon, x, y), stampGridAt(fill.fill.thickness, x, y), fill.fill.inset);
  // Down the spike's middle the body is solid, and it stays inside the spike.
  for (const y of [150, 200, 250]) {
    const half = (5 * (y - 100)) / 200;
    assert.ok(body(200, y) > 0.9, `spike empty at y ${y}`);
    assert.equal(body(200 + half + 1, y), 0);
  }
});
