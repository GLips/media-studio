import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryFlagBeside, libraryFlagsInOrder, type LibraryFlag } from './library-flags.ts';

const flag = (id: number, start: number, by: LibraryFlag['by']): LibraryFlag => ({ id, start, end: start + 1, by, at: '2026-11-23T00:00:00Z', rev: id });
const flags = [flag(1, 30, 'agent'), flag(2, 10, 'reviewer'), flag(3, 20, 'agent'), flag(4, 20, 'agent')];

test("stepping an author's flags goes by start, then as set, and stops at either end", () => {
  const queue = libraryFlagsInOrder(flags, 'agent');
  assert.deepEqual(queue.map((f) => f.id), [3, 4, 1]);
  assert.equal(libraryFlagBeside(queue, { flag: 4, seconds: 0 }, 1)?.id, 1);
  assert.equal(libraryFlagBeside(queue, { flag: 3, seconds: 0 }, -1), undefined);
  assert.equal(libraryFlagBeside(queue, { flag: 1, seconds: 0 }, 1), undefined);
});

test('with no flag open, a step goes to the nearest flag past the playhead that way, not one starting at it', () => {
  const queue = libraryFlagsInOrder(flags, 'all');
  assert.equal(libraryFlagBeside(queue, { seconds: 20 }, 1)?.id, 1);
  assert.equal(libraryFlagBeside(queue, { seconds: 20 }, -1)?.id, 2);
  // An open flag the filter has since hidden steps as if none were open.
  assert.equal(libraryFlagBeside(libraryFlagsInOrder(flags, 'reviewer'), { flag: 3, seconds: 5 }, 1)?.id, 2);
});
