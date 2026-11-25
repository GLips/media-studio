import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioJustifiedRowsOf, studioNameGroupsOf, studioSortedBy } from './studio-collection-arrangement.ts';

const widthOf = (aspects: readonly number[], row: { indices: readonly number[]; height: number }, gap: number) =>
  row.indices.reduce((sum, i) => sum + aspects[i] * row.height, 0) + gap * (row.indices.length - 1);

test('justified rows fill the width exactly, and the last row stays at the target height', () => {
  const aspects = [16 / 9, 0.46, 1, 1.91, 0.8, 0.46, 0.46, 16 / 9, 1];
  const rows = studioJustifiedRowsOf(aspects, 1000, 200, 8);
  assert.deepEqual(rows.flatMap((r) => r.indices), aspects.map((_, i) => i));
  for (const row of rows.slice(0, -1)) assert.ok(Math.abs(widthOf(aspects, row, 8) - 1000) < 0.01);
  const last = rows.at(-1)!;
  assert.equal(last.height, 200);
  assert.ok(widthOf(aspects, last, 8) < 1000);
});

test('a picture wider than the row at the target height fills the row alone, shorter', () => {
  const rows = studioJustifiedRowsOf([1, 8, 1], 1000, 200, 8);
  const wide = rows.find((r) => r.indices.includes(1))!;
  assert.ok(wide.height < 200);
  assert.ok(Math.abs(widthOf([1, 8, 1], wide, 8) - 1000) < 0.01);
});

test('names group on their shared starts, read from the names, and sorting orders groups and members', () => {
  const stills = ['og-one-box.png', 'youtube-one-box.png', 'og-every-colour.png', 'story-one-box.png', 'youtube-every-colour.png'];
  const groups = studioNameGroupsOf(studioSortedBy(stills, 'name', (name) => ({ name })), (name) => name);
  assert.deepEqual(groups.map((g) => g.head), ['og-', 'story-', 'youtube-']);
  assert.deepEqual(groups[0].items, ['og-every-colour.png', 'og-one-box.png']);
  const fodmap = ['03-menu-appstore-iphone-card.jpg', '03-menu-appstore-iphone-detail.jpg', '02-barcode-appstore-iphone-card.jpg', '02-barcode-appstore-iphone-scene.jpg'];
  const modified = new Map(fodmap.map((name, i) => [name, i]));
  const newest = studioNameGroupsOf(studioSortedBy(fodmap, 'newest', (name) => ({ name, modified: modified.get(name) })), (name) => name);
  assert.deepEqual(newest.map((g) => g.head), ['02-barcode-appstore-iphone-', '03-menu-appstore-iphone-']);
  assert.deepEqual(newest[0].items, ['02-barcode-appstore-iphone-scene.jpg', '02-barcode-appstore-iphone-card.jpg']);
});
