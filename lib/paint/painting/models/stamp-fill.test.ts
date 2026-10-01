import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush, type StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampFillApplication } from './stamp-fill.ts';
import { stampFillStrokePath } from './stamp-fill-strokes.ts';
import { compileStampPaintRecipe, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
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
function compiledFill(region: StampRegion, diameter: number, settings: { application?: StampFillApplication }, media?: StampBrushMedia, color?: StampBrush['color']) {
  return stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) =>
    pass.fill('fill', { brush: { ...brush, ...(media && { media }), ...(color && { color }) }, material: { kind: 'color', color: '#406585' }, diameter, region, ...settings }))))).groups[0].passes[0])[0];
}

function compiledFlood(region: StampRegion, diameter: number, colored?: StampBrush['color']) {
  const deposit = compiledFill(region, diameter, { application: { kind: 'flood' } }, undefined, colored);
  if (deposit.kind !== 'flood') throw new Error(`a flood compiled to a ${deposit.kind}`);
  return deposit;
}

test("a flood's edge stroke puts its stamps' edges on the outline, round a disc and into a concave notch's corners, never across it", () => {
  const disc = compiledFlood({ kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 }, 50);
  // Untapered at full size, each stamp's centre half a diameter in, so its edge touches the outline all the way round.
  assert.ok(disc.stamps.length > 50);
  for (const { x, y, diameter } of disc.stamps) {
    assert.equal(diameter, 50);
    assert.ok(Math.abs(Math.hypot(x - 200, y - 200) - 95) < 2, `stamp at ${x},${y}`);
  }
  // A U, its notch 200 wide from the top down to y 200: the edge follows the notch's sides, but paints nothing in it.
  const u = compiledFlood(polygon(0, 0, 100, 0, 100, 200, 300, 200, 300, 0, 400, 0, 400, 300, 0, 300), 40);
  assert.deepEqual(u.stamps.filter(({ x, y }) => x > 100 && x < 300 && y < 200), []);
  for (const [x, y] of [[80, 20], [320, 20], [120, 220], [280, 220]]) assert.ok(u.stamps.some((s) => Math.hypot(s.x - x, s.y - y) < 6), `no stamp near ${x},${y}`);
});

test("a fill in strokes lays marks whose edges reach the outline, past it only when it reaches over, and a wide hatch leaves paper between", () => {
  const disc = { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 } as const;
  for (const pattern of ['zigzag', 'backAndForth', 'hatch', 'crossHatch', 'scribble', 'shading'] as const) {
    const fill = compiledFill(disc, 30, { application: { kind: 'strokes', pattern: { kind: pattern }, variation: 0, hand: {} } });
    assert.equal(fill.kind, 'stroke');
    const reach = Math.max(...fill.stamps.map(({ x, y }) => Math.hypot(x - 200, y - 200) + 15));
    assert.ok(reach > 115 && reach < 122, `${pattern} reaches ${reach}`);
  }
  // Reaching over, its marks' middles run out to the outline, round the disc's shape, not its box.
  const over = compiledFill(disc, 30, { application: { kind: 'strokes', pattern: { kind: 'backAndForth' }, variation: 0, reach: { past: 0 } } });
  const centres = over.stamps.map(({ x, y }) => Math.hypot(x - 200, y - 200));
  assert.ok(Math.max(...centres) > 114 && Math.max(...centres) < 122, `centres reach ${Math.max(...centres)}`);
  // A region shorter than a shading stroke is still shaded, not left to a neighbouring patch it hasn't got.
  assert.ok(stampFillStrokePath(polygon(0, 0, 40, 0, 40, 40, 0, 40), 20, 0, { pattern: { kind: 'shading' }, variation: 0, hand: {} }, 'small').length > 0);
  // Rows about two diameters apart: every stamp's centre lies within a few px of a row, and between rows lies paper.
  const hatch = compiledFill(disc, 30, { application: { kind: 'strokes', pattern: { kind: 'hatch' }, spacing: 2, variation: 0 } });
  const rows = hatch.stamps.map(({ y }) => y).toSorted((a, b) => a - b).filter((y, i, ys) => i === 0 || y - ys[i - 1] > 10);
  assert.ok(rows.length >= 3 && rows.every((y, i) => i === 0 || y - rows[i - 1] > 55), `rows at ${rows.map(Math.round).join(', ')}`);
});

test("a fill is laid as its brush's media lays it unless it says, and refused when no one says", () => {
  const square = polygon(0, 0, 200, 0, 200, 200, 0, 200);
  assert.equal(compiledFill(square, 30, {}, 'wet').kind, 'flood');
  assert.equal(compiledFill(square, 30, {}, 'dry').kind, 'stroke');
  assert.equal(compiledFill(square, 30, { application: { kind: 'strokes', pattern: { kind: 'hatch' } } }, 'wet').kind, 'stroke');
  assert.throws(() => compiledFill(square, 30, {}), /states its application/);
});

test('every fill that doubles back eases off there unless pressed, its own hand too, and is firm through its runs', () => {
  const square: StampRegion = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }] };
  for (const pattern of ['backAndForth', 'zigzag', 'shading'] as const) for (const turns of ['eased', 'pressed'] as const) {
    const path = stampFillStrokePath(square, 16, 0, { pattern: { kind: pattern, turns }, variation: 0 }, 'turns');
    const pressures = path.map((p) => p.pressure ?? 1), firm = Math.max(...pressures);
    // A corner of a reversal: the way in and the way out more than 60° apart (a shading's U-turn is two of them).
    const corners = path.flatMap((p, i) => {
      if (i === 0 || i === path.length - 1 || p.lift || path[i + 1].lift) return [];
      const a = Math.atan2(p.y - path[i - 1].y, p.x - path[i - 1].x), b = Math.atan2(path[i + 1].y - p.y, path[i + 1].x - p.x);
      return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) > Math.PI / 3 ? [pressures[i]] : [];
    });
    assert.ok(corners.length > 5, `${pattern} turns ${corners.length} times`);
    if (turns === 'eased') assert.ok(corners.every((p) => p < 0.4 * firm), `${pattern} presses ${Math.max(...corners).toFixed(2)} at a turn against ${firm.toFixed(2)}`);
    // Pressed, a covering brush's turns reach the outline at full size.
    else assert.ok(corners.every((p) => p > 0.8 * firm), `${pattern} pressed turns at ${Math.min(...corners).toFixed(2)}`);
    // Firm through its runs: a hand that lightens straight runs leaves a crayon fill a hollow frame.
    const typical = pressures.toSorted((a, b) => a - b)[Math.floor(pressures.length / 2)];
    assert.ok(typical > 0.8, `${pattern} runs at ${typical.toFixed(2)}`);
  }
});

test("a flood's body is coloured as its edge stamps average, so where they give out the colour carries on", () => {
  const color = { stamp: { hue: 0.1, saturation: 0.3, lightness: 0.4, darkness: 0.1 }, stroke: { hue: 0, saturation: 0, lightness: 0, darkness: 0 }, pressure: { hue: 0, saturation: 0, lightness: 0, secondary: 0.8 } };
  const flood = compiledFlood({ kind: 'ellipse', x: 400, y: 400, radiusX: 300, radiusY: 300 }, 40, color);
  const mean = (key: 'hue' | 'saturation' | 'lightness' | 'secondary') => flood.stamps.reduce((sum, s) => sum + s.tint[key], 0) / flood.stamps.length;
  for (const key of ['hue', 'saturation', 'lightness', 'secondary'] as const) assert.ok(Math.abs(flood.flood.tint[key] - mean(key)) < 0.01, `${key}: body ${flood.flood.tint[key]}, stamps ${mean(key)}`);
  assert.ok(flood.flood.tint.lightness > 0.1, 'the stamps lighten on average, and so does the body');
});
