import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Result } from 'effect';
import { applyLibraryFlagOp, emptyLibraryFlagsFile, libraryFlagBeside, libraryFlagsInOrder, type LibraryFlag, type LibraryFlagOp, type LibraryFlagsFile } from './library-flags.ts';

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

test('a removed flag restored comes back as it was, under its own id, and only once', () => {
  const ctx = { by: 'reviewer' as const, now: '2026-11-24T00:00:00Z', durationSeconds: 60 };
  const apply = (file: LibraryFlagsFile, op: LibraryFlagOp) => {
    const applied = applyLibraryFlagOp(file, op, ctx);
    assert.ok(Result.isSuccess(applied));
    return applied.success.file;
  };
  const one = apply(emptyLibraryFlagsFile(), { op: 'flag.add', start: 5, end: 7, note: 'the good take' });
  const two = apply(one, { op: 'flag.add', start: 9, end: 9 });
  const removed = two.flags[0];
  const back = apply(apply(two, { op: 'flag.remove', id: removed.id }), { op: 'flag.restore', flag: removed });
  assert.deepEqual(back.flags.find((f) => f.id === removed.id), { ...removed, rev: back.revision });
  assert.equal(back.nextId, two.nextId);
  assert.ok(Result.isFailure(applyLibraryFlagOp(back, { op: 'flag.restore', flag: removed }, ctx)), 'restored twice');
  assert.ok(Result.isFailure(applyLibraryFlagOp(back, { op: 'flag.restore', flag: { ...removed, id: 99 } }, ctx)), 'an id never issued');
});
