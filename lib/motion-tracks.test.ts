import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleMotionTracks, formatMotionReport, motionChannelVelocity, type FrameMotion, type MotionSample } from './motion-tracks.ts';

const sample = (id: string, x: number, more: Partial<MotionSample> = {}): MotionSample => ({
  id, scene: id.split('/')[0], name: id.split('/').at(-1)!, phase: 'solo', parent: null, attribution: 'scene',
  rect: { x, y: 100, w: 40, h: 20 }, local: { x, y: 100, w: 40, h: 20 }, opacity: 1, values: {}, ...more,
});
const frame = (n: number, samples: MotionSample[], more: Partial<FrameMotion> = {}): FrameMotion =>
  ({ frame: n, scenes: ['a'], samples, unmeasured: [], problems: [], ...more });

test('a track breaks where its element disappears or its scene starts fading, and velocity never spans a break', () => {
  const frames = [
    frame(0, [sample('a/dot', 0)]),
    frame(1, [sample('a/dot', 10)]),
    frame(2, []), // gone for a frame
    frame(3, [sample('a/dot', 50)]),
    frame(4, [sample('a/dot', 60, { phase: 'out' })]), // the next scene starts fading in over it
  ];
  const { tracks, errors } = assembleMotionTracks(frames, { fps: 30, first: 0, last: 4 });
  assert.deepEqual(errors, []);
  const segments = tracks[0].segments;
  assert.deepEqual(segments.map((s) => [s.start, s.end, s.phase]), [[0, 1, 'solo'], [3, 3, 'solo'], [4, 4, 'out']]);
  // Centres, not left edges: the box is 40 wide.
  assert.deepEqual(segments[0].screen.x, [20, 30]);
  assert.deepEqual(motionChannelVelocity(segments[0].screen.x, 30), [null, 300]);
  assert.deepEqual(motionChannelVelocity(segments[1].screen.x, 30), [null]);
});

test('a shared id is an error when the author chose it, ambiguous when the library did, and one camera when it is one', () => {
  const camera = (x: number) => sample('a/camera:page', 0, { implicit: true, camera: `key-${x}`, rect: { x: 0, y: 0, w: 1920, h: 1080 } });
  const frames = [frame(0, [
    sample('a/title', 0), sample('a/title', 300), // two hand-written tags with one name
    sample('a/tag:Today', 0, { implicit: true }), sample('a/tag:Today', 900, { implicit: true }), // two Tags saying the same
    { ...camera(1), opacity: 1 }, { ...camera(1), opacity: 0.4 }, // a state dissolve: two captures, one camera
  ])];
  const m = assembleMotionTracks(frames, { fps: 30, first: 0, last: 0 });
  assert.deepEqual(m.tracks.map((t) => t.id), ['a/camera:page']);
  assert.deepEqual(m.tracks[0].segments[0].screen.opacity, [1]);
  assert.deepEqual(m.errors.map((e) => [e.id, e.problem]), [['a/title', '2 elements share this id: give each its own name']]);
  assert.deepEqual(m.coverage.ambiguous.map((a) => [a.id, a.elements]), [['a/tag:Today', 2]]);
});

test('an unmeasured frame, a value that is not a number and a value some frames skip are tracking errors', () => {
  const frames = [
    frame(0, [sample('a/ring', 0, { values: { draw: 0.2 } })]),
    frame(1, [sample('a/ring', 0, { values: { draw: NaN } })]),
    frame(3, [sample('a/ring', 0, { values: { draw: 0.6 } })]),
    frame(4, [sample('a/ring', 0)]),
  ];
  const m = assembleMotionTracks(frames, { fps: 10, first: 0, last: 4 });
  assert.deepEqual(m.errors.map((e) => [e.problem, e.frames]), [
    ['its "draw" value isn\'t a finite number', { first: 1, last: 1, count: 1 }],
    ['frames were not measured', { first: 2, last: 2, count: 1 }],
    ['its "draw" value is missing on some frames', { first: 4, last: 4, count: 1 }],
  ]);
  assert.deepEqual(m.tracks[0].segments.map((s) => s.values.draw), [[0.2], [0.6, null]]);
  assert.equal(formatMotionReport(m).ok, false);
});

test('a report with nothing tagged says so, and names what it could not measure', () => {
  const m = assembleMotionTracks([frame(0, [], { unmeasured: [{ scene: 'a', what: 'generated clip' }] })], { fps: 30, first: 0, last: 0 });
  assert.deepEqual(formatMotionReport(m).lines, [
    'motion: nothing tagged, so no motion was measured (0.00–0.03s, every frame)',
    '  unmeasured by nature: generated clip (a)',
  ]);
});
