import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatPoseAt } from './flat-blockout-pose.ts';

const rest = { x: 0, y: 0 };

test('a piece rests until its key, then arrives over the key\'s frames and holds', () => {
  const keys = [{ at: 30, to: { x: 100 }, over: 10 }];
  assert.deepEqual(flatPoseAt(rest, keys, 29), rest);
  assert.ok(flatPoseAt(rest, keys, 35).x > 0 && flatPoseAt(rest, keys, 35).x < 100);
  assert.deepEqual(flatPoseAt(rest, keys, 40), { x: 100, y: 0 });
  assert.deepEqual(flatPoseAt(rest, keys, 400), { x: 100, y: 0 });
});

test('keys apply in order of their frame, and one starting mid-move takes over from where the move had got to', () => {
  const keys = [{ at: 20, to: { x: 0 }, over: 10 }, { at: 0, to: { x: 100 }, over: 40 }];
  const handover = flatPoseAt(rest, keys, 20).x;
  assert.ok(handover > 0 && handover < 100);
  assert.ok(flatPoseAt(rest, keys, 25).x < handover);
  assert.equal(flatPoseAt(rest, keys, 30).x, 0);
});
