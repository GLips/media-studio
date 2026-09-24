// Renders projects/2026-09-motion-calibration and checks its tracks against what each scene promises: the probe's
// measurements of real layout (transforms, cameras, crossfades) can only be tested in a real render.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildMotionGraph } from './motion-graph.ts';
import { motionChannelVelocity, type MotionSegment } from './motion-tracks.ts';
import { checkProject } from './render-pipeline.ts';
import { openRenderSession } from './render-session.ts';
import { STUDIO_PROJECTS_DIR } from './studio-project.ts';

const { ok, motion, timeline } = await checkProject(await openRenderSession(join(STUDIO_PROJECTS_DIR, '2026-09-motion-calibration')));
const track = (id: string) => {
  const t = motion.tracks.find((x) => x.id === id);
  assert.ok(t, `no track ${id}: ${motion.tracks.map((x) => x.id).join(', ')}`);
  return t;
};
const solo = (id: string): MotionSegment => track(id).segments.find((s) => s.phase === 'solo')!;
const spread = (series: readonly (number | null)[]) => Math.max(...series.map(Number)) - Math.min(...series.map(Number));
const speeds = (series: readonly number[]) => motionChannelVelocity(series, motion.fps).filter((v) => v !== null);

test('the calibration video measures cleanly', () => {
  assert.equal(ok, true);
  assert.deepEqual(motion.errors, []);
  assert.deepEqual(motion.coverage.ambiguous, []);
});

test('an eased glide peaks mid-move; a linear one holds one speed and stops dead', () => {
  const eased = speeds(solo('glide/eased').screen.x), flat = speeds(solo('glide/linear').screen.x);
  // The cubic in-out peaks at 3× the average speed of 1000 px/s.
  assert.ok(Math.max(...eased) > 2500, `eased peaks at ${Math.max(...eased)}`);
  assert.ok(Math.abs(Math.max(...flat) - 1000) < 40, `linear peaks at ${Math.max(...flat)}`);
  // The cliff: full speed one frame, stopped the next.
  const stop = flat.findIndex((v, i) => i > 0 && flat[i - 1] > 900 && v === 0);
  assert.ok(stop > 0, 'linear never drops from full speed to 0 in one frame');
});

test('a centred push moves the ring on screen by size alone, and the cursor keeps only its own path in page space', () => {
  const camera = solo('push/camera'), ring = solo('push/centre'), cursor = solo('push/cursor');
  assert.equal(spread(camera.values.cx), 0);
  assert.ok(Math.abs(Math.max(...camera.values.zoom.map(Number)) - 2.4) < 1e-6);
  assert.equal(ring.parent, 'push/camera');
  assert.ok(spread(ring.screen.x) < 0.5 && spread(ring.screen.y) < 0.5, 'the ring\'s screen centre drifts');
  assert.ok(Math.max(...ring.screen.w) / Math.min(...ring.screen.w) > 2, 'the ring doesn\'t grow on screen');
  assert.ok(spread(ring.local!.x) < 0.5, 'the ring moves in page space');
  // The cursor's tip goes from page x 560 to 760, however far the push carries it on screen. Its box centre sits a
  // fixed screen distance from the tip, which shrinks in page pixels as the camera pushes, so it covers a little less.
  assert.equal(cursor.attribution, 'camera');
  assert.ok(Math.abs(spread(cursor.local!.x) - 200) < 10, `cursor moves ${spread(cursor.local!.x)} page px`);
  assert.ok(spread(cursor.screen.x) > 300);
});

test('a wrapper carrying a camera moves what\'s aimed through it on screen, not on the page', () => {
  const ring = solo('rise/centre');
  assert.equal(ring.attribution, 'camera');
  assert.ok(Math.abs(spread(ring.screen.y) - 120) < 0.5, `the ring rises ${spread(ring.screen.y)} on screen`);
  assert.ok(spread(ring.local!.y) < 0.5, `the ring moves ${spread(ring.local!.y)} on the page`);
});

test('a counter reports its value and a ring its draw, with neither box moving', () => {
  const count = solo('counter/count'), ring = solo('counter/ring');
  assert.deepEqual([count.values.value[0], count.values.value.at(-1)], [0, 120]);
  assert.equal(spread(count.screen.x) + spread(count.screen.y), 0);
  assert.equal(ring.values.draw.at(-1), 1);
});

test('nesting measures a child in its group\'s own pixels, and gives up under a turn', () => {
  const dot = solo('nested/stage/dot');
  assert.equal(dot.attribution, 'group');
  assert.ok(Math.abs(spread(dot.screen.x) - 200) < 0.5 && Math.abs(spread(dot.local!.x) - 100) < 0.5);
  const pin = solo('nested/tilted/pin');
  assert.deepEqual([pin.attribution, pin.parent, pin.local], ['unknown', 'nested/tilted', null]);
  assert.equal(solo('nested/turned/pin').attribution, 'unknown', 'a turned SVG group passed as axis-aligned');
  assert.ok(Math.abs(spread(solo('nested/chip').screen.x) - 600) < 0.5, 'the ref-and-selector tag didn\'t follow the chip');
});

test('tracks break where an element vanishes, at crossfades, and never join across scenes', () => {
  assert.deepEqual(track('blink/blink').segments.map((s) => s.phase), ['in', 'solo', 'solo', 'out']);
  assert.deepEqual(track('after/Same words').segments.map((s) => s.phase), ['in', 'solo']);
  // A hard cut: `end` starts alone, the frame after `after` ends.
  const end = track('end/Same words').segments;
  assert.deepEqual([end.length, end[0].phase, end[0].start], [1, 'solo', track('after/Same words').segments.at(-1)!.end + 1]);
});

test('the graph reads a move straight through a crossfade\'s end, and a ring riding a push as growing, not moving', () => {
  // push starts at 3s, fading in over glide until 3.25s; its ring draws on 3.2–3.5s, across that boundary.
  const [first, last] = [3 * motion.fps, 6 * motion.fps - 1];
  const { summary } = buildMotionGraph(motion, timeline, { first, last, space: 'screen', tracks: ['push/centre'], trailStep: 0.1, backdrop: { frame: last, href: '' } });
  const ring = summary.slice(summary.findIndex((l) => l.startsWith('push/centre')) + 1).map((l) => l.trim().split(/\s+/)[0]);
  assert.deepEqual(ring.filter((channel) => channel === 'draw'), ['draw'], summary.join('\n'));
  assert.ok(ring.includes('w') && !ring.includes('x') && !ring.includes('y'), summary.join('\n'));
});
