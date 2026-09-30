import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glyphFieldLayout, glyphRegroupPlan, glyphWaveArrivals } from './glyph-field.ts';
import { glyphFieldFrame } from './glyph-field-frame.ts';

const FORMAT = { fps: 30, width: 1920, height: 1080, transparent: false };
const CENTER = { x: FORMAT.width / 2, y: FORMAT.height / 2 };

const lattice = () => glyphFieldLayout(19 * 11, FORMAT).map((slot) => ({ ...slot, item: null }));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('fronts reach each cell at a continuous time set by its distance along the front, never a whole frame', () => {
  const cells = lattice();
  const at = (i: number, j: number, times: number[]) => times[cells.findIndex((c) => c.i === i && c.j === j)];

  const ring = glyphWaveArrivals({ start: 1, speed: 20, clip: {} }, cells, { center: CENTER }).at;
  assert.ok(near(at(3, 4, ring), 1 + 5 / 20));
  assert.ok(near(at(1, 1, ring), 1 + Math.SQRT2 / 20), 'a diagonal neighbour is √2 pitches out, not rounded to a frame');

  const diagonal = glyphWaveArrivals({ start: 2, speed: 10, front: { angle: 45 }, clip: {} }, cells, { center: CENTER }).at;
  assert.ok(near(at(-9, -5, diagonal), 2), 'a straight front starts on the first cell it meets');
  assert.ok(near(at(4, -2, diagonal), at(-2, 4, diagonal)), 'cells on one diagonal turn together');
  assert.ok(near(at(1, 0, diagonal) - at(0, 0, diagonal), Math.SQRT1_2 / 10));

  const closing = glyphWaveArrivals({ start: 0, speed: 50, front: { inward: true }, clip: {} }, cells, { center: CENTER }).at;
  assert.ok(near(at(9, 5, closing), 0) && near(at(-9, -5, closing), 0), 'closing in starts at the corners');
  assert.equal(Math.max(...closing), at(0, 0, closing));
});

test('a later wave repaints every cell it has passed, even where an earlier front arrives after it', () => {
  const red = { fill: [{ at: 0, value: '#ff0000' }] }, blue = { fill: [{ at: 0, value: '#0000ff' }] };
  const frameAt = (t: number) => glyphFieldFrame({
    t,
    waves: [
      { start: 0, speed: 10, front: { from: { x: 60, y: 540 } }, clip: red },
      { start: 0.5, speed: 10, front: { from: { x: 1860, y: 540 } }, clip: blue },
    ],
  }, FORMAT);
  const fillAt = (t: number, i: number) => frameAt(t).cells.find((c) => c.index === glyphFieldLayout(209, FORMAT).findIndex((s) => s.i === i && s.j === 0))!.fill;
  const RED = 'rgba(255,0,0,1.000)', BLUE = 'rgba(0,0,255,1.000)';
  assert.equal(fillAt(0.9, -8), RED, 'the first strike has passed here and the second has not');
  assert.equal(fillAt(0.9, 8), BLUE);
  // The red front reaches the right edge at 1.8 s, long after the blue one repainted it: blue holds.
  assert.equal(fillAt(2.5, 9), BLUE);
  assert.ok(frameAt(3).cells.every((c) => c.fill === BLUE), 'once both have crossed, the later wave shows everywhere');
});

test('a regroup gives each kept cell its own slot, on paths that never cross, shortest leaving first', () => {
  const pick = [3, 17, 25, 40, 58, 61, 77, 90, 104, 111, 130, 142, 150, 166, 181, 199, 205];
  const from = pick.map((k) => lattice()[k]);
  const to = glyphFieldLayout(from.length, FORMAT, { columns: 6, pitch: 90 });
  const { slot, delay } = glyphRegroupPlan(from, to, 0.12);
  assert.deepEqual(slot.toSorted((a, b) => a - b), to.map((_, k) => k));

  const cross = (p1: typeof to[0], p2: typeof to[0], q1: typeof to[0], q2: typeof to[0]) => {
    const side = (a: typeof to[0], b: typeof to[0], c: typeof to[0]) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    return side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0;
  };
  for (let a = 0; a < from.length; a++) {
    for (let b = a + 1; b < from.length; b++) assert.ok(!cross(from[a], to[slot[a]], from[b], to[slot[b]]), `paths ${a} and ${b} cross`);
  }
  const length = from.map((p, k) => Math.hypot(p.x - to[slot[k]].x, p.y - to[slot[k]].y));
  const byDelay = from.map((_, k) => k).toSorted((a, b) => delay[a] - delay[b]);
  for (let k = 1; k < byDelay.length; k++) assert.ok(length[byDelay[k - 1]] <= length[byDelay[k]]);
  assert.equal(Math.min(...delay), 0);
  assert.ok(near(Math.max(...delay), 0.12));
});

test('once a filter step settles, only the kept cells show, packed on the block', () => {
  const keep = (c: { col: number; row: number }) => (c.col + 2 * c.row) % 7 === 0;
  const kept = glyphFieldLayout(209, FORMAT).filter((s) => keep(s));
  const frame = glyphFieldFrame({ t: 3, filter: [{ at: 1, keep, regroup: { columns: 5 } }] }, FORMAT);
  assert.equal(frame.cells.length, kept.length);
  const slots = new Set(glyphFieldLayout(kept.length, FORMAT, { columns: 5 }).map((s) => `${s.x},${s.y}`));
  for (const cell of frame.cells) {
    assert.equal(cell.samples.length, 1, 'settled, so drawn sharp');
    assert.ok(slots.has(`${cell.samples[0].x},${cell.samples[0].y}`));
  }
  assert.ok(near(frame.values.kept, kept.length / 209));
});
