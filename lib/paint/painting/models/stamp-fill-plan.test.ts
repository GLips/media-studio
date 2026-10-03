import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planStampFloodRuns, type StampFloodReach } from './stamp-fill-plan.ts';
import { stampBrushEdgeReachOf, type StampBrushEdgeReach } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampPolygonDistance, type StampPoint } from './stamp-region.ts';

// A flat tip held on the painting: a footprint 32 px wide and 12 tall at d40, whatever way its stroke heads.
const flatAt = (diameter: number): StampBrushEdgeReach => stampBrushEdgeReachOf((heading, side) => {
  const across = heading + (side === 'right' ? Math.PI / 2 : -Math.PI / 2);
  return (16 * Math.abs(Math.cos(across)) + 6 * Math.abs(Math.sin(across))) * (diameter / 40);
});
// An L: its inner corner turns into the footprint's way.
const ell = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 90 }, { x: 90, y: 90 }, { x: 90, y: 200 }, { x: 0, y: 200 }];

test("a flood's edge run keeps a flat tip's footprint inside, round its turns too", () => {
  const [contour] = planStampFloodRuns(ell, { offset: (d) => d / 4, edge: flatAt, diameter: 40, smallest: 4 }).runs;
  for (const { x, y } of contour.points) {
    for (const [dx, dy] of [[-16, -6], [16, -6], [16, 6], [-16, 6]]) {
      assert.ok(stampPolygonDistance(ell, x + dx, y + dy) > -0.75, `(${x.toFixed(1)}, ${y.toFixed(1)})'s footprint corner lies past the outline`);
    }
    assert.ok(Math.abs(x - 90) > 16 - 0.75 || Math.abs(y - 90) > 6 - 0.75, `(${x.toFixed(1)}, ${y.toFixed(1)})'s footprint takes in the inner corner`);
  }
});

test("a flood's edge run lies in by a flat tip's reach each way, no further: its narrow side keeps to the outline", () => {
  const [contour] = planStampFloodRuns(ell, { offset: (d) => d / 4, edge: flatAt, diameter: 40, smallest: 4 }).runs;
  const near = (side: (p: StampPoint) => number, along: (p: StampPoint) => boolean) => contour.points.filter(along).map(side);
  // Away from the turns: the left side runs 16 in, the top 6.
  for (const d of near((p) => p.x, (p) => p.x < 50 && p.y > 40 && p.y < 160)) assert.ok(Math.abs(d - 16) < 0.75, `the left side runs ${d.toFixed(2)} in`);
  for (const d of near((p) => p.y, (p) => p.y < 50 && p.x > 40 && p.x < 160)) assert.ok(Math.abs(d - 6) < 0.75, `the top runs ${d.toFixed(2)} in`);
});

test("a ridge down a strip narrower than a flat tip's wide way scales so its footprint keeps inside; the short way, it grows", () => {
  const ridgeOf = (strip: StampPoint[]) => planStampFloodRuns(strip, { offset: (d) => d / 4, edge: flatAt, diameter: 40, smallest: 4 }).runs
    .flatMap(({ points }) => points).filter(({ scale }) => scale !== undefined && scale < 1 && scale > 0.2);
  // 24 px across, up and down: the footprint's 16 px half-width fits at three quarters, a disc of the mean at 1.1.
  const upright = ridgeOf([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 300 }, { x: 0, y: 300 }]).filter(({ y }) => y > 40 && y < 260);
  assert.ok(upright.length > 20, `${upright.length} ridge points`);
  for (const p of upright) assert.ok(Math.abs(p.scale! - 0.75) < 0.05, `the upright strip's ridge at ${p.y.toFixed(0)} scales ${p.scale!.toFixed(3)}`);
  // 24 px across, side to side: the footprint's 6 px half-height fits whole, so its ridge lays at full scale.
  const lying = planStampFloodRuns([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 24 }, { x: 0, y: 24 }], { offset: (d) => d / 4, edge: flatAt, diameter: 40, smallest: 4 }).runs
    .flatMap(({ points }) => points).filter(({ x }) => x > 60 && x < 240);
  assert.ok(lying.length > 0 && lying.every(({ scale }) => (scale ?? 1) > 0.99), `the lying strip's ridge scales ${lying.map(({ scale }) => scale?.toFixed(2)).join(' ')}`);
});

/** A tip `wide` px each side and `tall` up and down, at every heading: its reach toward a direction `across`. */
const boxReach = (wide: number, tall: number): StampBrushEdgeReach => stampBrushEdgeReachOf((heading, side) => {
  const across = heading + (side === 'right' ? Math.PI / 2 : -Math.PI / 2);
  return wide * Math.abs(Math.cos(across)) + tall * Math.abs(Math.sin(across));
});
/** How far from round (d20) to flat (d40) the next test's tip is at `d`. */
const flatness = (d: number) => Math.min(1, Math.max(0, (d - 20) / 20));
const lyingStrip = (height: number) => [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: height }, { x: 0, y: height }];

test("a flood paints a strip thinner than its smallest mark's mean reach where that mark's short way fits", () => {
  // At d16 the flat tip stands 4.8 px tall: a 6 px strip holds it, though its mean reach is 5.3.
  const plan = planStampFloodRuns(lyingStrip(6), { offset: (d) => 0.332 * d, edge: flatAt, diameter: 40, smallest: 16 });
  const laid = plan.runs.flatMap(({ points }) => points).filter(({ x }) => x > 40 && x < 260);
  assert.ok(laid.length > 10, `${laid.length} points along the strip`);
  for (const { y, scale = 1 } of laid) assert.ok(Math.abs(y - 3) + 6 * scale <= 3 + 0.75, `a point at ${y.toFixed(2)}, scale ${scale.toFixed(3)}, reaches past`);
});

test("a ridge sizes its mark by the footprint at each diameter, not the full one's proportions", () => {
  // Round at d20 (4 px every way), flat at d40 (24 wide, 6 tall), between them a blend: in a 10 px strip only up to
  // about d24 fits, though the full footprint's proportions would allow far more.
  const tall = (d: number) => (1 - flatness(d)) * (d / 5) + 6 * flatness(d);
  const reach: StampFloodReach = {
    offset: (d) => (1 - flatness(d)) * (d / 5) + 19.1 * flatness(d), edge: (d) => boxReach((1 - flatness(d)) * (d / 5) + 24 * flatness(d), tall(d)), diameter: 40, smallest: 20,
  };
  const laid = planStampFloodRuns(lyingStrip(10), reach).runs.flatMap(({ points }) => points).filter(({ x }) => x > 60 && x < 240);
  assert.ok(laid.length > 10, `${laid.length} points along the strip`);
  for (const { y, scale = 1 } of laid) assert.ok(Math.abs(y - 5) + tall(40 * scale) <= 5 + 0.5, `a point at ${y.toFixed(2)}, d${(40 * scale).toFixed(2)}, reaches past`);
});

/** Reaching 16 px on its left and 6 on its right at d40, whatever way it heads. */
const lopsided = (d: number) => stampBrushEdgeReachOf((_heading, side) => ((side === 'left' ? 16 : 6) * d) / 40);

test("a flood's rows keep in by their own footprint as they head: a lopsided tip's longer side stands off the edge it faces", () => {
  const plan = planStampFloodRuns([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], { offset: (d) => (11 * d) / 40, edge: lopsided, diameter: 40, smallest: 4 });
  // Heading right (y down) its left side faces up: 16 px off the top, 6 off the bottom; heading left, the other way.
  assert.deepEqual([15, 17, 193, 195].map((y) => plan.keepsIn(100, y, 0)), [false, true, true, false]);
  assert.deepEqual([5, 7, 183, 185].map((y) => plan.keepsIn(100, y, Math.PI)), [false, true, true, false]);
});

test("a lopsided tip's rows turn their shorter side to the outline beside them, as its contour does; a row none lies beside keeps its way", () => {
  const plan = planStampFloodRuns([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], { offset: (d) => (11 * d) / 40, edge: lopsided, diameter: 40, smallest: 4 });
  // Heading right its long left side faces up, so a row by the top runs back and one by the bottom doesn't.
  const turned = (y: number) => plan.rowTurned({ x: -10, y }, { x: 210, y });
  assert.deepEqual([8, 100, 192].map(turned), [true, false, false]);
  assert.equal(plan.rowTurned({ x: 210, y: 192 }, { x: -10, y: 192 }), true);
});
