import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_BRUSH_PROFILE_PROTOCOL, stampBrushEvenEdge, stampBrushProfileSettingsHash } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { stampRoundTipFootprint, stampTipSupportOf } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { stampGroupSceneFromLayer } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampGroupOptions, StampPaintEnvironment } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintMotionPlay, type PaintMotion, type PaintMotionNode } from './paint-motion-compile.ts';
import { paintKeyed } from './paint-keyed.ts';
import type { PaintPoseClip } from './paint-motion-clips.ts';
import { paintMotionFrameAt } from './paint-motion-frame.ts';
import { buildPaintMotion, type PaintMotionBuild } from './paint-motion.ts';

const FLAT: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'flat' } };

const plain: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};
// Measured as an import would: a hard round tip's support, from 8 to 16 px.
const support = { main: stampTipSupportOf(stampRoundTipFootprint()), dual: null };
const brush: StampBrush = {
  ...plain,
  profile: {
    kind: 'measured',
    key: { protocol: STAMP_BRUSH_PROFILE_PROTOCOL, settings: stampBrushProfileSettingsHash(plain), assets: '', medium: '' },
    provenance: { adapter: 'test', browser: 'test', renderer: 'test', seeds: ['a'], measuredAt: '2026-10-01T00:00:00Z' },
    samples: [{ diameter: 8, edge: stampBrushEvenEdge(4), edgeNoise: 0, support }, { diameter: 16, edge: stampBrushEvenEdge(8), edgeNoise: 0, support }],
  },
};

/** A group painted as one diagonal stroke from `from` to `to`. */
type GroupSketch = { id: string; from: StampPoint; to: StampPoint; options?: Omit<StampGroupOptions, 'composite'> };
const paintingOf = (groups: readonly GroupSketch[]) => compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => {
  for (const { id, from, to, options } of groups) {
    const stroke = { brush, well: { paint: { kind: 'color', color: '#203040' } }, size: 10, path: [from, to] } as const;
    paint.group(id, { composite: 'opaque', ...options }, (group) => group.passage('p', {}, (pass) => pass.stroke('s', stroke)));
  }
}));
const square = (id: string, extra: Partial<GroupSketch> = {}): GroupSketch => ({ id, from: { x: 0, y: 0 }, to: { x: 400, y: 400 }, ...extra });

const built = (build: PaintMotionBuild): PaintMotion => {
  if (!build.ok) assert.fail(build.problems.join('\n'));
  return build.motion;
};
const problemsOf = (build: PaintMotionBuild) => (build.ok ? [] : build.problems);
const close = (a: StampPoint, b: StampPoint, what: string, within = 1e-6) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < within, `${what}: (${a.x}, ${a.y}) is not (${b.x}, ${b.y})`);

const body = { id: 'frog', clock: { hold: 2 }, pins: { chest: { at: { x: 200, y: 200 }, reach: 150 } } } satisfies PaintMotionNode<'chest'>;
const outline = { id: 'frog-ink', parent: 'frog', marks: { boil: { every: 2 } } } satisfies PaintMotionNode;
const puff: PaintPoseClip<'chest'> = {
  kind: 'poses', value: paintKeyed([{ at: 0, value: { chest: { scale: 1 } } }, { at: 0.4, value: { chest: { scale: 1.3 } }, curve: 'out' }, { at: 1, value: { chest: { scale: 1 } } }]),
};

test('a frame is the same in any order, render frames inside one hold share keys, and a key names one map', () => {
  const painting = paintingOf([square('frog'), square('frog-ink')]);
  const build = () => built(buildPaintMotion(painting, { nodes: [body, outline], plays: [paintMotionPlay(body, puff, { clock: { at: 0.1, loop: { period: 1 } }, origin: 'puff' })], foldCheck: { from: 0, to: 3 } }));
  const probe = { x: 260, y: 180 };
  const read = (motion: PaintMotion, t: number) => [...paintMotionFrameAt(motion, paintMoment(t))].map(([id, s]) => `${id} ${s.warp?.key} ${JSON.stringify(s.warp?.map(probe))}`).join('\n');
  const times = Array.from({ length: 90 }, (_, i) => i / 30);
  const forwards = build(), forward = times.map((t) => read(forwards, t));
  // A fresh motion read in a fixed shuffle, every 37th frame round the ring, as a render in many tabs would.
  const shuffled = build();
  times.map((_, i) => (i * 37) % times.length).forEach((i) => assert.equal(read(shuffled, times[i]), forward[i]));
  // At 30 fps, 0.8 s and 0.81 s fall in one hold step (animation frames 19 and 19, held on twos to 18).
  assert.equal(read(forwards, 0.8), read(forwards, 0.81));
  const maps = new Map<string, string>();
  for (const line of forward.flatMap((frame) => frame.split('\n'))) {
    const [id, key, at] = line.split(' ');
    assert.equal(maps.get(`${id} ${key}`) ?? at, at, `key ${key} names one map`);
    maps.set(`${id} ${key}`, at);
  }
  const wobbled = paintMotionFrameAt(forwards, paintMoment(0.8)).get('frog-ink')!.warp!;
  assert.match(wobbled.key, /^wobble\("frog-ink",9,2\.2,45\)>pins\[radial/, 'the ink wobbles in its rest space, then bends with the body');
});

test('a point goes through its own bend and placement, then its parent\'s, as a rigger nests them', () => {
  // The parent bends paint only near (300, 0): a pin there moves it 20 px right. The child is placed 300 px right.
  const parent = { id: 'p', pins: { near: { at: { x: 300, y: 0 }, reach: 100 } } } satisfies PaintMotionNode<'near'>;
  const child = { id: 'c', parent: 'p' } satisfies PaintMotionNode;
  const painting = paintingOf([square('p'), square('c', { from: { x: 0, y: 0 }, to: { x: 40, y: 0 } })]);
  const motion = built(buildPaintMotion(painting, {
    nodes: [parent, child],
    plays: [
      paintMotionPlay(parent, { kind: 'poses', value: { near: { x: 20 } } }, { clock: { at: 0 }, origin: 'nudge' }),
      paintMotionPlay(child, { kind: 'place', value: { x: 300, y: 0 } }, { clock: { at: 0 }, origin: 'carry' }),
    ],
  }));
  const state = paintMotionFrameAt(motion, paintMoment(0)).get('c')!;
  // Placed first, the child's (0, 0) lands at (300, 0), where the parent's bend takes it 20 px further.
  close(state.warp!.map({ x: 0, y: 0 }), { x: 320, y: 0 }, 'the child bends where it is placed');
  assert.equal(state.lay, undefined, 'its placement is inside the parent\'s bend, so it is in the warp');
});

test('placements outside every bend compose into one lay about the node\'s pivot', () => {
  const parent = { id: 'p', pivot: { x: 100, y: 0 }, pins: { all: { at: { x: 0, y: 0 }, reach: 1e6 } } } satisfies PaintMotionNode<'all'>;
  const child = { id: 'c', parent: 'p', pivot: { x: 0, y: 50 }, pins: { all: { at: { x: 0, y: 0 }, reach: 1e6 } } } satisfies PaintMotionNode<'all'>;
  const clock = { at: 0 };
  const motion = built(buildPaintMotion(paintingOf([square('p'), square('c')]), {
    nodes: [parent, child],
    plays: [
      paintMotionPlay(child, { kind: 'poses', value: { all: { scale: 2 } } }, { clock, origin: 'grow' }),
      paintMotionPlay(child, { kind: 'place', value: { x: 0, y: 0, rotation: Math.PI / 2 } }, { clock, origin: 'turn' }),
      paintMotionPlay(parent, { kind: 'place', value: { x: 5, y: 0, scale: 3 } }, { clock, origin: 'zoom' }),
    ],
  }));
  const state = paintMotionFrameAt(motion, paintMoment(0)).get('c')!;
  const rest = { x: 7, y: 3 };
  // The child's own scale ×2 about the origin is its warp; its turn and the parent's zoom, both rigid, its lay.
  const grown = { x: 14, y: 6 };
  close(state.warp!.map(rest), grown, 'the warp is the child\'s own bend');
  const laid = stampGroupSceneFromLayer(state.lay!.placement, grown, state.lay!.pivot);
  const twice = stampGroupSceneFromLayer({ x: 5, y: 0, rotation: 0, scale: 3 }, stampGroupSceneFromLayer({ x: 0, y: 0, rotation: Math.PI / 2, scale: 1 }, grown, child.pivot), parent.pivot);
  // A turn is rounded to a millionth of a radian, which moves paint 192 px out by 1e-4 px.
  close(laid, twice, 'the lay is the turn, then the zoom', 1e-3);
});

const beat = (direction: number) => ({ kind: 'flutter', at: { x: 0, y: 0 }, direction, least: 0.3, period: 0.5 }) as const;

test('two flutters with crossed axes give different keys for different maps, even at one spread', () => {
  // Codex's collision: one node, a flutter across x until 1 s, then one across y; equal spreads at 0.75 s and 1.75 s.
  const wings = { id: 'butterfly' } satisfies PaintMotionNode;
  const motion = built(buildPaintMotion(paintingOf([square('butterfly')]), {
    nodes: [wings],
    plays: [
      paintMotionPlay(wings, beat(0), { clock: { at: 0, until: 1 }, origin: 'across x' }),
      paintMotionPlay(wings, beat(Math.PI / 2), { clock: { at: 1 }, origin: 'across y' }),
    ],
  }));
  const [a, b] = [0.75, 1.75].map((t) => paintMotionFrameAt(motion, paintMoment(t)).get('butterfly')!.warp!);
  const probe = { x: 20, y: 30 };
  assert.notDeepEqual(a.map(probe), b.map(probe), 'the maps differ');
  assert.notEqual(a.key, b.key, 'so their keys do');
});

test('a re-seeding group always has its epoch; a stuck one over a boil is held at 0', () => {
  const reseeded = { id: 'ink', marks: { boil: { every: 2, reseed: true } } } satisfies PaintMotionNode;
  const still = { id: 'rock' } satisfies PaintMotionNode;
  const painting = paintingOf([square('ink', { options: { boil: { every: 2 } } }), square('rock', { options: { boil: { every: 2 } } })]);
  const motion = built(buildPaintMotion(painting, { nodes: [reseeded, still] }));
  assert.deepEqual(paintMotionFrameAt(motion, paintMoment(1.5)).get('ink')?.marks, { kind: 'written', epoch: 18 });
  assert.deepEqual(paintMotionFrameAt(motion, paintMoment(1.5)).get('rock')?.marks, { kind: 'written', epoch: 0 });
  const unboiled = buildPaintMotion(paintingOf([square('ink')]), { nodes: [reseeded] });
  assert.match(problemsOf(unboiled)[0], /^ink re-seeds its marks, but its group is compiled without a boil/);
});

test('a live child is posed by its own pins alone, and its parent\'s breath reaches it as its warp', () => {
  const chest = { id: 'body', pins: { chest: { at: { x: 200, y: 200 }, reach: 300 } } } satisfies PaintMotionNode<'chest'>;
  const sacAt = (scale: number) => paintingOf([{ id: 'sac', from: { x: 180, y: 260 }, to: { x: 180 + 40 * scale, y: 260 } }]).groups[0];
  const poses: string[] = [];
  const sac = {
    id: 'sac', parent: 'body', pins: { puff: { at: { x: 180, y: 260 }, reach: 80 } },
    marks: { live: (pose) => { poses.push(pose.key); return sacAt(pose.pins.puff?.scale ?? 1); } },
  } satisfies PaintMotionNode<'puff'>;
  const motion = built(buildPaintMotion(paintingOf([square('body'), { id: 'sac', from: { x: 180, y: 260 }, to: { x: 220, y: 260 } }]), {
    nodes: [chest, sac],
    plays: [
      paintMotionPlay(chest, { kind: 'breathe', pin: 'chest', amount: 0.05, period: 2 }, { clock: { at: 0 }, origin: 'breath' }),
      paintMotionPlay(sac, { kind: 'poses', value: paintKeyed([{ at: 0, value: { puff: { scale: 1 } } }, { at: 1, value: { puff: { scale: 1.9 } } }]) }, { clock: { at: 0 }, origin: 'puff' }),
    ],
  }));
  assert.equal(paintMotionFrameAt(motion, paintMoment(0)).get('sac'), undefined, 'at rest it draws as written');
  const puffed = paintMotionFrameAt(motion, paintMoment(1)).get('sac')!;
  assert.ok(puffed.marks?.kind === 'live', 'puffed, it is re-placed');
  assert.equal(puffed.marks.marks.passes[0].id, 'sac/p');
  const puffedKey = puffed.marks.key;
  assert.match(puffedKey, /^sac\{puff=0,0,0,1\.9\}$/);
  assert.match(puffed.warp!.key, /^pins\[radial\(200,200;300\)=0,0,0,1\.05\]$/, 'the breath, at its fullest, bends the sac too');
  paintMotionFrameAt(motion, paintMoment(3));
  assert.equal(poses.filter((key) => key === puffedKey).length, 1, 'each pose is compiled once');
});

test('the build names conflicts, missing pins and groups, a hold in seconds, a boil that folds and a pose that folds', () => {
  const painting = paintingOf([square('frog'), square('pond')]);
  const problems = problemsOf(buildPaintMotion(painting, {
    nodes: [body, { id: 'tadpole' }, { id: 'frog' }, { id: 'pond', marks: { boil: { every: 2, amount: 100, scale: 10 } } }],
    plays: [
      paintMotionPlay(body, puff, { clock: { at: 0, loop: { period: 1 } }, origin: 'puff' }),
      paintMotionPlay(body, { kind: 'breathe', pin: 'chest', amount: 0.02, period: 3 }, { clock: { at: 2 }, origin: 'breath' }),
      // SAFETY: a pin the node lacks, as a scene written without the types would name it.
      paintMotionPlay(body, { kind: 'breathe', pin: 'throat' as 'chest', amount: 0.1, period: 2 }, { clock: { at: 0 }, origin: 'gulp' }),
      paintMotionPlay(body, { kind: 'poses', value: {} }, { clock: { at: 0, hold: 1.5 }, origin: 'held' }),
    ],
  }));
  assert.deepEqual(problems, [
    'tadpole isn\'t a group of the painting',
    'frog is declared twice',
    'pond: its wobble of 100 px at 10 px can fold paint; keep the amount under 1.33 px at that scale',
    'gulp moves pins \'throat\', which frog doesn\'t have',
    'held: its hold is 1.5 frames, not a whole number from 1',
    'breath writes deform on frog\'s pin \'chest\' from 2s while puff still does (without end)',
  ]);
  const shove: PaintPoseClip<'chest'> = { kind: 'poses', value: paintKeyed([{ at: 0, value: { chest: { x: 0 } } }, { at: 1, value: { chest: { x: 140 } } }]) };
  const folds = problemsOf(buildPaintMotion(painting, { nodes: [body], plays: [paintMotionPlay(body, shove, { clock: { at: 0 }, origin: 'shove' })], foldCheck: { from: 0, to: 1 } }));
  assert.equal(folds.length, 1);
  assert.match(folds[0], /^frog: at 0\.\d+s its warp folds near .*frog's pin 'chest' moves paint there most/);
});
