import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush, type StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampFillApplication } from './stamp-fill.ts';
import { stampFillStrokePath } from './stamp-fill-strokes.ts';
import { compileStampPaintRecipe, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import { stampGridAt, type StampRegion } from './stamp-region.ts';
import { stampAreaCoverageAt } from './stamp-area.ts';
import { stampBrushEdgeReachOf, stampBrushEvenEdge, stampBrushStatedProfile } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampRoundTipFootprint, stampRoundTipStatedProfile, stampTipSupportOf } from './stamp-tip-support.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';

const FLAT: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'flat' } };

const brush: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
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
brush.profile = stampRoundTipStatedProfile(brush);

const polygon = (...xy: number[]): StampRegion => ({ kind: 'polygon', points: xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1] }])) });

/** `region` filled at `diameter` by a brush of `media`, as `settings` say. */
function compiledFill(region: StampRegion, diameter: number, settings: { application?: StampFillApplication }, media?: StampBrushMedia, color?: StampBrush['color']) {
  const filling: StampBrush = { ...brush, ...(media && { media }), ...(color && { color }) };
  filling.profile = stampRoundTipStatedProfile(filling);
  return stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) =>
    pass.fill('fill', { brush: filling, well: { paint: { kind: 'color', color: '#406585' } }, size: diameter, region, ...settings }))))).groups[0].passes[0])[0];
}

function compiledFlood(region: StampRegion, diameter: number, colored?: StampBrush['color']) {
  const deposit = compiledFill(region, diameter, { application: { kind: 'flood' } }, undefined, colored);
  if (deposit.kind !== 'flood') throw new Error(`a flood compiled to a ${deposit.kind}`);
  return deposit;
}

test("a flood's edge stroke runs its stamps its brush's visible offset inside the outline, round a disc and into a concave notch's corners, never across it, or as far past as it reaches", () => {
  const disc = compiledFlood({ kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 }, 50);
  // Untapered at full size, the outermost stamps' centres its visible offset (half a diameter, as stated) in, all the
  // way round; the rows inside stop there.
  const ring = disc.stamps.filter(({ x, y }) => Math.hypot(x - 200, y - 200) > 93);
  assert.ok(ring.length > 50);
  for (const { x, y, diameter } of disc.stamps) {
    assert.equal(diameter, 50);
    assert.ok(Math.hypot(x - 200, y - 200) < 97, `stamp at ${x},${y}`);
  }
  // A U, its notch 200 wide from the top down to y 200: the edge follows the notch's sides, but paints nothing in it.
  const u = compiledFlood(polygon(0, 0, 100, 0, 100, 200, 300, 200, 300, 0, 400, 0, 400, 300, 0, 300), 40);
  assert.deepEqual(u.stamps.filter(({ x, y }) => x > 100 && x < 300 && y < 200), []);
  for (const [x, y] of [[80, 20], [320, 20], [120, 220], [280, 220]]) assert.ok(u.stamps.some((s) => Math.hypot(s.x - x, s.y - y) < 6), `no stamp near ${x},${y}`);
  // Reaching half a diameter past, the flood lays the shape grown by that: its edge stamps' centres on the outline, and
  // the notch narrowed by as much from each side, not the shape scaled.
  const past = compiledFill(polygon(0, 0, 100, 0, 100, 200, 300, 200, 300, 0, 400, 0, 400, 300, 0, 300), 40, { application: { kind: 'flood', reach: { past: 0.5 } } });
  if (past.kind !== 'flood') throw new Error(`a flood compiled to a ${past.kind}`);
  for (const [x, y] of [[0, 150], [200, 300], [100, 100], [300, 100], [200, 200]]) assert.ok(past.stamps.some((s) => Math.hypot(s.x - x, s.y - y) < 4), `no stamp near ${x},${y}`);
  assert.deepEqual(past.stamps.filter(({ x, y }) => x > 125 && x < 275 && y < 175), []);
  assert.throws(() => compiledFill(polygon(0, 0, 100, 0, 100, 100), 40, { application: { kind: 'flood', reach: { past: -1 } } }), /0 or more diameters/);
});

test("a flood's dual lies within its edge stroke's centreline, so its edge is the edge stroke's own", () => {
  const dualed: StampBrush = { ...brush, dual: { ...brush, accumulation: { kind: 'build' }, blend: { family: 'layer', mode: 'multiply' }, scale: 0.4 } };
  const support = stampTipSupportOf(stampRoundTipFootprint());
  dualed.profile = stampBrushStatedProfile(dualed, 0.5, { main: support, dual: support });
  const deposit = stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) =>
    pass.fill('fill', { brush: dualed, well: { paint: { kind: 'color', color: '#406585' } }, size: 50, region: { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 }, application: { kind: 'flood' } }))))).groups[0].passes[0])[0];
  assert.ok(deposit.dualStamps.length > 100);
  // The edge contour runs 95 from the centre; a cell of the plan's grid over.
  for (const { x, y } of deposit.dualStamps) assert.ok(Math.hypot(x - 200, y - 200) <= 96, `dual stamp at ${x.toFixed(1)},${y.toFixed(1)}`);
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
  assert.ok(stampFillStrokePath(polygon(0, 0, 40, 0, 40, 40, 0, 40), { diameter: 20, offset: 10, edge: stampBrushEdgeReachOf(() => 10) }, 0, { pattern: { kind: 'shading' }, variation: 0, hand: {} }, 'small').length > 0);
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
    const path = stampFillStrokePath(square, { diameter: 16, offset: 8, edge: stampBrushEdgeReachOf(() => 8) }, 0, { pattern: { kind: pattern, turns }, variation: 0 }, 'turns');
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

const pitches = (rows: number[]) => rows.slice(1).map((y, i) => y - rows[i]);

test("a flood paints inside its edge in rows of its brush half its visible width apart, a dry brush's closer, so none of it is left bare", () => {
  const square = polygon(0, 0, 300, 0, 300, 300, 0, 300);
  // Rows run along x: the heights its inside stamps (clear of the edge contour, 20 in) lie at.
  const rowsOf = (media?: StampBrushMedia) => [...new Set(compiledFill(square, 40, { application: { kind: 'flood' } }, media).stamps
    .filter(({ x, y }) => Math.min(x, y, 300 - x, 300 - y) > 25).map(({ y }) => Math.round(y)))].toSorted((a, b) => a - b);
  // Stated, its visible offset is half its diameter: rows half the visible width apart.
  const wet = rowsOf();
  assert.ok(wet.length > 8 && pitches(wet).every((d) => Math.abs(d - 20) <= 1), `wet rows at ${wet.join(', ')}`);
  // A dry brush's rows a quarter diameter apart, as its marks never level into a film.
  const dry = rowsOf('dry');
  assert.ok(dry.length > 20 && pitches(dry).every((d) => Math.abs(d - 10) <= 1), `dry rows at ${dry.join(', ')}`);
});

test("a flood's water reaches by its tool's local scale: a narrow spike's own, the broad body's full", () => {
  // A 300 square with a spike 12 wide reaching 200 up from its top: at diameter 60 its ridge runs at a small scale.
  const flood = compiledFlood(polygon(0, 200, 144, 200, 150, 0, 156, 200, 300, 200, 300, 500, 0, 500), 60).flood;
  const at = (x: number, y: number) => stampGridAt(flood.scale, x, y);
  assert.ok(at(150, 100) < 0.4, `the spike at ${at(150, 100)}`);
  assert.equal(at(150, 350), 1);
});

test("where a region is thinner than its brush's smallest stroke reaches, a flood lays no stamps", () => {
  const flooding: StampBrush = { ...brush };
  const stated = stampRoundTipStatedProfile(flooding);
  // Measured from 8 px up: below it the profile says nothing.
  const [smallest, ...rest] = stated.samples;
  // A profile's key stands for its samples wherever a cache reads it: this hand-made one says how it differs.
  flooding.profile = { ...stated, key: { ...stated.key, assets: 'stated, from 8 px' }, samples: [{ ...smallest, diameter: 8, edge: stampBrushEvenEdge(4) }, ...rest] };
  const deposit = stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) =>
    pass.fill('fill', { brush: flooding, well: { paint: { kind: 'color', color: '#406585' } }, size: 64, region: polygon(0, 0, 4, 0, 4, 100, 0, 100), application: { kind: 'flood' } }))))).groups[0].passes[0])[0];
  if (deposit.kind !== 'flood') throw new Error(`a flood compiled to a ${deposit.kind}`);
  assert.equal(deposit.stamps.length, 0);
});

test("two brushes stating different reaches flood as each states, though their settings are alike", () => {
  const disc: StampRegion = { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 };
  const ringAt = (offset: number) => {
    const stating: StampBrush = { ...brush };
    const { support } = stampRoundTipStatedProfile(stating).samples[0];
    stating.profile = stampBrushStatedProfile(stating, offset, support);
    const deposit = stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) =>
      pass.fill('fill', { brush: stating, well: { paint: { kind: 'color', color: '#406585' } }, size: 50, region: disc, application: { kind: 'flood' } }))))).groups[0].passes[0])[0];
    return Math.max(...deposit.stamps.map(({ x, y }) => Math.hypot(x - 200, y - 200)));
  };
  // Half a diameter in, then a quarter: the edge ring 95 px out, then 107.5.
  assert.ok(Math.abs(ringAt(0.5) - 95) < 2 && Math.abs(ringAt(0.25) - 107.5) < 2, `rings at ${ringAt(0.5).toFixed(1)} and ${ringAt(0.25).toFixed(1)}`);
});

test("a lopsided brush's flood turns its nearer-reaching side to the outline, whichever side that is, so its edge stroke runs as near the line as its paint lets it", () => {
  const disc: StampRegion = { kind: 'ellipse', x: 200, y: 200, radiusX: 120, radiusY: 120 };
  const ringOf = (short: 'left' | 'right') => {
    const lopsided: StampBrush = { ...brush }, stated = stampRoundTipStatedProfile(lopsided);
    const halved = (side: 'left' | 'right', values: readonly number[]) => (side === short ? values.map((v) => v / 2) : values);
    const samples = stated.samples.map((sample) => ({ ...sample, edge: { left: halved('left', sample.edge.left), right: halved('right', sample.edge.right) } }));
    lopsided.profile = { ...stated, key: { ...stated.key, settings: `${short} short` }, samples };
    const deposit = stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) =>
      pass.fill('fill', { brush: lopsided, well: { paint: { kind: 'color', color: '#406585' } }, size: 50, region: disc, application: { kind: 'flood' } }))))).groups[0].passes[0])[0];
    return deposit.stamps.filter(({ x, y }) => Math.hypot(x - 200, y - 200) > 105).length;
  };
  // The short side reaches a quarter diameter: the edge ring runs 107.5 px out, not at the long side's 95.
  for (const short of ['left', 'right'] as const) assert.ok(ringOf(short) > 100, `${short} short: ${ringOf(short)} stamps past 105 px`);
});

test("a flood's barrier is its outline unless its edge is lost, then whole on the outline and gone at the lost edge's reach, its paint laid all the way out", () => {
  const square = polygon(40, 40, 160, 40, 160, 160, 40, 160);
  const floodOf = (application: StampFillApplication) => {
    const deposit = compiledFill(square, 24, { application });
    if (deposit.kind !== 'flood') throw new Error(`a flood compiled to a ${deposit.kind}`);
    return deposit;
  };
  const barrierOf = (application: StampFillApplication) => floodOf(application).flood.barrier;
  const kept = barrierOf({ kind: 'flood' }), lost = barrierOf({ kind: 'flood', edge: { kind: 'lost', reach: 20 } });
  // Along a side, clear of the corners, the stamps' centres stop the visible offset (12 px) inside what they lay: the
  // outline, or the lost edge's reach.
  const leftmost = (application: StampFillApplication) => Math.min(...floodOf(application).stamps.filter(({ y }) => y > 80 && y < 120).map(({ x }) => x));
  assert.ok(Math.abs(leftmost({ kind: 'flood' }) - 52) < 1, `kept: ${leftmost({ kind: 'flood' })}`);
  assert.ok(Math.abs(leftmost({ kind: 'flood', edge: { kind: 'lost', reach: 20 } }) - 32) < 1.5, `lost: ${leftmost({ kind: 'flood', edge: { kind: 'lost', reach: 20 } })}`);
  assert.ok(stampAreaCoverageAt(kept, 41, 100) > 0.99 && stampAreaCoverageAt(kept, 39, 100) < 0.01, 'kept: a pixel either side of the line');
  assert.ok(stampAreaCoverageAt(lost, 40, 100) > 0.99, `lost: on the line ${stampAreaCoverageAt(lost, 40, 100)}`);
  assert.ok(stampAreaCoverageAt(lost, 30, 100) > 0.3 && stampAreaCoverageAt(lost, 30, 100) < 0.7, `lost: halfway ${stampAreaCoverageAt(lost, 30, 100)}`);
  assert.ok(stampAreaCoverageAt(lost, 20, 100) < 0.01, `lost: at its reach ${stampAreaCoverageAt(lost, 20, 100)}`);
  assert.throws(() => barrierOf({ kind: 'flood', edge: { kind: 'lost', reach: 0 } }), /lost edge reaches 0 px/);
});
