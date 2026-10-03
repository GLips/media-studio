import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NARROW_FILL_SHAPES } from './narrow-fills.ts';
import { planStampFloodRuns, stampFloodLoss, type StampFloodReach, type StampFloodRuns } from '#lib/paint/painting/models/stamp-fill-plan.ts';
import { stampBrushEdgeReachOf } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampPolygonDistance, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

// Two brushes: a filler's narrow reach and a wet brush's wide one, each measured down to `smallest` px.
const BRUSHES = [
  { offset: (d: number) => 0.3 * d, smallest: 2 },
  { offset: (d: number) => 0.75 * d - 0.5, smallest: 4 },
];
const DIAMETERS = [8, 24, 64];

const plans = () => NARROW_FILL_SHAPES.flatMap(({ id, outline }) => BRUSHES.flatMap(({ offset, smallest }) => DIAMETERS.map((diameter) => {
  const reach: StampFloodReach = { offset, edge: (d) => stampBrushEdgeReachOf(() => offset(d)), diameter, smallest };
  const plan = planStampFloodRuns(outline, reach);
  return { id: `${id} d${diameter} o${offset(diameter)}`, outline, reach, plan, loss: stampFloodLoss(plan.inset, plan.cell) };
})));

/** A plan's ridges, the runs whose points carry their own scale: the contour's carry none. */
const ridges = (plan: StampFloodRuns) => plan.runs.map(({ points }) => points).filter((points) => points[0].scale !== undefined);

/** How far short of `at` the plan's paint falls, px (≤ 0 where it reaches): body, contour or ridge, each at its visible offset. */
function shortfall(plan: StampFloodRuns, reach: StampFloodReach, outline: readonly StampPoint[], at: StampPoint): number {
  if (stampPolygonDistance(outline, at.x, at.y) >= plan.inset) return 0;
  let short = Infinity;
  for (const { points } of plan.runs) {
    for (let k = 0; k < points.length; k++) {
      const a = points[k], b = points[Math.min(k + 1, points.length - 1)];
      const ex = b.x - a.x, ey = b.y - a.y;
      const t = Math.min(1, Math.max(0, ((at.x - a.x) * ex + (at.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
      const scale = (a.scale ?? 1) + ((b.scale ?? 1) - (a.scale ?? 1)) * t;
      short = Math.min(short, Math.hypot(at.x - a.x - ex * t, at.y - a.y - ey * t) - reach.offset(reach.diameter * scale));
    }
  }
  return short;
}

/** Whether a disc inside `outline` at least `radius` px holds `at`: what a brush that narrows no further can paint. */
function paintable(outline: readonly StampPoint[], at: StampPoint, radius: number): boolean {
  const most = 2 * radius + 2;
  for (let dy = -most; dy <= most; dy += 0.5) {
    for (let dx = -most; dx <= most; dx += 0.5) {
      if (Math.hypot(dx, dy) <= Math.min(most, stampPolygonDistance(outline, at.x + dx, at.y + dy)) && stampPolygonDistance(outline, at.x + dx, at.y + dy) >= radius) return true;
    }
  }
  return false;
}

test("a flood's runs reach every part of a narrow shape its brush's smallest stroke fits in, short of its outline by no more than the plan's loss", () => {
  for (const { id, outline, reach, plan, loss } of plans()) {
    const smallestOffset = reach.offset(reach.smallest), tolerance = loss + plan.cell / 2;
    let worst = -Infinity;
    for (let y = 0; y < 290; y += 1) for (let x = 0; x < 200; x += 1) {
      if (stampPolygonDistance(outline, x, y) <= 0) continue;
      const short = shortfall(plan, reach, outline, { x, y });
      if (short > tolerance && paintable(outline, { x, y }, smallestOffset)) worst = Math.max(worst, short);
    }
    // Half a cell over: the grid's corners and junctions are placed to within it.
    assert.ok(worst <= tolerance, `${id}: falls ${worst.toFixed(2)} px short, loss ${loss.toFixed(2)}`);
  }
});

test('a ridge runs down the medial axis: no step off it brings the outline farther than the step', () => {
  for (const { id, outline, plan } of plans()) {
    for (const points of ridges(plan)) {
      for (const p of points) {
        // A tip's last two cells are carried straight on past where the grid finds the axis.
        if (stampPolygonDistance(outline, p.x, p.y) <= 2 * plan.cell) continue;
        // Off the axis by more than `step`, some step of it is wholly uphill: the inscribed disc grows by the step.
        const r = stampPolygonDistance(outline, p.x, p.y), step = Math.max(1, 0.25 * r);
        const climb = Math.max(...Array.from({ length: 32 }, (_, k) => stampPolygonDistance(outline, p.x + step * Math.cos(k * Math.PI / 16), p.y + step * Math.sin(k * Math.PI / 16)))) - r;
        assert.ok(climb < 0.95 * step, `${id}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) r ${r.toFixed(2)} climbs ${climb.toFixed(2)} in ${step.toFixed(2)}`);
      }
    }
  }
});

test('no ridge spur is kept that adds less than the loss past the paint it hangs from', () => {
  for (const { id, outline, reach, plan, loss } of plans()) {
    const all = ridges(plan);
    // An end is free unless another ridge shares it (a junction) or it sits at the contour's depth (its pinch).
    const free = (p: StampPoint, own: StampPoint[]) => Math.abs(stampPolygonDistance(outline, p.x, p.y) - plan.inset) > 1e-3
      && !all.some((other) => other !== own && other.some((q) => q.x === p.x && q.y === p.y));
    for (const points of all) {
      const first = points[0], last = points.at(-1)!;
      if (first === last || (first.x === last.x && first.y === last.y)) continue;
      // A spur: one end free, the other on a junction or the contour's pinch, which paints at least its own radius.
      if (free(first, points) === free(last, points)) continue;
      const [from, to] = free(first, points) ? [last, points] : [first, points.toReversed()];
      const base = Math.min(reach.offset(reach.diameter), Math.max(stampPolygonDistance(outline, from.x, from.y), reach.offset(reach.smallest)));
      const adds = Math.max(...to.map((p) => Math.hypot(p.x - from.x, p.y - from.y) + stampPolygonDistance(outline, p.x, p.y))) - base;
      assert.ok(adds >= loss, `${id}: a spur adding ${adds.toFixed(2)} px, loss ${loss.toFixed(2)}`);
    }
  }
});

test("no run lays paint past the outline: each point's visible offset is within its distance from it", () => {
  for (const { id, outline, reach, plan } of plans()) {
    for (const { points } of plan.runs) {
      for (const p of points) {
        const past = reach.offset(reach.diameter * (p.scale ?? 1)) - stampPolygonDistance(outline, p.x, p.y);
        assert.ok(past <= plan.cell / 2, `${id}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) paints ${past.toFixed(2)} px past the outline`);
      }
    }
  }
});
