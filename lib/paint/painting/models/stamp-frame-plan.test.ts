import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampFramePlan, stampGroupEvents } from './stamp-frame-plan.ts';
import { stampPaintEvents } from './stamp-paint-events.ts';
import { compileStampPaintRecipe, stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintFrameState } from './stamp-paint-frame-state.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';

const brush: StampBrush = {
  name: 'Round',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25,
  stepping: 'spread',
  dynamics: stampLinearDynamics({}),
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 1,
};
const ink: PaintMaterial = { kind: 'color', color: '#203040' };

/** A still ground, then a boat sailing 100 px right from 1 s to 3 s, each two strokes. */
const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => {
  paint.group('ground', { composite: 'glaze', opacity: 1 }, (group) => group.pass('wash', {}, (pass) => {
    pass.stroke('a', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 0 }, { x: 50, y: 0 }] });
    pass.stroke('b', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 20 }, { x: 50, y: 20 }] });
  }));
  paint.group('boat', { composite: 'opaque', motion: { keys: [{ at: 1, x: 0, y: 0 }, { at: 3, x: 100, y: 0 }] } }, (group) => group.pass('hull', {}, (pass) => {
    pass.stroke('a', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 50 }, { x: 50, y: 50 }] });
    pass.stroke('b', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 60 }, { x: 50, y: 60 }] });
  }));
}));
const planAt = (t: number) => stampFramePlan(painting, stampGroupEvents(painting), stampPaintEvents(painting), t, 30);

test('a moving group\'s checkpoints are saved only where another frame would restore them', () => {
  const sailing = planAt(2), laid = 4, partway = 3, ground = 2;
  // While it sails, the boat is saved painted, not laid, which every sailing frame shares; the ground never moves.
  assert.deepEqual([...sailing.checkpointSaves(0)].toSorted((a, b) => a - b), [ground, laid]);
  assert.equal(sailing.checkpointKey(partway), planAt(2.5).checkpointKey(partway));
  assert.equal(sailing.checkpointKey(laid), planAt(2.5).checkpointKey(laid));
  assert.notEqual(sailing.checkpointKey(laid), planAt(3.5).checkpointKey(laid));
  // Moored past its last key, every frame has it in the same place.
  assert.deepEqual([...planAt(3.5).checkpointSaves(0)].toSorted((a, b) => a - b), [ground, laid]);
  assert.equal(planAt(3.5).checkpointKey(laid), planAt(9).checkpointKey(laid));
});

/** A ground, a sac whose stroke lies at `sacY`, and a sky after it, each one stroke. */
const sacPainting = (sacY = 50, sacStroke = 'a') => compileStampPaintRecipe(stampPaintRecipe((paint) => {
  paint.group('ground', { composite: 'glaze', opacity: 1 }, (group) => group.pass('wash', {}, (pass) => pass.stroke('a', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 0 }, { x: 50, y: 0 }] })));
  paint.group('sac', { composite: 'glaze', opacity: 1 }, (group) => group.pass('body', {}, (pass) => {
    pass.stroke(sacStroke, { brush, material: ink, diameter: 10, path: [{ x: 0, y: sacY }, { x: 50, y: sacY }] });
  }));
  paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.pass('wash', {}, (pass) => pass.stroke('a', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 90 }, { x: 50, y: 90 }] })));
}));

const puffed = (by: number): StampPaintFrameState => new Map([['sac', { warp: { map: (p) => ({ x: p.x, y: p.y * by }), key: `puff ${by}` } }]]);

test('a group warped by its frame state is keyed by its warp\'s key, and its paint shared whatever the warp', () => {
  const sac = sacPainting();
  const at = (state?: StampPaintFrameState) => stampFramePlan(sac, stampGroupEvents(sac), stampPaintEvents(sac), 1, 30, state);
  const ground = 1, sacPainted = 2, all = 3;
  assert.equal(at(puffed(1.5)).checkpointKey(all), at(puffed(1.5)).checkpointKey(all));
  assert.notEqual(at(puffed(1.5)).checkpointKey(all), at(puffed(2)).checkpointKey(all));
  assert.notEqual(at().checkpointKey(all), at(puffed(1.5)).checkpointKey(all));
  // Warped, it's saved painted, not laid, which every warp shares; nothing after its lay is kept.
  assert.equal(at(puffed(1.5)).checkpointKey(sacPainted), at(puffed(2)).checkpointKey(sacPainted));
  assert.deepEqual([...at(puffed(1.5)).checkpointSaves(0)].toSorted((a, b) => a - b), [ground, sacPainted]);
});

test('a live group is kept under its marks\' key, so a frame held at that key restores it', () => {
  const sac = sacPainting(), posed = (y: number) => sacPainting(y).groups[1];
  const live = (y: number): StampPaintFrameState => new Map([['sac', { live: { marks: posed(y), key: `pose ${y}` } }]]);
  const at = (state?: StampPaintFrameState) => stampFramePlan(sac, stampGroupEvents(sac), stampPaintEvents(sac), 1, 30, state);
  const ground = 1, all = 3;
  assert.notEqual(at(live(60)).checkpointKey(all), at(live(70)).checkpointKey(all));
  assert.equal(at(live(60)).checkpointKey(ground), at().checkpointKey(ground));
  // Saved before it and after it, under its key: a frame on twos holding pose 60 restores the whole painting.
  assert.deepEqual([...at(live(60)).checkpointSaves(0)].toSorted((a, b) => a - b), [ground, all]);
  assert.equal(at(live(60)).checkpointKey(all), at(new Map([['sac', { live: { marks: posed(60), key: 'pose 60' } }]])).checkpointKey(all));
  // Marks that aren't the group re-placed can't stand in for it.
  assert.throws(() => at(new Map([['sac', { live: { marks: sacPainting(60, 'b').groups[1], key: 'renamed' } }]])), /isn't sac\/body\/a as written/);
  assert.throws(() => at(new Map([['moon', { visibility: 0.5 }]])), /no group of/);
});
