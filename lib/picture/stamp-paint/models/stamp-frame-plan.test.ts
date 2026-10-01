import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from './stamp-brush.ts';
import { stampFramePlan, stampGroupEvents } from './stamp-frame-plan.ts';
import { stampPaintEvents } from './stamp-paint-events.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type PaintMaterial } from './stamp-paint-recipe.ts';

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
  // Laid while it sails, the boat is where this frame alone has it; the ground before it never moves.
  assert.deepEqual([...sailing.checkpointSaves(0)], [ground]);
  // Partway through the boat, its layer isn't laid yet, so its placement isn't in the key.
  assert.equal(sailing.checkpointKey(partway), planAt(2.5).checkpointKey(partway));
  assert.notEqual(sailing.checkpointKey(laid), planAt(2.5).checkpointKey(laid));
  // Moored past its last key, every frame has it in the same place.
  assert.deepEqual([...planAt(3.5).checkpointSaves(0)].toSorted((a, b) => a - b), [ground, laid]);
  assert.equal(planAt(3.5).checkpointKey(laid), planAt(9).checkpointKey(laid));
});
