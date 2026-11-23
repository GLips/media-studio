import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seededScatter, type SeededScatterOptions } from './scatter.ts';

const disc: SeededScatterOptions = {
  bounds: { x0: -100, y0: -100, x1: 100, y1: 100 },
  inside: (x, y) => Math.hypot(x, y) < 100,
  count: 60,
  spacing: 12,
  seed: 'stars',
};

test('a scatter is the same every time, every item inside and at least the spacing from every other', () => {
  const items = seededScatter(disc);
  assert.deepEqual(seededScatter(disc), items);
  assert.equal(items.length, 60);
  for (const a of items) {
    assert.ok(Math.hypot(a.x, a.y) < 100, `item ${a.key} lies outside the disc`);
    assert.ok(a.r >= 0 && a.r < 1);
    for (const b of items) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 12, `items ${a.key} and ${b.key} crowd`);
  }
  assert.notDeepEqual(seededScatter({ ...disc, seed: 'crowd' }), items);
});

test('raising the count keeps every earlier item where it was', () => {
  const more = seededScatter({ ...disc, count: 120 });
  assert.deepEqual(more.filter(({ key }) => key < 60), seededScatter(disc));
});

test('a spacing too wide for the area returns fewer items rather than hanging', () => {
  const items = seededScatter({ ...disc, count: 1000, spacing: 80 });
  assert.ok(items.length > 0 && items.length < 10, `${items.length} items at spacing 80 in a disc of radius 100`);
});
