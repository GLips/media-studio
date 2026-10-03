import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampBrushEdgeReachOf } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampFillMarks, stampFillStrokePath, type StampFillStrokes } from './stamp-fill-strokes.ts';
import type { StampPoint, StampRegion } from './stamp-region.ts';

const disc: StampRegion = { kind: 'ellipse', x: 200, y: 200, radiusX: 100, radiusY: 100 };
/** A 20 px brush whose paint reaches 10 px from its centreline. */
const SIZE = { diameter: 20, offset: 10, edge: stampBrushEdgeReachOf(() => 10) };
const fromCentre = ({ x, y }: StampPoint) => Math.hypot(x - 200, y - 200);

/** A guide bowed `bow` px down at its middle, from x 60 to 340 at height `y` at its ends. */
const bowed = (y: number, bow = 30): StampPoint[] => Array.from({ length: 29 }, (_, i) => {
  const x = 60 + i * 10, u = (x - 200) / 140;
  return { x, y: y + bow * (1 - u * u) };
});
/** A straight guide across the disc at height `y`, ending just outside it. */
const straight = (y: number): StampPoint[] => [{ x: 95, y }, { x: 200, y }, { x: 305, y }];
/** A guided fill over `paths`, each guide named by its first point's height. */
const guided = (paths: StampPoint[][], extra: Partial<StampFillStrokes> = {}): StampFillStrokes =>
  ({ pattern: { kind: 'guided', guides: paths.map((path) => ({ id: `at${path[0].y}`, path })) }, variation: 0, hand: {}, ...extra });

test("a contour fill rings its region in closed loops a spacing apart inward, the outer one's edge on the outline", () => {
  const marks = stampFillMarks(disc, SIZE, 0, { pattern: { kind: 'contour' }, spacing: 1.5, variation: 0, hand: {} }, 'rings');
  assert.ok(marks.length >= 3, `${marks.length} rings`);
  marks.forEach(({ path, patch }) => {
    assert.ok(Math.hypot(path[0].x - path.at(-1)!.x, path[0].y - path.at(-1)!.y) < 1, 'a ring closes');
    // Ring k's centres lie half a diameter in, then 30 px further in each ring.
    for (const point of path) assert.ok(Math.abs(fromCentre(point) - (90 - 30 * patch!)) < 2, `ring ${patch} at ${fromCentre(point).toFixed(1)}`);
  });
  // Reaching a diameter past the outline, the outer ring's centres lie there.
  const past = stampFillMarks(disc, SIZE, 0, { pattern: { kind: 'contour' }, spacing: 1.5, variation: 0, hand: {}, reach: { past: 1 } }, 'rings');
  for (const point of past.find(({ patch }) => patch === 0)!.path) assert.ok(Math.abs(fromCentre(point) - 120) < 2, `the outer ring at ${fromCentre(point).toFixed(1)}`);
});

test('a guided fill lays marks bent as its guides are, between them, ending at the outline or run past it as far as they reach', () => {
  const guides = [bowed(80), bowed(200), bowed(290)];
  const marks = stampFillMarks(disc, SIZE, 0, guided(guides), 'bowed');
  assert.ok(marks.length > 6, `${marks.length} marks`);
  for (const { path } of marks) {
    // Each mark keeps its guides' bow: the same height above the curve all along it.
    const offsets = path.map(({ x, y }) => y - 30 * (1 - ((x - 200) / 140) ** 2));
    assert.ok(Math.max(...offsets) - Math.min(...offsets) < 0.5, `a mark strays ${(Math.max(...offsets) - Math.min(...offsets)).toFixed(2)} px off its bow`);
    // Its ends are where its centre may lie, half a diameter in from the outline.
    for (const end of [path[0], path.at(-1)!]) assert.ok(Math.abs(fromCentre(end) - 90) < 1.5, `an end at ${fromCentre(end).toFixed(1)}`);
  }
  // Reaching a diameter past the outline, each mark runs on to there, though its guides end just outside the disc.
  for (const { key, path } of stampFillMarks(disc, SIZE, 0, guided([straight(150), straight(250)], { reach: { past: 1 } }), 'past')) {
    for (const end of [path[0], path.at(-1)!]) assert.ok(Math.abs(fromCentre(end) - 120) < 1.5, `${key} ends at ${fromCentre(end).toFixed(1)}`);
  }
  // A row pattern's rows run on out across the shape and along it, their centres a diameter past the outline.
  const hatch = stampFillMarks(disc, SIZE, 0, { pattern: { kind: 'hatch' }, variation: 0, hand: {}, reach: { past: 1 } }, 'rows').flatMap(({ path }) => path);
  assert.ok(Math.abs(Math.max(...hatch.map(fromCentre)) - 120) < 1.5, `a hatch reaches ${Math.max(...hatch.map(fromCentre)).toFixed(1)}`);
  assert.ok(Math.max(...hatch.map(({ y }) => y)) > 315, 'its rows run out past the bottom of the disc');
  assert.throws(() => stampFillMarks(disc, SIZE, 0, guided([bowed(80), bowed(200).slice(0, 10)]), 'short'), /ends inside the region/);
  assert.throws(() => stampFillMarks(disc, SIZE, 0, guided([bowed(80), bowed(200).toReversed()]), 'against'), /runs against/);
  const twins = { pattern: { kind: 'guided' as const, guides: [{ id: 'a', path: bowed(80) }, { id: 'a', path: bowed(200) }] }, variation: 0, hand: {} };
  assert.throws(() => stampFillMarks(disc, SIZE, 0, twins, 'twins'), /an ID of its own/);
});

test("a fill's marks keep their keys and places as guides are added, before or after, and its stroke path is its marks, lifting between", () => {
  const two = stampFillMarks(disc, SIZE, 0, guided([bowed(80), bowed(160)], { variation: 0.8, hand: { wobble: { pressure: 0.2, position: 0.1 } } }), 'kept');
  const three = stampFillMarks(disc, SIZE, 0, guided([bowed(80), bowed(160), bowed(290)], { variation: 0.8, hand: { wobble: { pressure: 0.2, position: 0.1 } } }), 'kept');
  // The first pair's marks, but for the second guide's own, which only the last pair lays.
  const firstPair = three.filter(({ patch }) => patch === 0);
  assert.ok(firstPair.length > 2);
  assert.deepEqual(two.filter(({ key }) => firstPair.some((mark) => mark.key === key)), firstPair);
  // A guide added before the others leaves their marks as they were: marks are keyed by their guides' IDs, not places.
  const before = stampFillMarks(disc, SIZE, 0, guided([bowed(40), bowed(80), bowed(160)], { variation: 0.8, hand: { wobble: { pressure: 0.2, position: 0.1 } } }), 'kept');
  assert.deepEqual(before.filter(({ key }) => two.some((mark) => mark.key === key)).map(({ key, path }) => ({ key, path })), two.map(({ key, path }) => ({ key, path })));
  assert.equal(new Set(three.map(({ key }) => key)).size, three.length);
  const path = stampFillStrokePath(disc, SIZE, 0, guided([bowed(80), bowed(160)]), 'joined');
  const marks = stampFillMarks(disc, SIZE, 0, guided([bowed(80), bowed(160)]), 'joined');
  const starts = marks.map((_, i) => marks.slice(0, i).reduce((sum, mark) => sum + mark.path.length, 0));
  assert.equal(path.length, marks.reduce((sum, mark) => sum + mark.path.length, 0));
  assert.deepEqual(path.flatMap(({ lift }, i) => (lift ? [i] : [])), starts.slice(1));
  assert.deepEqual(path.slice(starts[1] + 1, starts[2]), marks[1].path.slice(1));
});

test("a lopsided brush's rows keep in by the side facing the outline, and by its larger side where they head into it", () => {
  const square: StampRegion = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] };
  // Reaching 16 px on its left and 6 on its right; a row heading right has the top on its left.
  const lopsided = { diameter: 20, offset: 11, edge: stampBrushEdgeReachOf((_heading, side) => (side === 'left' ? 16 : 6)) };
  const points = stampFillMarks(square, lopsided, 0, { pattern: { kind: 'hatch' }, variation: 0, hand: {} }, 'rows').flatMap(({ path }) => path);
  // Ends read away from the corners, where the room's middle-of-thin-parts rule rounds them.
  const cell = 20 / 8, ys = points.map(({ y }) => y), xs = points.filter(({ y }) => y > 40 && y < 160).map(({ x }) => x);
  assert.ok(Math.abs(Math.min(...ys) - (16 + cell)) < 0.5, `the top row at ${Math.min(...ys)}`);
  assert.ok(Math.abs(Math.max(...ys) - (200 - 6 - cell)) < 0.5, `the bottom row at ${Math.max(...ys)}`);
  assert.ok(Math.min(...xs) >= 16 && Math.min(...xs) <= 16 + cell + 0.5, `the rows start at ${Math.min(...xs)}`);
  assert.ok(Math.max(...xs) <= 184 && Math.max(...xs) >= 184 - cell - 0.5, `the rows end at ${Math.max(...xs)}`);
});

test("a lopsided brush's back-and-forth rows keep its larger side in at top and bottom, whichever way each row runs", () => {
  const square: StampRegion = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] };
  const lopsided = { diameter: 20, offset: 11, edge: stampBrushEdgeReachOf((_heading, side) => (side === 'left' ? 16 : 6)) };
  const ys = stampFillMarks(square, lopsided, 0, { pattern: { kind: 'backAndForth' }, variation: 0, hand: {} }, 'serpentine').flatMap(({ path }) => path.map(({ y }) => y));
  // A row running back has its left, 16 px side, below it: the bottom row stands as far in as the top.
  assert.ok(Math.min(...ys) >= 16 - 0.5 && Math.max(...ys) <= 184 + 0.5, `rows from ${Math.min(...ys).toFixed(1)} to ${Math.max(...ys).toFixed(1)}`);
});
