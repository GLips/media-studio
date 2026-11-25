import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineLookCatalog } from '#lib/paint/looks/models/look-catalog.ts';
import { beatSpan, defineTimeline, fixedSpan, tempoGrid } from '#lib/timing/timeline/models/timeline.ts';
import { defineCueCharacter } from './cue-character.ts';
import { compileCueScore } from './cue-tracks.ts';

// 30 fps. Scene `a` is fixed, 4 s, with cues; scene `b` is 8 beats at 120 BPM, 4 beats a bar, right after it.
const timeline = defineTimeline({
  grid: tempoGrid(120),
  scenes: { a: fixedSpan(4, { cues: { go: 1, hit: 2 } }), b: beatSpan(8) },
});
const a = timeline.clock('a'), b = timeline.clock('b');

const puppet = defineCueCharacter(
  { arm: { angle: 0, hand: 'open' }, face: { smile: 0 }, gaze: [0, 0] as readonly [number, number] },
  {
    poses: { up: { arm: { angle: 90, hand: 'fist' } }, down: { arm: { angle: -90, hand: 'open' } } },
    expressions: { grin: { face: { smile: 1 } } },
    sliders: { smile: { path: 'face.smile', min: 0, max: 1 } },
    moves: {
      swing: { writes: ['arm.angle'], seconds: 1, markers: { hit: 0.5 }, sample: (s, entry) => ({ arm: { angle: entry.arm.angle + 100 * s } }) },
      sway: { writes: ['gaze'], sample: (s) => ({ gaze: [Math.sin(s), 0] }) },
    },
  },
);
const looks = defineLookCatalog({
  toon: { palettes: ['brand', 'night'], sampling: 'live' },
  paint: { palettes: ['warm', 'cool'], sampling: { fps: 10 } },
});
const cast = { character: puppet, looks, camera: { turn: 0 } };

test('a frame is the same whichever order frames are sampled in, and from a fresh compile', () => {
  const rows = () => compileCueScore(a, cast, [
    { at: 'go', pose: 'up', by: { ease: { seconds: 0.5 } } },
    { at: 'go', move: { name: 'sway' }, look: 'paint' },
    { at: 'hit', move: { name: 'swing', align: 'hit', rate: 2, end: { return: { ease: { frames: 6 } } } } },
    { at: { from: 'hit', offset: { seconds: 0.1 } }, expression: 'grin', by: { spring: { duration: 0.4, bounce: 0.3 } }, palette: { look: 'paint', name: 'cool' } },
    { at: { from: 'go', offset: { seconds: 0 } }, camera: { turn: 30 }, by: { ease: { seconds: 3 }, curve: 'linear' } },
  ]);
  const times = Array.from({ length: 121 }, (_, k) => k / 30 - 0.1);
  const forward = rows(), backward = rows(), shuffled = rows();
  const expected = times.map((t) => forward.sample(t));
  assert.deepEqual(times.toReversed().map((t) => backward.sample(t)).toReversed(), expected);
  const order = times.map((_, k) => (k * 37) % times.length);
  const seen = new Map(order.map((k) => [k, shuffled.sample(times[k])]));
  assert.deepEqual(times.map((_, k) => seen.get(k)), expected);
  assert.deepEqual(times.map((t) => rows().sample(t)), expected);
});

test('a move aligned on its marker lands it on the cue, plays only its own controls, and returns what no later row took', () => {
  const score = compileCueScore(a, cast, [
    { at: 'go', pose: 'up' },
    // Rate 2: the 1 s swing takes 0.5 s, its hit 0.25 s in, so it begins at 1.75 s and ends at 2.25 s.
    { at: 'hit', move: { name: 'swing', align: 'hit', rate: 2, end: { return: 'cut' } } },
    { at: { from: 'hit', offset: { seconds: 0.1 } }, expression: 'grin' },
  ]);
  assert.equal(score.sample(1.74).character.arm.angle, 90);
  assert.equal(score.sample(2).character.arm.angle, 90 + 100 * 0.5);
  assert.equal(score.sample(2).character.arm.hand, 'fist');
  assert.equal(score.sample(2.2).character.face.smile, 1);
  assert.equal(score.sample(2.3).character.arm.angle, 90);
  // A pose taken mid-move keeps its control: the return hands back only what nobody took.
  const taken = compileCueScore(a, cast, [
    { at: 'hit', move: { name: 'swing', align: 'hit', rate: 2, end: { return: 'cut' } } },
    { at: { from: 'hit', offset: { seconds: 0.1 } }, pose: 'down' },
  ]);
  assert.equal(taken.sample(3).character.arm.angle, -90);
});

test('a discrete control switches when its spring arrives, and its bounce never flips it back', () => {
  const springy = compileCueScore(a, cast, [{ at: 'go', pose: 'up', by: { spring: { duration: 0.5, bounce: 0.5 } } }]);
  const frames = Array.from({ length: 120 }, (_, k) => springy.sample(1 + k / 60).character.arm);
  const switched = frames.findIndex((arm) => arm.hand === 'fist');
  assert.ok(switched > 0 && frames[switched].angle >= 0.98 * 90 - 1e-9, 'switches as the arm arrives');
  assert.ok(frames.slice(switched).every((arm) => arm.hand === 'fist'));
  assert.ok(frames.some((arm) => arm.angle > 90) && frames.slice(switched).some((arm) => arm.angle < 0.98 * 90), 'it overshoots and swings back under');
  assert.equal(frames.at(-1)!.angle, 90);
});

test('a held look draws the character at its drawing times, from its own cut, while the camera stays live', () => {
  const score = compileCueScore(a, cast, [
    { at: 'go', look: 'paint', pose: 'up', by: { ease: { seconds: 1 }, curve: 'linear' } },
    { at: 'go', camera: { turn: 30 }, by: { ease: { seconds: 1 }, curve: 'linear' } },
    { at: 'hit', look: 'toon', palette: 'night' },
  ]);
  const mid = score.sample(1.27);
  assert.deepEqual([mid.look, mid.palette, mid.drawing, mid.drawingTime], ['paint', 'warm', 2, 1.2]);
  assert.ok(Math.abs(mid.character.arm.angle - 18) < 1e-9 && Math.abs(mid.camera.turn - 8.1) < 1e-9);
  assert.deepEqual([score.sample(2).look, score.sample(2).palette, score.sample(2).drawing], ['toon', 'night', 0]);
  assert.throws(() => compileCueScore(a, cast, [{ at: 'go', palette: { look: 'paint', name: 'cool' } }]), /palette cool is paint's, but toon is showing/);
});

test('bars and beats land on the grid, and a score that names a cue twice or a cue its scene lacks fails to compile', () => {
  const score = compileCueScore(b, cast, [
    { at: [2, 1], pose: 'up' },
    { at: { from: [1, 3], offset: { beats: 0.5 } }, expression: 'grin' },
  ]);
  // Bar 2 beat 1 is beat 4, 2 s in; bar 1 beat 3 is 1 s in, and half a beat later is beat 2.5, on the frame the clock
  // rounds it to: 38, at 1.267 s.
  assert.deepEqual([score.sample(1.99).character.arm.angle, score.sample(2).character.arm.angle], [0, 90]);
  assert.deepEqual([score.sample(1.26).character.face.smile, score.sample(38 / 30).character.face.smile], [0, 1]);
  // An ease in beats may run on past the scene's cut, at the grid's pace.
  assert.equal(compileCueScore(b, cast, [{ at: [2, 4], pose: 'up', by: { ease: { beats: 2 } } }]).sample(3.5 + 1).character.arm.angle, 90);
  // A render reads frame 158 as 158 / 30 less b's start, a rounding error before the cue: it still lands there.
  assert.equal(score.sample(158 / 30 - 4).character.face.smile, 1);
  assert.throws(() => compileCueScore(a, cast, [{ at: 'go', pose: 'up' }, { at: 'go', pose: 'down' }]), /rows 1 and 2 both set character.arm.angle/);
  // @ts-expect-error 'stop' isn't one of scene a's cues
  assert.throws(() => compileCueScore(a, cast, [{ at: 'stop', pose: 'up' }]), /scene a has no cue stop/);
});
