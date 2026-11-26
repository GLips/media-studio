import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotBlockMotionProblem, shotEffectPacking, shotMotionLead } from './shot-effect-gpu.ts';

const film = (texture: number) => ({ texture, kind: 'film' as const, taken: 1 as const, emission: null, box: { x: 0, y: 0, w: 8, h: 12 } });

test('24 reads of held pictures use only their distinct bindings and leave missing drawings clear', () => {
  const reads = Array.from({ length: 24 }, (_, i) => i === 0 ? null : film(i % 16));
  const { bindings, direct, overflow } = shotEffectPacking(reads);
  assert.deepEqual([direct.length, overflow.length, bindings[0]], [16, 0, null]);
  assert.deepEqual(bindings[1], bindings[17]);
  assert.notDeepEqual(bindings[1], bindings[2]);
});

test('overflow copies just the film layers read, including emission at its own offset for paper and film', () => {
  const pictures = [...Array.from({ length: 15 }, (_, i) => film(i)), { ...film(15), emission: 2 },
    { ...film(16), kind: 'paper' as const, taken: null, emission: 1 }, film(17)];
  const { bindings, direct, overflow, layers } = shotEffectPacking([...pictures, pictures[15]]);
  assert.equal(direct.length, 15);
  assert.deepEqual(overflow.map(({ layer, count }) => [layer, count]), [[0, 3], [3, 2], [5, 2]]);
  assert.equal(layers, 7);
  assert.deepEqual(bindings.slice(15).map((read) => [read?.binding, read?.layer, read?.emission, read?.paper]),
    [[15, 0, 2, false], [15, 3, 1, true], [15, 5, null, false], [15, 0, 2, false]]);
});

test('motion searches use declared reads and align blocks independently of crop and stage margin', () => {
  const motion = { current: 0, previous: 1, blockPx: 32, stepPx: 4 };
  assert.equal(shotBlockMotionProblem(motion, 2), null);
  assert.match(shotBlockMotionProblem(motion, 1)!, /reads/);
  assert.match(shotBlockMotionProblem({ ...motion, blockPx: 20 }, 2)!, /multiple/);
  assert.match(shotBlockMotionProblem({ ...motion, stepPx: 0 }, 2)!, /positive/);
  for (const margin of [0, 3, 13]) {
    for (const crop of [0, 3, 15, 38]) {
      const lead = shotMotionLead(crop, margin);
      assert.ok(lead >= 0 && lead < 8);
      assert.equal(crop - margin - lead, 8 * Math.floor((crop - margin) / 8));
    }
  }
});
