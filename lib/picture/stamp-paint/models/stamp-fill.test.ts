import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush, type StampBrushMedia } from './stamp-brush.ts';
import type { StampFillApplication } from './stamp-fill.ts';
import { compileStampPaintRecipe, stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampRegion } from './stamp-region.ts';

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

/** `region` filled at `diameter` by a brush of `media`, as `settings` say. */
function compiledFill(region: StampRegion, diameter: number, settings: { application?: StampFillApplication }, media?: StampBrushMedia) {
  return compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) =>
    pass.fill('fill', { brush: { ...brush, ...(media && { media }) }, material: { kind: 'color', color: '#406585' }, diameter, region, ...settings }))))).groups[0].passes[0].deposits[0];
}

function compiledWash(region: StampRegion, diameter: number) {
  const deposit = compiledFill(region, diameter, { application: { kind: 'wash' } });
  if (deposit.kind !== 'wash') throw new Error(`a wash compiled to a ${deposit.kind}`);
  return deposit;
}

test("a wash's edge stroke puts its stamps' edges on the outline, round a disc and into a concave notch's corners, never across it", () => {
  const disc = compiledWash({ kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 }, 50);
  // Untapered at full size, each stamp's centre half a diameter in, so its edge touches the outline all the way round.
  assert.ok(disc.stamps.length > 50);
  for (const { x, y, diameter } of disc.stamps) {
    assert.equal(diameter, 50);
    assert.ok(Math.abs(Math.hypot(x - 200, y - 200) - 95) < 2, `stamp at ${x},${y}`);
  }
  // A U, its notch 200 wide from the top down to y 200: the edge follows the notch's sides, but paints nothing in it.
  const u = compiledWash(polygon(0, 0, 100, 0, 100, 200, 300, 200, 300, 0, 400, 0, 400, 300, 0, 300), 40);
  assert.deepEqual(u.stamps.filter(({ x, y }) => x > 100 && x < 300 && y < 200), []);
  for (const [x, y] of [[80, 20], [320, 20], [120, 220], [280, 220]]) assert.ok(u.stamps.some((s) => Math.hypot(s.x - x, s.y - y) < 6), `no stamp near ${x},${y}`);
});

test("a fill in strokes lays marks whose edges reach the outline, never past it, and a wide hatch leaves paper between", () => {
  const disc = { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 } as const;
  for (const pattern of ['zigzag', 'backAndForth', 'hatch', 'crossHatch', 'scribble'] as const) {
    const fill = compiledFill(disc, 30, { application: { kind: 'strokes', pattern, variation: 0, hand: {} } });
    assert.equal(fill.kind, 'stroke');
    const reach = Math.max(...fill.stamps.map(({ x, y }) => Math.hypot(x - 200, y - 200) + 15));
    assert.ok(reach > 115 && reach < 122, `${pattern} reaches ${reach}`);
  }
  // Rows about two diameters apart: every stamp's centre lies within a few px of a row, and between rows lies paper.
  const hatch = compiledFill(disc, 30, { application: { kind: 'strokes', pattern: 'hatch', spacing: 2, variation: 0 } });
  const rows = hatch.stamps.map(({ y }) => y).toSorted((a, b) => a - b).filter((y, i, ys) => i === 0 || y - ys[i - 1] > 10);
  assert.ok(rows.length >= 3 && rows.every((y, i) => i === 0 || y - rows[i - 1] > 55), `rows at ${rows.map(Math.round).join(', ')}`);
});

test("a fill is laid as its brush's media lays it unless it says, and refused when no one says", () => {
  const square = polygon(0, 0, 200, 0, 200, 200, 0, 200);
  assert.equal(compiledFill(square, 30, {}, 'wet').kind, 'wash');
  assert.equal(compiledFill(square, 30, {}, 'dry').kind, 'stroke');
  assert.equal(compiledFill(square, 30, { application: { kind: 'strokes', pattern: 'hatch' } }, 'wet').kind, 'stroke');
  assert.throws(() => compiledFill(square, 30, {}), /states its application/);
});
