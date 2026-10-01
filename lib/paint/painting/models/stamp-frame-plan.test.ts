import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampFramePlan } from './stamp-frame-plan.ts';
import { stampOutsideLayerPlaces } from './stamp-outside-layer.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import { compileStampPaintRecipe } from './stamp-paint-recipe-compile.ts';
import type { StampPaintFrameState } from './stamp-paint-frame-state.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';

const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };

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
const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => {
  paint.group('ground', { composite: 'glaze', opacity: 1 }, (group) => group.passage('wash', { wetHistory: false }, (pass) => {
    pass.stroke('a', { brush, well: { paint: ink }, size: 10, path: [{ x: 0, y: 0 }, { x: 50, y: 0 }] });
    pass.stroke('b', { brush, well: { paint: ink }, size: 10, path: [{ x: 0, y: 20 }, { x: 50, y: 20 }] });
  }));
  paint.group('boat', { composite: 'opaque', motion: { keys: [{ at: 1, x: 0, y: 0 }, { at: 3, x: 100, y: 0 }] } }, (group) => group.passage('hull', { wetHistory: false }, (pass) => {
    pass.stroke('a', { brush, well: { paint: ink }, size: 10, path: [{ x: 0, y: 50 }, { x: 50, y: 50 }] });
    pass.stroke('b', { brush, well: { paint: ink }, size: 10, path: [{ x: 0, y: 60 }, { x: 50, y: 60 }] });
  }));
}));
const planAt = (t: number, state?: StampPaintFrameState) => stampFramePlan(painting, t, state);
test("a group's recipe motion is its lay, and a lay given as well is an error, not a second move", () => {
  assert.deepEqual(planAt(2).groups[1].lay?.placement, { x: 50, y: 0, rotation: 0, scale: 1 });
  assert.throws(() => planAt(2, new Map([['boat', { lay: { placement: { x: 1, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } }]])), /boat's frame state gives its lay, and so does its recipe/);
});

/** A ground, a sac whose stroke lies at `sacY`, and a sky after it, each one stroke; the sky boiling when `boil`. */
const sacPainting = (sacY = 50, sacStroke = 'a', boil = false) => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => {
  paint.group('ground', { composite: 'glaze', opacity: 1 }, (group) => group.passage('wash', { wetHistory: false }, (pass) => pass.stroke('a', { brush, well: { paint: ink }, size: 10, path: [{ x: 0, y: 0 }, { x: 50, y: 0 }] })));
  paint.group('sac', { composite: 'glaze', opacity: 1 }, (group) => group.passage('body', { wetHistory: false }, (pass) => {
    pass.stroke(sacStroke, { brush, well: { paint: ink }, size: 10, path: [{ x: 0, y: sacY }, { x: 50, y: sacY }] });
  }));
  paint.group('sky', { composite: 'glaze', opacity: 1, ...(boil && { boil: { every: 2 } }) }, (group) => group.passage('wash', { wetHistory: false }, (pass) => pass.stroke('a', { brush, well: { paint: ink }, size: 10, path: [{ x: 0, y: 90 }, { x: 50, y: 90 }] })));
}));

test('a recipe boil counts animation frames, and marks given replace it, epoch 0 drawing as written', () => {
  const sac = sacPainting(50, 'a', true);
  const at = (t: number, state?: StampPaintFrameState) => stampFramePlan(sac, t, state).groups[2].marks;
  // On twos at 24 fps: 1/24 s is still epoch 0, 2/24 s epoch 1, whatever the render's rate.
  assert.deepEqual([at(1 / 24), at(2 / 24), at(1)], [{ kind: 'written', epoch: 0 }, { kind: 'written', epoch: 1 }, { kind: 'written', epoch: 12 }]);
  assert.deepEqual(at(1, new Map([['sky', { marks: { kind: 'written', epoch: 0 } }]])), { kind: 'written', epoch: 0 });
  assert.throws(() => at(1, new Map([['sac', { marks: { kind: 'written', epoch: 2 } }]])), /past 0 for a group compiled with a boil/);
});

test("a live group's film is keyed by its marks' key, and marks that aren't the group re-placed are refused", () => {
  const sac = sacPainting(), posed = (y: number) => sacPainting(y).groups[1];
  const live = (y: number): StampPaintFrameState => new Map([['sac', { marks: { kind: 'live', marks: posed(y), key: `pose ${y}` } }]]);
  const at = (state?: StampPaintFrameState) => stampFramePlan(sac, 1, state);
  assert.notEqual(at(live(60)).groups[1].paintKey, at(live(70)).groups[1].paintKey);
  assert.equal(at(live(60)).groups[1].paintKey, at(live(60)).groups[1].paintKey);
  assert.equal(at(new Map([['sac', { visibility: 0 }]])).groups[1].paintKey, 'hidden');
  assert.throws(() => at(new Map([['sac', { marks: { kind: 'live', marks: sacPainting(60, 'b').groups[1], key: 'renamed' } }]])), /isn't sac\/body\/a as written/);
  assert.throws(() => at(new Map([['moon', { visibility: 0.5 }]])), /no group of/);
});

test('an outside layer needs state each frame, and is keyed by its content', () => {
  const sac = sacPainting();
  const places = stampOutsideLayerPlaces(sac, [{ id: 'card', beneath: 'sky' }]);
  const at = (content: string, visibility = 1) => stampFramePlan(sac, 1, undefined, { places, state: new Map([['card', { content, visibility }]]) });
  assert.notEqual(at('turn 0.1').outside[0].key, at('turn 0.2').outside[0].key);
  assert.equal(at('turn 0.1', 0).outside[0].key, at('turn 0.2', 0).outside[0].key);
  assert.throws(() => stampFramePlan(sac, 1, undefined, { places, state: new Map() }), /card has no state this frame/);
  assert.throws(() => stampOutsideLayerPlaces(sac, [{ id: 'card', beneath: 'sea' }]), /no group of/);
});

test("a group's defocus and glow are checked, a glow of amount 0 drawn as none", () => {
  const sac = sacPainting(), sacPlan = (state: StampPaintFrameState) => stampFramePlan(sac, 9, state);
  const glow = { amount: 1, sigma: 4, threshold: 0.5 };
  assert.equal(sacPlan(new Map([['sac', { glow: { ...glow, amount: 0 } }]])).groups[1].glow, null);
  assert.throws(() => sacPlan(new Map([['sac', { defocus: -1 }]])), /sac's defocus is -1/);
  assert.throws(() => sacPlan(new Map([['sac', { glow: { ...glow, threshold: 2 } }]])), /sac's glow/);
});
