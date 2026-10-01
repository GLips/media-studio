import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampGroupSceneFromLayer } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { buildPaintMotion, paintMotionFrameAt, paintMotionPlay, type PaintMotionNode } from './paint-motion-frame.ts';
import type { PaintPoseClip } from './paint-motion-clips.ts';

const box = { x0: 0, y0: 0, x1: 400, y1: 400 };
const body = { id: 'frog', box, clock: [{ kind: 'hold', frames: 2 }], pins: { chest: { at: { x: 200, y: 200 }, reach: 150 } } } satisfies PaintMotionNode<'chest'>;
const ink = { id: 'frog/ink', parent: 'frog', box, marks: { boil: { every: 2 } }, revealEnd: 0.5 } satisfies PaintMotionNode;
const puff: PaintPoseClip<'chest'> = { kind: 'poses', keys: [{ at: 0, pose: {} }, { at: 0.4, pose: { chest: { scale: 1.3 } }, ease: 'out' }, { at: 1, pose: {} }] };

test('a frame is the same in any order, and render frames inside one hold share keys and maps', () => {
  const { motion, problems } = buildPaintMotion({ nodes: [body, ink], plays: [paintMotionPlay(body, puff, { clock: [{ kind: 'at', start: 0.1 }, { kind: 'loop', period: 1, mode: 'repeat' }], origin: 'puff' })], foldCheck: { from: 0, to: 3 } });
  assert.deepEqual(problems, []);
  const probe = { x: 260, y: 180 };
  const read = (t: number) => [...paintMotionFrameAt(motion, t).state].map(([id, s]) => `${id} ${s.warp?.key} ${JSON.stringify(s.warp?.map(probe))}`).join('\n');
  const times = Array.from({ length: 90 }, (_, i) => i / 30);
  const forwards = times.map(read);
  // A fixed shuffle: every 37th frame round the ring.
  times.map((_, i) => (i * 37) % times.length).forEach((i) => assert.equal(read(times[i]), forwards[i]));
  // At 30 fps, 0.8 s and 0.81 s fall in one hold step (animation frames 19 and 19, held on twos to 18).
  assert.equal(read(0.8), read(0.81));
  const ink1 = paintMotionFrameAt(motion, 0.8).state.get('frog/ink')!.warp!;
  assert.match(ink1.key, /^~wobble3\|frog\{chest=/, 'the ink wobbles in its rest space, then bends with the body');
  assert.equal(paintMotionFrameAt(motion, 0.4).state.get('frog/ink')?.warp?.key.includes('wobble'), false, 'it boils only after its reveal ends');
});

test('a node bends by its own warp first, then its ancestors\', and placements compose about their pivots', () => {
  const parent = { id: 'p', box, pivot: { x: 100, y: 0 }, pins: { all: { at: { x: 0, y: 0 }, reach: 1e6 } } } satisfies PaintMotionNode<'all'>;
  const child = { id: 'p/c', parent: 'p', box, pivot: { x: 0, y: 50 }, pins: { all: { at: { x: 0, y: 0 }, reach: 1e6 } } } satisfies PaintMotionNode<'all'>;
  const clock = [{ kind: 'at', start: 0 }] as const;
  const { motion, problems } = buildPaintMotion({
    nodes: [parent, child],
    plays: [
      paintMotionPlay(child, { kind: 'poses', keys: [{ at: 0, pose: { all: { scale: 2 } } }] }, { clock, origin: 'grow' }),
      paintMotionPlay(parent, { kind: 'poses', keys: [{ at: 0, pose: { all: { x: 10 } } }] }, { clock, origin: 'shift' }),
      paintMotionPlay(child, { kind: 'place', keys: [{ at: 0, x: 0, y: 0, rotation: Math.PI / 2 }] }, { clock, origin: 'turn' }),
      paintMotionPlay(parent, { kind: 'place', keys: [{ at: 0, x: 5, y: 0, scale: 3 }] }, { clock, origin: 'zoom' }),
    ],
  });
  assert.deepEqual(problems, []);
  const state = paintMotionFrameAt(motion, 0).state.get('p/c')!;
  // Own scale ×2 about the origin, then the parent's 10 px shift: (10, 0) → (20, 0) → (30, 0). The other way, (40, 0).
  const bent = state.warp!.map({ x: 10, y: 0 });
  assert.ok(Math.abs(bent.x - 30) < 1e-6 && Math.abs(bent.y) < 1e-6, `${bent.x}, ${bent.y}`);
  assert.deepEqual(state.pivot, child.pivot);
  const placed = stampGroupSceneFromLayer(state.placement!, { x: 7, y: 3 }, state.pivot);
  const twice = stampGroupSceneFromLayer({ x: 5, y: 0, rotation: 0, scale: 3 }, stampGroupSceneFromLayer({ x: 0, y: 0, rotation: Math.PI / 2, scale: 1 }, { x: 7, y: 3 }, child.pivot), parent.pivot);
  assert.ok(Math.hypot(placed.x - twice.x, placed.y - twice.y) < 1e-9);
});

test('the build names conflicts, missing pins, keys out of order, a hold in seconds and a pose that folds', () => {
  const { problems } = buildPaintMotion({
    nodes: [body],
    plays: [
      paintMotionPlay(body, puff, { clock: [{ kind: 'at', start: 0 }, { kind: 'loop', period: 1, mode: 'repeat' }], origin: 'puff' }),
      paintMotionPlay(body, { kind: 'breathe', pin: 'chest', amount: 0.02, period: 3 }, { clock: [{ kind: 'at', start: 2 }], origin: 'breath' }),
      // SAFETY: a pin the node lacks, as a scene written without the types would name it.
      paintMotionPlay(body, { kind: 'breathe', pin: 'throat' as 'chest', amount: 0.1, period: 2 }, { clock: [], origin: 'gulp' }),
      paintMotionPlay(body, { kind: 'poses', keys: [{ at: 1, pose: {} }, { at: 0.5, pose: {} }] }, { clock: [{ kind: 'hold', frames: 1.5 }], origin: 'jumbled' }),
    ],
  });
  assert.deepEqual(problems.slice(0, 4), [
    'gulp moves pins \'throat\', which frog doesn\'t have',
    'jumbled: its keys need increasing times; key 1 is at 0.5s after 1s',
    'jumbled: its hold is 1.5 frames, not a whole number from 1',
    'breath writes deform on frog#pin:chest from 2s while puff still does (without end)',
  ]);
  const shove: PaintPoseClip<'chest'> = { kind: 'poses', keys: [{ at: 0, pose: {} }, { at: 1, pose: { chest: { x: 140 } } }] };
  const folds = buildPaintMotion({ nodes: [body], plays: [paintMotionPlay(body, shove, { clock: [], origin: 'shove' })], foldCheck: { from: 0, to: 1 } }).problems;
  assert.equal(folds.length, 1);
  assert.match(folds[0], /^frog: at 0\.\d+s its warp folds near .*frog's pin 'chest' moves paint there most/);
});
