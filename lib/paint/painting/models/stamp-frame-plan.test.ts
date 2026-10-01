import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampFramePlan, stampGroupEvents } from './stamp-frame-plan.ts';
import { stampPaintEvents } from './stamp-paint-events.ts';
import { stampOutsideLayerPlaces } from './stamp-outside-layer.ts';
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
const planAt = (t: number, state?: StampPaintFrameState) => stampFramePlan(painting, stampGroupEvents(painting), stampPaintEvents(painting), t, state);
const savesOf = (plan: ReturnType<typeof planAt>) => [...plan.checkpointSaves(0)].toSorted(([a], [b]) => a - b);

test('a moving group is saved painted, not laid, which every frame laying it shares; the frames after it by their keys', () => {
  const ground = 2, boat = 4;
  // The ground is saved laid, before the first group with frame state; the boat at its end painted (in its group).
  assert.deepEqual(savesOf(planAt(2)), [[ground, false], [boat, true]]);
  assert.equal(planAt(2).checkpointKey(boat), planAt(2.5).checkpointKey(boat));
  assert.equal(planAt(3.5).checkpointKey(boat), planAt(9).checkpointKey(boat));
  // Its recipe's motion is its lay: a lay given as well is an error, not a second move.
  assert.throws(() => planAt(2, new Map([['boat', { lay: { placement: { x: 1, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } }]])), /boat's frame state gives its lay, and so does its recipe/);
});

/** A ground, a sac whose stroke lies at `sacY`, and a sky after it, each one stroke; the sky boiling when `boil`. */
const sacPainting = (sacY = 50, sacStroke = 'a', boil = false) => compileStampPaintRecipe(stampPaintRecipe((paint) => {
  paint.group('ground', { composite: 'glaze', opacity: 1 }, (group) => group.pass('wash', {}, (pass) => pass.stroke('a', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 0 }, { x: 50, y: 0 }] })));
  paint.group('sac', { composite: 'glaze', opacity: 1 }, (group) => group.pass('body', {}, (pass) => {
    pass.stroke(sacStroke, { brush, material: ink, diameter: 10, path: [{ x: 0, y: sacY }, { x: 50, y: sacY }] });
  }));
  paint.group('sky', { composite: 'glaze', opacity: 1, ...(boil && { boil: { every: 2 } }) }, (group) => group.pass('wash', {}, (pass) => pass.stroke('a', { brush, material: ink, diameter: 10, path: [{ x: 0, y: 90 }, { x: 50, y: 90 }] })));
}));

const puffed = (by: number): StampPaintFrameState => new Map([['sac', { warp: { map: (p) => ({ x: p.x, y: p.y * by }), key: `puff ${by}` } }]]);

test('a frame held at its warp\'s key restores the whole painting; a new warp shares the warped group painted', () => {
  const sac = sacPainting();
  const at = (state?: StampPaintFrameState) => stampFramePlan(sac, stampGroupEvents(sac), stampPaintEvents(sac), 1, state);
  const ground = 1, sacPainted = 2, all = 3;
  assert.equal(at(puffed(1.5)).checkpointKey(all), at(puffed(1.5)).checkpointKey(all));
  assert.notEqual(at(puffed(1.5)).checkpointKey(all), at(puffed(2)).checkpointKey(all));
  assert.notEqual(at().checkpointKey(all), at(puffed(1.5)).checkpointKey(all));
  assert.equal(at(puffed(1.5)).checkpointKey(sacPainted), at(puffed(2)).checkpointKey(sacPainted));
  assert.deepEqual([...at(puffed(1.5)).checkpointSaves(0)].toSorted(([a], [b]) => a - b), [[ground, false], [sacPainted, true], [all, false]]);
  // Hidden, it's keyed as nothing drawn, and the frames after it are saved still.
  const hidden = at(new Map([['sac', { visibility: 0 }]]));
  assert.equal(hidden.checkpointKey(all), at(new Map([['sac', { visibility: 0, warp: { map: (p) => p, key: 'other' } }]])).checkpointKey(all));
  assert.deepEqual([...hidden.checkpointSaves(0)].toSorted(([a], [b]) => a - b), [[ground, false], [all, false]]);
});

test('a recipe boil counts animation frames, and marks given replace it, epoch 0 drawing as written', () => {
  const sac = sacPainting(50, 'a', true);
  const at = (t: number, state?: StampPaintFrameState) => stampFramePlan(sac, stampGroupEvents(sac), stampPaintEvents(sac), t, state).groups[2].marks;
  // On twos at 24 fps: 1/24 s is still epoch 0, 2/24 s epoch 1, whatever the render's rate.
  assert.deepEqual([at(1 / 24), at(2 / 24), at(1)], [{ kind: 'written', epoch: 0 }, { kind: 'written', epoch: 1 }, { kind: 'written', epoch: 12 }]);
  assert.deepEqual(at(1, new Map([['sky', { marks: { kind: 'written', epoch: 0 } }]])), { kind: 'written', epoch: 0 });
  assert.throws(() => at(1, new Map([['sac', { marks: { kind: 'written', epoch: 2 } }]])), /past 0 for a group compiled with a boil/);
});

test('a live group is kept under its marks\' key, so a frame held at that key restores it', () => {
  const sac = sacPainting(), posed = (y: number) => sacPainting(y).groups[1];
  const live = (y: number): StampPaintFrameState => new Map([['sac', { marks: { kind: 'live', marks: posed(y), key: `pose ${y}` } }]]);
  const at = (state?: StampPaintFrameState) => stampFramePlan(sac, stampGroupEvents(sac), stampPaintEvents(sac), 1, state);
  const ground = 1, all = 3;
  assert.notEqual(at(live(60)).checkpointKey(all), at(live(70)).checkpointKey(all));
  assert.equal(at(live(60)).checkpointKey(ground), at().checkpointKey(ground));
  // Saved before it and after it, under its key: a frame on twos holding pose 60 restores the whole painting.
  assert.deepEqual([...at(live(60)).checkpointSaves(0)].toSorted(([a], [b]) => a - b), [[ground, false], [all, false]]);
  assert.equal(at(live(60)).checkpointKey(all), at(live(60)).checkpointKey(all));
  // Marks that aren't the group re-placed can't stand in for it.
  assert.throws(() => at(new Map([['sac', { marks: { kind: 'live', marks: sacPainting(60, 'b').groups[1], key: 'renamed' } }]])), /isn't sac\/body\/a as written/);
  assert.throws(() => at(new Map([['moon', { visibility: 0.5 }]])), /no group of/);
});

test('an outside layer is keyed into the checkpoints after it only, and what lies under it is saved', () => {
  const sac = sacPainting();
  const places = stampOutsideLayerPlaces(sac, [{ id: 'card', beneath: 'sky' }]);
  const at = (content: string, visibility = 1) => stampFramePlan(sac, stampGroupEvents(sac), stampPaintEvents(sac), 1, undefined, { places, state: new Map([['card', { content, visibility }]]) });
  const underCard = 2, all = 3;
  assert.equal(at('turn 0.1').outside[0].event, underCard);
  assert.equal(at('turn 0.1').checkpointKey(underCard), at('turn 0.2').checkpointKey(underCard));
  assert.notEqual(at('turn 0.1').checkpointKey(all), at('turn 0.2').checkpointKey(all));
  assert.equal(at('turn 0.1', 0).checkpointKey(all), at('turn 0.2', 0).checkpointKey(all));
  assert.deepEqual([...at('turn 0.1').checkpointSaves(0)].toSorted(([a], [b]) => a - b), [[underCard, false], [all, false]]);
  assert.throws(() => stampFramePlan(sac, stampGroupEvents(sac), stampPaintEvents(sac), 1, undefined, { places, state: new Map() }), /card has no state this frame/);
  assert.throws(() => stampOutsideLayerPlaces(sac, [{ id: 'card', beneath: 'sea' }]), /no group of/);
});
